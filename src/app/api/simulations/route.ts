import { NextRequest, NextResponse } from "next/server";
import { withAuth, createErrorResponse } from "@/server/with-auth";
import { parseJsonBody, validatePaginationLimit } from "@/server/request-guards";
import { enforceRateLimit, resetRateLimiterOverrides } from "@/server/rate-limiter";
import { checkIdempotency, recordIdempotency } from "@/server/idempotency";
import { simulationsRepo } from "@/server/repositories/simulations";
import { decisionsRepo } from "@/server/repositories/decisions";
import { instrumentsRepo } from "@/server/repositories/instruments";
import { seriesRepo } from "@/server/repositories/series";
import { auditRepo } from "@/server/repositories/audit";
import { canonicalJsonHash } from "@/server/repositories/common";
import { SimulationRequestSchema } from "@/engine/schemas";
import { runSimulation, type SimulationResult } from "@/engine/simulate";
import { Money } from "@/engine/money";
import { Instrument, HourlyBucket } from "@/engine/models";
import { AllocatedHolding } from "@/engine/decision";
import { generateTransactions } from "@/engine/generator";
import { buildContinuousTimeSeries } from "@/engine/timeseries";
import type { OrgAuthContext } from "@/server/auth";

export const maxDuration = 60;

// ---------------------------------------------------------------------------
// Rate Limiter / Debouncer (Best-effort per serverless container)
// ---------------------------------------------------------------------------

/**
 * Best-effort in-memory rate limiter per serverless container instance.
 * Note: Across multiple serverless instances, this is best-effort and does not provide
 * a distributed hard guarantee. It prevents rapid repeated client-side hammering within a single node.
 */
const orgLastSimTime = new Map<string, number>();
export const MIN_SIM_INTERVAL_MS = 10_000;

export function _resetSimulationRateLimiter(): void {
  orgLastSimTime.clear();
  resetRateLimiterOverrides();
}

