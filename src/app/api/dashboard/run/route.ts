import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, createErrorResponse } from "@/server/with-auth";
import { instrumentsRepo } from "@/server/repositories/instruments";
import { forecastsRepo, type ForecastRecord } from "@/server/repositories/forecasts";
import { decisionsRepo, type DecisionRecord } from "@/server/repositories/decisions";
import { seriesRepo } from "@/server/repositories/series";
import { auditRepo } from "@/server/repositories/audit";
import { canonicalJsonHash } from "@/server/repositories/common";
import { Money } from "@/engine/money";
import { MoneyInputSchema, parseMoneyInput } from "@/engine/schemas";
import { generateTransactions } from "@/engine/generator";
import { buildContinuousTimeSeries, createRollingWindows } from "@/engine/timeseries";
import {
  HourOfWeekSmoothingForecaster,
  evaluateForecaster,
} from "@/engine/forecast";
import {
  calculateQuantile,
  extractCumulativeResiduals,
  calculateResidualQuantile,
} from "@/engine/reserve";
import {
  evaluateLiquidityDecision,
  type DecisionContext,
} from "@/engine/decision";
import { type Instrument } from "@/engine/models";
import type { OrgAuthContext } from "@/server/auth";

// ---------------------------------------------------------------------------
// Rate Limiter / Debouncer
// ---------------------------------------------------------------------------

const orgLastRunTime = new Map<string, number>();
export const MIN_RUN_INTERVAL_MS = 10_000;

export function _resetDashboardRunRateLimiter(): void {
  orgLastRunTime.clear();
}

// ---------------------------------------------------------------------------
// Request Schema
// ---------------------------------------------------------------------------

const DashboardRunRequestSchema = z.object({
  source: z.enum(["synthetic", "live"]).optional().default("synthetic"),
  seed: z.string().optional().default("hackathon-seed-123"),
  horizonHours: z.number().int().positive().max(720).optional().default(24),
  alpha: z.number().min(0.001).max(0.5).optional().default(0.01),
  availableCash: MoneyInputSchema.optional(),
  operationalFloor: MoneyInputSchema.optional(),
});

/**
 * POST /api/dashboard/run
 * Runs end-to-end generate -> forecast -> decision pipeline using org instruments,
 * persists both records + audit trails, and returns the updated dashboard summary.
 * Minimum required role: analyst.
 */
