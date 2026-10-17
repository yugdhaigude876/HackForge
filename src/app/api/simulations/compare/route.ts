import { NextRequest, NextResponse } from "next/server";
import { withAuth, createErrorResponse } from "@/server/with-auth";
import { simulationsRepo } from "@/server/repositories/simulations";
import { decisionsRepo } from "@/server/repositories/decisions";
import { instrumentsRepo } from "@/server/repositories/instruments";
import { seriesRepo } from "@/server/repositories/series";
import { auditRepo } from "@/server/repositories/audit";
import { canonicalJsonHash } from "@/server/repositories/common";
import { PolicyComparisonRequestSchema } from "@/engine/schemas";
import {
  compareScenarioAcrossPolicies,
  type PolicyComparisonResult,
  type SimulationResult,
  type PolicyComparisonDeltas,
} from "@/engine/simulate";
import { Money } from "@/engine/money";
import { Instrument, HourlyBucket } from "@/engine/models";
import { AllocatedHolding } from "@/engine/decision";
import { generateTransactions } from "@/engine/generator";
import { buildContinuousTimeSeries } from "@/engine/timeseries";
import type { OrgAuthContext } from "@/server/auth";
import { checkSimulationRateLimit, recordSimulationRun } from "../route";

/**
 * Serializes an individual policy's simulation result into a JSON-safe DTO.
 */