export function checkSimulationRateLimit(orgId: string): { allowed: boolean; retryAfterSeconds: number } {
  const lastRun = orgLastSimTime.get(orgId);
  const now = Date.now();
  if (lastRun && now - lastRun < MIN_SIM_INTERVAL_MS) {
    const retryAfterSeconds = Math.ceil((MIN_SIM_INTERVAL_MS - (now - lastRun)) / 1000);
    return { allowed: false, retryAfterSeconds };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export function recordSimulationRun(orgId: string): void {
  orgLastSimTime.set(orgId, Date.now());
}

/**
 * Serializes a simulation result into a JSON-safe DTO.
 */
function serializeSimulationResult(result: SimulationResult) {
  return {
    seed: result.seed,
    trials: result.trials,
    horizonHours: result.horizonHours,
    scenario: result.scenario,
    policy: result.policy,
    shortfallFrequency: result.shortfallFrequency,
    expectedShortfallMinor: result.expectedShortfall.amountMinor.toString(),
    p95ShortfallMinor: result.p95Shortfall.amountMinor.toString(),
    emergencyBorrowingCostMinor: result.emergencyBorrowingCost.amountMinor.toString(),
    penaltiesPaidMinor: result.penaltiesPaid.amountMinor.toString(),
    grossYieldMinor: result.grossYield.amountMinor.toString(),
    netYieldMinor: result.netYield.amountMinor.toString(),
    minCash: {
      p5Minor: result.minCash.p5.amountMinor.toString(),
      p50Minor: result.minCash.p50.amountMinor.toString(),
      p95Minor: result.minCash.p95.amountMinor.toString(),
    },
    meanIdleCashMinor: result.meanIdleCash.amountMinor.toString(),
    idleCashHoursMinor: result.idleCashHours.amountMinor.toString(),
    cashPath: result.cashPath.map((p) => ({
      hour: p.hour,
      p5CashMinor: p.p5Cash.amountMinor.toString(),
      medianCashMinor: p.medianCash.amountMinor.toString(),
      p95CashMinor: p.p95Cash.amountMinor.toString(),
    })),
    executionDurationMs: result.executionDurationMs,
    disclaimer: result.disclaimer,
  };
}

/**
 * POST /api/simulations
 * Executes a Monte Carlo stress scenario simulation for the organisation.
 * Minimum required role: analyst (viewers receive 403 Forbidden).
 */
export const POST = withAuth(
  async function runSimulationRoute(
    request: NextRequest,
    authContext: OrgAuthContext
  ): Promise<NextResponse> {
    const { orgId, user, role } = authContext;

    // 1. Role Enforcement
    if (role === "viewer") {
      return createErrorResponse(
        403,
        "FORBIDDEN",
        "Forbidden: role 'viewer' cannot execute stress simulations. Minimum role 'analyst' required."
      );
    }

    // 2. Idempotency Check
    const { key: idempotencyKey, response: cachedResponse } = await checkIdempotency(request, orgId);
    if (cachedResponse) {
      return cachedResponse;
    }

    // 3. Durable Rate Limiting Check (org + user)
    const rateLimitError = await enforceRateLimit({
      routeKey: "simulations.run",
      orgId,
      uid: user.uid,
    });
    if (rateLimitError) {
      return rateLimitError;
    }

    // Also check backwards-compatible 10s debouncing
    const lastRun = orgLastSimTime.get(orgId);
    const now = Date.now();
    if (lastRun && now - lastRun < MIN_SIM_INTERVAL_MS) {
      const retryAfterSeconds = Math.ceil((MIN_SIM_INTERVAL_MS - (now - lastRun)) / 1000);
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "RATE_LIMITED",
            message: `Simulation runs are debounced. Please wait ${retryAfterSeconds}s before re-running.`,
            details: { retryAfterSeconds },
          },
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(retryAfterSeconds),
          },
        }
      );
    }

    // 4. Request Body Validation & Size Guard (64 KB limit, Content-Type application/json)
    const bodyResult = await parseJsonBody(request, SimulationRequestSchema);
    if (!bodyResult.success) {
      return bodyResult.response;
    }

    const inputData = bodyResult.data;

    // 4. Load Org Prerequisites (Instruments, Decisions, History)
    let orgInstruments: Instrument[] = [];
    try {
      const stored = await instrumentsRepo.list(orgId);
      orgInstruments = stored.map((inst) => ({
        id: inst.id,
        name: inst.name,
        // Boundary conversion: database basis points to engine decimal fraction
        apy: inst.annualRateBps / 10_000,
        capacity: Money.fromMinor(inst.capacityMinor, "USD"),
        withdrawalPenalty: inst.penaltyBps !== undefined ? inst.penaltyBps / 10_000 : 0,
        settlementLagHours: inst.settlementLagHours,
        minHoldHours: inst.minHoldHours,
      }));
    } catch (err) {
      console.warn("[simulationsRoute] Error fetching instruments:", err);
    }

    if (orgInstruments.length === 0) {
      return createErrorResponse(
        400,
        "VALIDATION_ERROR",
        "No configured instruments found for this organisation. Configure instruments before running stress simulations."
      );
    }

    // Load latest decision to obtain cash baseline and existing holdings
    let startingCash: Money | null = null;
    let operationalFloor: Money | null = null;
    const currentHoldings: AllocatedHolding[] = [];
    let isSyntheticSource = inputData.source === "synthetic";

    if (isSyntheticSource && inputData.startingCash) {
      startingCash = Money.fromMinor(BigInt(inputData.startingCash), "USD");
    }
    if (isSyntheticSource && inputData.operationalFloor) {
      operationalFloor = Money.fromMinor(BigInt(inputData.operationalFloor), "USD");
    }

    try {
      const latestDecisions = await decisionsRepo.list(orgId, { limit: 1 });
      if (latestDecisions.length > 0) {
        const dec = latestDecisions[0];
        if (!startingCash && dec.availableCashMinor) {
          startingCash = Money.fromMinor(dec.availableCashMinor, "USD");
        }
        if (!operationalFloor && dec.operationalFloorMinor) {
          operationalFloor = Money.fromMinor(dec.operationalFloorMinor, "USD");
        }
        if (dec.source === "synthetic") {
          isSyntheticSource = true;
        }

        // Map existing allocations to holdings
        for (const alloc of dec.allocations ?? []) {
          const inst = orgInstruments.find((i) => i.id === alloc.instrumentId);
          if (inst && alloc.amountMinor) {
            currentHoldings.push({
              instrument: inst,
              currentAmount: Money.fromMinor(alloc.amountMinor, "USD"),
            });
          }
        }
      }
    } catch (err) {
      console.warn("[simulationsRoute] Error fetching latest decision:", err);
    }

    if (!startingCash || !operationalFloor) {
      return createErrorResponse(
        400,
        "VALIDATION_ERROR",
        "Run the engine on the dashboard first so a cash baseline exists, or provide explicit source: 'synthetic' with startingCash and operationalFloor."
      );
    }

    // Load historical buckets from seriesRepo
    let historyBuckets: HourlyBucket[] = [];
    try {
      const nowTime = new Date();
      const pastTime = new Date(nowTime.getTime() - 168 * 3600 * 1000);
      const buckets = await seriesRepo.listRange(orgId, pastTime, nowTime, { limit: 168 });
      if (buckets.length >= 24) {
        historyBuckets = buckets.map((b) => ({
          bucketId: b.bucketId,
          hourStart: b.hourStart,
          inbound: b.inFlow,
          outbound: b.outFlow,
          netFlow: b.inFlow.subtract(b.outFlow),
          grossVolume: b.inFlow.add(b.outFlow),
          transactionCount: 20,
        }));
      }
    } catch (err) {
      console.warn("[simulationsRoute] Error fetching series buckets:", err);
    }

    // If insufficient series in Firestore, generate deterministic baseline series
    if (historyBuckets.length < 24) {
      isSyntheticSource = true;
      const end = new Date(Math.floor(Date.now() / (3600 * 1000)) * (3600 * 1000));
      const start = new Date(end.getTime() - 168 * 3600 * 1000);
      const txs = generateTransactions({
        seed: inputData.seed ?? "sim-history-seed",
        startDate: start,
        endDate: end,
        baseVolumePerHour: Money.fromMinor(20_000_000_00n, "USD"),
      });
      historyBuckets = buildContinuousTimeSeries(txs, {
        startDate: start,
        endDate: end,
        currency: "USD",
      });
    }

    // 5. Execute Simulation Engine
    const simResult = runSimulation({
      seed: inputData.seed ?? `sim-${Date.now()}`,
      history: historyBuckets,
      startingCash,
      instruments: orgInstruments,
      holdings: currentHoldings,
      scenario: inputData.scenario,
      policy: inputData.policy,
      policyParams: inputData.policyParams,
      horizonHours: inputData.horizonHours,
      trials: inputData.trials,
      operationalFloor,
      emergencyBorrowingRateBps: inputData.emergencyBorrowingRateBps,
    });

    // Mark successful execution timestamp for rate limiter
    orgLastSimTime.set(orgId, now);

    // 6. Persistence & Audit Log
    const serializedMetrics = serializeSimulationResult(simResult);
    const source = isSyntheticSource ? "synthetic" : "live";

    let persisted = false;
    let audited = false;
    let storedId: string | undefined = undefined;
    let persistenceWarning: string | undefined = undefined;

    try {
      const record = await simulationsRepo.create(
        orgId,
        {
          scenario: inputData.scenario as unknown as Record<string, unknown>,
          seed: simResult.seed,
          policy: inputData.policy,
          metrics: serializedMetrics as unknown as Record<string, unknown>,
          source,
        },
        user.uid
      );
      persisted = true;
      storedId = record.id;

      // Append immutable audit entry
      try {
        const afterHash = canonicalJsonHash({
          id: record.id,
          orgId,
          scenario: inputData.scenario,
          policy: inputData.policy,
          seed: simResult.seed,
          metrics: serializedMetrics,
          createdAt: record.createdAt.toISOString(),
          createdBy: user.uid,
        });

        await auditRepo.append(orgId, {
          actorUid: user.uid,
          action: "simulation.create",
          refPath: `orgs/${orgId}/simulations/${record.id}`,
          afterHash,
        });
        audited = true;
      } catch (auditErr) {
        console.warn("[simulationsRoute] Audit append failed:", auditErr);
      }
    } catch (persistErr) {
      console.warn("[simulationsRoute] Simulation persistence failed:", persistErr);
      persistenceWarning =
        "Simulation was computed successfully, but result storage or audit trail encountered a transient error.";
    }

    const successPayload = {
      ok: true as const,
      data: {
        id: storedId ?? `sim-${Date.now()}`,
        ...serializedMetrics,
        source,
        persisted,
        audited,
        ...(persistenceWarning ? { warning: persistenceWarning } : {}),
      },
    };

    await recordIdempotency(orgId, idempotencyKey, 200, successPayload);

    return NextResponse.json(successPayload);
  }
);

/**
 * GET /api/simulations
 * Lists recent stress scenario simulations for the organisation.
 * Minimum required role: viewer.
 */
export const GET = withAuth(
  async function listSimulationsRoute(
    request: NextRequest,
    authContext: OrgAuthContext
  ): Promise<NextResponse> {
    try {
      const limitResult = validatePaginationLimit(request.nextUrl.searchParams, 20, 100);
      if ("errorResponse" in limitResult) {
        return limitResult.errorResponse;
      }
      const limit = limitResult.limit;
      const simulations = await simulationsRepo.list(authContext.orgId, { limit });

      const safeSimulations = simulations.map((s) => ({
        id: s.id,
        orgId: s.orgId,
        scenario: s.scenario,
        seed: s.seed,
        policy: s.policy,
        metrics: s.metrics,
        source: s.source,
        createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : s.createdAt,
        createdBy: s.createdBy,
      }));

      return NextResponse.json({
        ok: true,
        data: safeSimulations,
      });
    } catch (error) {
      console.error("[listSimulationsRoute Error]:", error);
      return createErrorResponse(500, "INTERNAL", "Failed to retrieve simulations.");
    }
  },
  { minRole: "viewer" }
);