export const POST = withAuth(
  async function runDashboardEngineRoute(
    request: NextRequest,
    authContext: OrgAuthContext
  ): Promise<NextResponse> {
    const orgId = authContext.orgId;
    const now = Date.now();

    // 1. Rate limiting check (simple per-org minimum interval: 10s)
    const lastRun = orgLastRunTime.get(orgId) ?? 0;
    if (now - lastRun < MIN_RUN_INTERVAL_MS) {
      const remainingMs = MIN_RUN_INTERVAL_MS - (now - lastRun);
      const retryAfterSeconds = Math.max(1, Math.ceil(remainingMs / 1000));

      return new NextResponse(
        JSON.stringify({
          ok: false,
          error: {
            code: "RATE_LIMITED",
            message: `Engine run debounced. Minimum interval is ${MIN_RUN_INTERVAL_MS / 1000}s. Please wait ${retryAfterSeconds}s before retrying.`,
            details: { retryAfterSeconds },
          },
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(retryAfterSeconds),
          },
        }
      );
    }

    // 2. Parse and validate body
    let rawBody: unknown = {};
    try {
      const text = await request.text();
      if (text.trim().length > 0) {
        rawBody = JSON.parse(text);
      }
    } catch {
      return createErrorResponse(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
    }

    const parseResult = DashboardRunRequestSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return createErrorResponse(
        400,
        "VALIDATION_ERROR",
        "Invalid run parameters.",
        parseResult.error.issues
      );
    }

    const inputData = parseResult.data;

    // 3. Retrieve stored organisation instruments
    const dbInstruments = await instrumentsRepo.list(orgId, { limit: 50 });
    if (dbInstruments.length === 0) {
      return createErrorResponse(
        400,
        "VALIDATION_ERROR",
        `No yield instruments configured for organisation "${orgId}". Instruments must be configured in Firestore before running the decision engine.`
      );
    }

    // Map to engine domain Instrument[]
    const domainInstruments: Instrument[] = dbInstruments.map((inst) => ({
      id: inst.id,
      name: inst.name,
      apy: inst.annualRateBps, // Treated as bps if > 1 in engine
      capacity: inst.capacity, // strict Money
      withdrawalPenalty: inst.penaltyBps,
      settlementLagHours: inst.settlementLagHours,
      minHoldHours: inst.minHoldHours,
    }));

    // Record run timestamp now that validations passed
    orgLastRunTime.set(orgId, now);

    try {
      const horizonHours = inputData.horizonHours;
      const lookbackHours = 168;
      const stepHours = 12;

      // 4. Generate or query hourly cash flow series
      const endDate = new Date(Math.floor(now / (3600 * 1000)) * (3600 * 1000));
      const totalHours = Math.max(720, lookbackHours + horizonHours);
      const startDate = new Date(endDate.getTime() - totalHours * 3600 * 1000);

      const txs = generateTransactions({
        seed: inputData.seed,
        startDate,
        endDate,
        baseVolumePerHour: Money.fromMinor(20_000_000_00n, "USD"),
      });

      const series = buildContinuousTimeSeries(txs, {
        startDate,
        endDate,
        currency: "USD",
      });

      // Persist recent series buckets into Firestore (non-fatal if Firestore offline)
      try {
        const recentBuckets = series.slice(-48);
        for (const b of recentBuckets) {
          await seriesRepo.upsertBucket(orgId, {
            hourStart: b.hourStart,
            inMinor: b.inbound.amountMinor,
            outMinor: b.outbound.amountMinor,
          });
        }
      } catch (err) {
        console.warn("[dashboardRun] Series persistence warning:", err);
      }

      // 5. Run Time-Series Forecaster & Evaluation Harness
      const windows = createRollingWindows(series, {
        lookbackHours,
        horizonHours,
        stepHours,
      });

      const forecaster = new HourOfWeekSmoothingForecaster({
        lambda: 0.3,
        mode: "ewma",
      });

      const backtest = evaluateForecaster(forecaster, windows);
      const activeHistory = series.slice(-lookbackHours);
      const predictions = forecaster.predict(activeHistory, horizonHours);

      const asOfDate = new Date(series[series.length - 1].hourStart);
      const asOfMs = asOfDate.getTime();

      // Compute step residual quantile bands
      const forecastPoints = predictions.map((p, idx) => {
        let bandLowerMinor: string | undefined;
        let bandUpperMinor: string | undefined;
        if (backtest.windows.length > 0) {
          const stepResiduals = backtest.windows.map(
            (w) => Number(w.residuals[idx]?.amountMinor ?? 0n)
          );
          if (stepResiduals.length > 0) {
            const q05 = calculateQuantile(stepResiduals, 0.05);
            const q95 = calculateQuantile(stepResiduals, 0.95);
            bandLowerMinor = (p.amountMinor + BigInt(Math.round(q05))).toString();
            bandUpperMinor = (p.amountMinor + BigInt(Math.round(q95))).toString();
          }
        }
        return {
          ts: new Date(asOfMs + (idx + 1) * 3600 * 1000),
          mean: p.amountMinor,
          bandLower: bandLowerMinor,
          bandUpper: bandUpperMinor,
        };
      });

      const cumResiduals = extractCumulativeResiduals(backtest.windows);
      const worstCaseResidualShortfall =
        cumResiduals.length > 0
          ? calculateResidualQuantile(cumResiduals, inputData.alpha)
          : Money.fromMinor(-4_000_000_00n, "USD");

      let expectedCumulativeFlowMinor = 0n;
      for (const p of predictions) {
        expectedCumulativeFlowMinor += p.amountMinor;
      }
      const expectedCumulativeFlow = Money.fromMinor(expectedCumulativeFlowMinor, "USD");

      // 6. Persist Forecast Record & Audit Log
      let savedForecast: ForecastRecord | null = null;
      try {
        savedForecast = await forecastsRepo.create(
          orgId,
          {
            method: "hour_of_week",
            params: { lookbackHours, horizonHours, lambda: 0.3, mode: "ewma" },
            asOf: asOfDate,
            horizon: horizonHours,
            points: forecastPoints,
            residualQuantiles: {
              mase: backtest.metrics.mase,
              maeMinor: backtest.metrics.maeMinor,
              maeDollars: backtest.metrics.maeDollars,
              pinballLoss95: backtest.metrics.pinballLoss95,
              pinballLoss99: backtest.metrics.pinballLoss99,
            },
            backtest: {
              mase: backtest.metrics.mase,
              pinball: backtest.metrics.pinballLoss95,
              sampleSize: backtest.windowCount,
            },
            source: inputData.source,
          },
          authContext.user.uid
        );

        const refPath = `orgs/${orgId}/forecasts/${savedForecast.id}`;
        const afterHash = canonicalJsonHash({
          id: savedForecast.id,
          orgId,
          method: "hour_of_week",
          horizon: horizonHours,
          metrics: backtest.metrics,
        });

        await auditRepo.append(orgId, {
          actorUid: authContext.user.uid,
          action: "forecast.create",
          refPath,
          afterHash,
        });
      } catch (err) {
        console.warn("[dashboardRun] Forecast persistence error:", err);
      }

      // 7. Formulate Liquidity Decision
      const availableCash = inputData.availableCash
        ? parseMoneyInput(inputData.availableCash, "USD")
        : Money.fromMinor(50_000_000_00n, "USD");
      const operationalFloor = inputData.operationalFloor
        ? parseMoneyInput(inputData.operationalFloor, "USD")
        : Money.fromMinor(10_000_000_00n, "USD");

      const decisionContext: DecisionContext = {
        availableCash,
        expectedCumulativeFlow,
        worstCaseResidualShortfall,
        sampleSize: backtest.windowCount,
        mase: backtest.metrics.mase,
        currentHoldings: [],
        availableInstruments: domainInstruments,
        operationalFloor,
        horizonHours,
      };

      const decisionResult = evaluateLiquidityDecision(decisionContext);

      // Map allocations with rich metadata
      let totalExpectedYieldMinor = 0n;
      const mappedAllocations = (decisionResult.allocations ?? []).map((a) => {
        const amtMinor = a.allocated ? a.allocated.amountMinor : 0n;
        const apyFraction = a.instrument.apy > 1 ? a.instrument.apy / 10000 : a.instrument.apy;
        const annualYield = BigInt(Math.round(Number(amtMinor) * apyFraction));
        const horizonH = BigInt(horizonHours);
        totalExpectedYieldMinor += (annualYield * horizonH) / (365n * 24n);

        return {
          instrumentId: a.instrument.id,
          name: a.instrument.name,
          amount: amtMinor.toString(),
          annualRateBps: Math.round(a.instrument.apy > 1 ? a.instrument.apy : a.instrument.apy * 10000),
          settlementLagHours: a.instrument.settlementLagHours ?? 0,
          penaltyBps: Math.round(
            a.instrument.withdrawalPenalty > 1
              ? a.instrument.withdrawalPenalty
              : a.instrument.withdrawalPenalty * 10000
          ),
          capacity: a.instrument.capacity.amountMinor.toString(),
        };
      });

      // 8. Persist Decision Record & Audit Log
      let savedDecision: DecisionRecord | null = null;
      try {
        savedDecision = await decisionsRepo.create(
          orgId,
          {
            forecastId: savedForecast?.id,
            confidence: 1 - inputData.alpha,
            reserve: decisionResult.requiredReserve.amountMinor.toString(),
            surplus: decisionResult.deployableSurplus.amountMinor.toString(),
            availableCash: availableCash.amountMinor.toString(),
            deployedTotal: "0",
            operationalFloor: operationalFloor.amountMinor.toString(),
            horizonHours,
            alpha: inputData.alpha,
            expectedCumulativeFlow: expectedCumulativeFlow.amountMinor.toString(),
            worstCaseResidualShortfall: worstCaseResidualShortfall.amountMinor.toString(),
            backtest: {
              mase: backtest.metrics.mase,
              sampleSize: backtest.windowCount,
            },
            allocations: mappedAllocations,
            status: decisionResult.status,
            expectedNetYield: totalExpectedYieldMinor.toString(),
            explanation: decisionResult.explanation,
            source: inputData.source,
          },
          authContext.user.uid
        );

        const refPath = `orgs/${orgId}/decisions/${savedDecision.id}`;
        const afterHash = canonicalJsonHash({
          id: savedDecision.id,
          orgId,
          status: decisionResult.status,
          requiredReserve: decisionResult.requiredReserve.amountMinor.toString(),
          deployableSurplus: decisionResult.deployableSurplus.amountMinor.toString(),
          allocations: mappedAllocations,
        });

        await auditRepo.append(orgId, {
          actorUid: authContext.user.uid,
          action: "decision.create",
          refPath,
          afterHash,
        });
      } catch (err) {
        console.warn("[dashboardRun] Decision persistence error:", err);
      }

      // 9. Prepare and return updated summary payload
      const actuals = series.slice(-24).map((b) => ({
        hour: b.hourStart instanceof Date ? b.hourStart.toISOString() : String(b.hourStart),
        netMinor: (b.inbound.amountMinor - b.outbound.amountMinor).toString(),
      }));

      const payload = {
        decision: savedDecision
          ? {
              id: savedDecision.id,
              orgId: savedDecision.orgId,
              forecastId: savedDecision.forecastId,
              confidence: savedDecision.confidence,
              reserveMinor: savedDecision.reserveMinor,
              surplusMinor: savedDecision.surplusMinor,
              availableCashMinor: savedDecision.availableCashMinor ?? availableCash.amountMinor.toString(),
              deployedTotalMinor: savedDecision.deployedTotalMinor ?? "0",
              operationalFloorMinor: savedDecision.operationalFloorMinor ?? operationalFloor.amountMinor.toString(),
              horizonHours,
              alpha: inputData.alpha,
              expectedCumulativeFlowMinor: expectedCumulativeFlow.amountMinor.toString(),
              worstCaseResidualShortfallMinor: worstCaseResidualShortfall.amountMinor.toString(),
              backtest: {
                mase: backtest.metrics.mase,
                sampleSize: backtest.windowCount,
              },
              allocations: mappedAllocations.map((a) => ({
                instrumentId: a.instrumentId,
                name: a.name,
                amountMinor: a.amount,
                annualRateBps: a.annualRateBps,
                settlementLagHours: a.settlementLagHours,
                penaltyBps: a.penaltyBps,
                capacityMinor: a.capacity,
              })),
              status: decisionResult.status,
              expectedNetYieldMinor: totalExpectedYieldMinor.toString(),
              explanation: decisionResult.explanation,
              source: inputData.source,
              createdAt: savedDecision.createdAt instanceof Date ? savedDecision.createdAt.toISOString() : String(savedDecision.createdAt),
              createdBy: savedDecision.createdBy,
            }
          : null,
        forecast: savedForecast
          ? {
              id: savedForecast.id,
              orgId: savedForecast.orgId,
              method: savedForecast.method,
              asOf: savedForecast.asOf instanceof Date ? savedForecast.asOf.toISOString() : String(savedForecast.asOf),
              horizon: savedForecast.horizon,
              points: savedForecast.points.map((p) => ({
                ts: p.ts instanceof Date ? p.ts.toISOString() : String(p.ts),
                meanMinor: p.meanMinor,
                bandLowerMinor: p.bandLowerMinor,
                bandUpperMinor: p.bandUpperMinor,
              })),
              backtest: {
                mase: backtest.metrics.mase,
                pinball: backtest.metrics.pinballLoss95,
                sampleSize: backtest.windowCount,
              },
              source: inputData.source,
              createdAt: savedForecast.createdAt instanceof Date ? savedForecast.createdAt.toISOString() : String(savedForecast.createdAt),
            }
          : null,
        actuals,
        userRole: authContext.role,
      };

      return NextResponse.json({
        ok: true,
        data: payload,
      });
    } catch (err) {
      console.error("[runDashboardEngineRoute Error]:", err);
      return createErrorResponse(500, "INTERNAL", "An unexpected internal server error occurred.");
    }
  },
  { minRole: "analyst" }
);