function serializeSingleResult(result: SimulationResult) {
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
 * Serializes deltas vs baselines into JSON-safe DTOs.
 */
function serializeDeltas(deltas: PolicyComparisonDeltas) {
  return {
    vsHoldAllCash: deltas.vsHoldAllCash
      ? {
          netYieldMinor: deltas.vsHoldAllCash.netYield.amountMinor.toString(),
          shortfallFrequency: deltas.vsHoldAllCash.shortfallFrequency,
          expectedShortfallMinor: deltas.vsHoldAllCash.expectedShortfall.amountMinor.toString(),
          p95ShortfallMinor: deltas.vsHoldAllCash.p95Shortfall.amountMinor.toString(),
          penaltiesPaidMinor: deltas.vsHoldAllCash.penaltiesPaid.amountMinor.toString(),
          emergencyBorrowingCostMinor: deltas.vsHoldAllCash.emergencyBorrowingCost.amountMinor.toString(),
        }
      : undefined,
    vsFixedBuffer: deltas.vsFixedBuffer
      ? {
          netYieldMinor: deltas.vsFixedBuffer.netYield.amountMinor.toString(),
          shortfallFrequency: deltas.vsFixedBuffer.shortfallFrequency,
          expectedShortfallMinor: deltas.vsFixedBuffer.expectedShortfall.amountMinor.toString(),
          p95ShortfallMinor: deltas.vsFixedBuffer.p95Shortfall.amountMinor.toString(),
          penaltiesPaidMinor: deltas.vsFixedBuffer.penaltiesPaid.amountMinor.toString(),
          emergencyBorrowingCostMinor: deltas.vsFixedBuffer.emergencyBorrowingCost.amountMinor.toString(),
        }
      : undefined,
  };
}

/**
 * POST /api/simulations/compare
 * Executes a side-by-side Monte Carlo policy comparison under Common Random Numbers (CRN).
 * Minimum required role: analyst (viewers receive 403 Forbidden).
 */
export const POST = withAuth(
  async function runPolicyComparisonRoute(
    request: NextRequest,
    authContext: OrgAuthContext
  ): Promise<NextResponse> {
    const { orgId, user, role } = authContext;

    // 1. Role Enforcement
    if (role === "viewer") {
      return createErrorResponse(
        403,
        "FORBIDDEN",
        "Forbidden: role 'viewer' cannot execute policy comparisons. Minimum role 'analyst' required."
      );
    }

    // 2. Shared Rate Limiting / Debouncing (10s per org)
    // NOTE: This limiter is in-memory and operates on a best-effort basis per serverless container.
    // It is not a distributed hard guarantee across multiple serverless instances.
    const rateCheck = checkSimulationRateLimit(orgId);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "RATE_LIMITED",
            message: `Simulation runs are debounced. Please wait ${rateCheck.retryAfterSeconds}s before re-running.`,
            details: { retryAfterSeconds: rateCheck.retryAfterSeconds },
          },
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(rateCheck.retryAfterSeconds),
          },
        }
      );
    }

    // 3. Request Body Validation
    let rawJson: unknown;
    try {
      rawJson = await request.json();
    } catch {
      return createErrorResponse(400, "VALIDATION_ERROR", "Malformed JSON payload.");
    }

    const parseResult = PolicyComparisonRequestSchema.safeParse(rawJson);
    if (!parseResult.success) {
      return createErrorResponse(
        400,
        "VALIDATION_ERROR",
        `Invalid comparison parameters: ${parseResult.error.issues.map((i) => i.message).join(", ")}`,
        parseResult.error.flatten()
      );
    }

    const inputData = parseResult.data;
    const policies = inputData.policies ?? ["reserve-juggler", "hold-all-cash", "fixed-buffer"];

    // 4. Cap Total Work to protect serverless compute (trials x policies <= 3000)
    const totalWork = inputData.trials * policies.length;
    if (totalWork > 3000) {
      return createErrorResponse(
        400,
        "VALIDATION_ERROR",
        `Total simulation work (${totalWork} trials across ${policies.length} policies) exceeds the maximum limit of 3000. Reduce trials or number of policies.`
      );
    }

    // 5. Load Org Instruments
    let orgInstruments: Instrument[] = [];
    try {
      const stored = await instrumentsRepo.list(orgId);
      orgInstruments = stored.map((inst) => ({
        id: inst.id,
        name: inst.name,
        // Convert basis points to decimal fraction at boundary
        apy: inst.annualRateBps / 10_000,
        capacity: Money.fromMinor(inst.capacityMinor, "USD"),
        withdrawalPenalty: inst.penaltyBps !== undefined ? inst.penaltyBps / 10_000 : 0,
        settlementLagHours: inst.settlementLagHours,
        minHoldHours: inst.minHoldHours,
      }));
    } catch (err) {
      console.warn("[simulationsCompareRoute] Error fetching instruments:", err);
    }

    if (orgInstruments.length === 0) {
      return createErrorResponse(
        400,
        "VALIDATION_ERROR",
        "No configured instruments found for this organisation. Configure instruments before running stress simulations."
      );
    }

    // 6. Load Cash Baseline
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
      console.warn("[simulationsCompareRoute] Error fetching latest decision:", err);
    }

    if (!startingCash || !operationalFloor) {
      return createErrorResponse(
        400,
        "VALIDATION_ERROR",
        "Run the engine on the dashboard first so a cash baseline exists, or provide explicit source: 'synthetic' with startingCash and operationalFloor."
      );
    }

    // 7. Load Historical Series
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
      console.warn("[simulationsCompareRoute] Error fetching series buckets:", err);
    }

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

    // 8. Execute Multi-Policy Comparison Engine (Common Random Numbers)
    const seed = inputData.seed ?? `cmp-${Date.now()}`;
    const compResult: PolicyComparisonResult = compareScenarioAcrossPolicies({
      seed,
      history: historyBuckets,
      startingCash,
      instruments: orgInstruments,
      holdings: currentHoldings,
      scenario: inputData.scenario,
      policies,
      policyParams: inputData.policyParams,
      horizonHours: inputData.horizonHours,
      trials: inputData.trials,
      operationalFloor,
      emergencyBorrowingRateBps: inputData.emergencyBorrowingRateBps,
    });

    // Record timestamp for rate limiter
    recordSimulationRun(orgId);

    // 9. Persistence & Audit Log
    const comparisonId = `cmp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const source = isSyntheticSource ? "synthetic" : "live";

    const serializedPolicyResults: Record<string, ReturnType<typeof serializeSingleResult>> = {};
    for (const p of compResult.policies) {
      serializedPolicyResults[p] = serializeSingleResult(compResult.policyResults[p]);
    }

    const serializedDeltas: Record<string, ReturnType<typeof serializeDeltas>> = {};
    for (const p of compResult.policies) {
      serializedDeltas[p] = serializeDeltas(compResult.deltas[p]);
    }

    let persisted = false;
    let audited = false;
    let persistenceWarning: string | undefined = undefined;

    try {
      // Persist one record per policy sharing comparisonId
      for (const p of compResult.policies) {
        await simulationsRepo.create(
          orgId,
          {
            comparisonId,
            scenario: inputData.scenario as unknown as Record<string, unknown>,
            seed: compResult.seed,
            policy: p,
            metrics: serializedPolicyResults[p] as unknown as Record<string, unknown>,
            source,
          },
          user.uid
        );
      }
      persisted = true;

      // Append single audit entry per comparison
      try {
        const afterHash = canonicalJsonHash({
          comparisonId,
          orgId,
          scenario: inputData.scenario,
          policies: compResult.policies,
          seed: compResult.seed,
          winners: compResult.winners,
          createdBy: user.uid,
        });

        await auditRepo.append(orgId, {
          actorUid: user.uid,
          action: "simulation.compare",
          refPath: `orgs/${orgId}/simulations/compare/${comparisonId}`,
          afterHash,
        });
        audited = true;
      } catch (auditErr) {
        console.warn("[simulationsCompareRoute] Audit append failed:", auditErr);
      }
    } catch (persistErr) {
      console.warn("[simulationsCompareRoute] Persistence failed:", persistErr);
      persistenceWarning =
        "Comparison was computed successfully, but result storage or audit trail encountered a transient error.";
    }

    return NextResponse.json({
      ok: true,
      data: {
        comparisonId,
        seed: compResult.seed,
        trials: compResult.trials,
        horizonHours: compResult.horizonHours,
        scenario: compResult.scenario,
        policies: compResult.policies,
        policyResults: serializedPolicyResults,
        deltas: serializedDeltas,
        winners: compResult.winners,
        executionDurationMs: compResult.executionDurationMs,
        disclaimer: compResult.disclaimer,
        persisted,
        audited,
        ...(persistenceWarning ? { persistenceWarning } : {}),
      },
    });
  }
);

/**
 * GET /api/simulations/compare
 * Lists recent comparison runs for the organisation.
 * Minimum role: viewer.
 */
export const GET = withAuth(
  async function listComparisonsRoute(
    request: NextRequest,
    authContext: OrgAuthContext
  ): Promise<NextResponse> {
    const { orgId } = authContext;

    try {
      const records = await simulationsRepo.list(orgId, { limit: 60 });
      // Filter records that belong to a comparison
      const cmpMap = new Map<
        string,
        {
          comparisonId: string;
          scenario: unknown;
          seed: string | number;
          policies: string[];
          source?: string;
          createdAt: string;
          trials?: number;
          horizonHours?: number;
        }
      >();

      for (const rec of records) {
        if (!rec.comparisonId) continue;
        const existing = cmpMap.get(rec.comparisonId);
        const policyStr = typeof rec.policy === "string" ? rec.policy : JSON.stringify(rec.policy);
        const metrics = rec.metrics as Record<string, unknown> | undefined;
        const trials = typeof metrics?.trials === "number" ? metrics.trials : undefined;
        const horizonHours = typeof metrics?.horizonHours === "number" ? metrics.horizonHours : undefined;

        if (!existing) {
          cmpMap.set(rec.comparisonId, {
            comparisonId: rec.comparisonId,
            scenario: rec.scenario,
            seed: rec.seed,
            policies: [policyStr],
            source: rec.source,
            createdAt: rec.createdAt.toISOString(),
            trials,
            horizonHours,
          });
        } else {
          if (!existing.policies.includes(policyStr)) {
            existing.policies.push(policyStr);
          }
        }
      }

      const comparisons = Array.from(cmpMap.values());
      return NextResponse.json({
        ok: true,
        data: {
          comparisons,
        },
      });
    } catch (err) {
      console.warn("[simulationsCompareRoute GET] List failed:", err);
      return createErrorResponse(500, "INTERNAL", "Failed to retrieve comparisons.");
    }
  },
  { minRole: "viewer" }
);
