import { NextRequest, NextResponse } from "next/server";
import { withAuth, createErrorResponse } from "@/server/with-auth";
import { decisionsRepo, type DecisionRecord } from "@/server/repositories/decisions";
import { forecastsRepo, type ForecastRecord } from "@/server/repositories/forecasts";
import { seriesRepo } from "@/server/repositories/series";
import type { OrgAuthContext } from "@/server/auth";

export interface SerializedAllocation {
  instrumentId: string;
  name: string;
  amountMinor: string;
  annualRateBps: number;
  settlementLagHours: number;
  penaltyBps: number;
  capacityMinor: string;
}

export interface SerializedDecision {
  id: string;
  orgId: string;
  forecastId: string;
  confidence: number;
  reserveMinor: string;
  surplusMinor: string;
  availableCashMinor: string;
  deployedTotalMinor: string;
  operationalFloorMinor: string;
  horizonHours: number;
  alpha: number;
  expectedCumulativeFlowMinor: string;
  worstCaseResidualShortfallMinor: string;
  backtest: {
    mase: number;
    sampleSize: number;
  } | null;
  allocations: SerializedAllocation[];
  status: string;
  expectedNetYieldMinor: string;
  explanation: string;
  source?: "synthetic" | "import" | "live";
  createdAt: string;
  createdBy: string;
}

export interface SerializedForecastPoint {
  ts: string;
  meanMinor: string;
  bandLowerMinor?: string;
  bandUpperMinor?: string;
}

export interface SerializedForecast {
  id: string;
  orgId: string;
  method: string;
  asOf: string;
  horizon: number;
  points: SerializedForecastPoint[];
  backtest: {
    mase: number;
    pinball: number;
    skillVsBaseline?: number;
    sampleSize?: number;
  };
  source?: "synthetic" | "import" | "live";
  createdAt: string;
}

export interface DashboardSummaryPayload {
  decision: SerializedDecision | null;
  forecast: SerializedForecast | null;
  actuals: Array<{
    hour: string;
    netMinor: string;
  }>;
  userRole: string;
}

function serializeDecision(d: DecisionRecord): SerializedDecision {
  return {
    id: d.id,
    orgId: d.orgId,
    forecastId: d.forecastId,
    confidence: d.confidence,
    reserveMinor: d.reserveMinor,
    surplusMinor: d.surplusMinor,
    availableCashMinor: d.availableCashMinor ?? (BigInt(d.reserveMinor) + BigInt(d.surplusMinor)).toString(),
    deployedTotalMinor: d.deployedTotalMinor ?? "0",
    operationalFloorMinor: d.operationalFloorMinor ?? "0",
    horizonHours: d.horizonHours ?? 24,
    alpha: d.alpha ?? 0.01,
    expectedCumulativeFlowMinor: d.expectedCumulativeFlowMinor ?? "0",
    worstCaseResidualShortfallMinor: d.worstCaseResidualShortfallMinor ?? "0",
    backtest: d.backtest ? { mase: d.backtest.mase, sampleSize: d.backtest.sampleSize } : null,
    allocations: (d.allocations ?? []).map((a) => ({
      instrumentId: a.instrumentId,
      name: a.name || a.instrumentId,
      amountMinor: a.amountMinor,
      annualRateBps: a.annualRateBps ?? 0,
      settlementLagHours: a.settlementLagHours ?? 0,
      penaltyBps: a.penaltyBps ?? 0,
      capacityMinor: a.capacityMinor ?? a.amountMinor,
    })),
    status: d.status,
    expectedNetYieldMinor: d.expectedNetYieldMinor,
    explanation: d.explanation,
    source: d.source,
    createdAt: d.createdAt instanceof Date ? d.createdAt.toISOString() : String(d.createdAt),
    createdBy: d.createdBy,
  };
}

function serializeForecast(f: ForecastRecord): SerializedForecast {
  return {
    id: f.id,
    orgId: f.orgId,
    method: f.method,
    asOf: f.asOf instanceof Date ? f.asOf.toISOString() : String(f.asOf),
    horizon: f.horizon,
    points: (f.points ?? []).map((p) => ({
      ts: p.ts instanceof Date ? p.ts.toISOString() : String(p.ts),
      meanMinor: p.meanMinor,
      bandLowerMinor: p.bandLowerMinor,
      bandUpperMinor: p.bandUpperMinor,
    })),
    backtest: {
      mase: f.backtest.mase,
      pinball: f.backtest.pinball,
      skillVsBaseline: f.backtest.skillVsBaseline,
      sampleSize: f.backtest.sampleSize,
    },
    source: f.source,
    createdAt: f.createdAt instanceof Date ? f.createdAt.toISOString() : String(f.createdAt),
  };
}

/**
 * GET /api/dashboard/summary
 * Returns the latest forecast and decision for the organisation, or null if empty.
 * Minimum required role: viewer.
 */
export const GET = withAuth(
  async function getDashboardSummaryRoute(
    _request: NextRequest,
    authContext: OrgAuthContext
  ): Promise<NextResponse> {
    try {
      // 1. Fetch latest decision (bounded query limit 1)
      const decisions = await decisionsRepo.list(authContext.orgId, { limit: 1 });
      const latestDecision = decisions.length > 0 ? decisions[0] : null;

      // 2. Fetch latest forecast (bounded query limit 1)
      let latestForecast: ForecastRecord | null = null;
      if (latestDecision && latestDecision.forecastId && latestDecision.forecastId !== "none") {
        latestForecast = await forecastsRepo.get(authContext.orgId, latestDecision.forecastId);
      }
      if (!latestForecast) {
        const forecasts = await forecastsRepo.list(authContext.orgId, { limit: 1 });
        latestForecast = forecasts.length > 0 ? forecasts[0] : null;
      }

      // 3. Fetch recent hourly actuals if available (last 24 hours)
      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      let actuals: Array<{ hour: string; netMinor: string }> = [];
      try {
        const buckets = await seriesRepo.listRange(authContext.orgId, oneDayAgo, now, { limit: 24 });
        actuals = buckets.map((b) => ({
          hour: b.hourStart instanceof Date ? b.hourStart.toISOString() : String(b.hourStart),
          netMinor: (b.inFlow.amountMinor - b.outFlow.amountMinor).toString(),
        }));
      } catch {
        // Series read fallback (empty actuals)
        actuals = [];
      }

      const payload: DashboardSummaryPayload = {
        decision: latestDecision ? serializeDecision(latestDecision) : null,
        forecast: latestForecast ? serializeForecast(latestForecast) : null,
        actuals,
        userRole: authContext.role,
      };

      return NextResponse.json({
        ok: true,
        data: payload,
      });
    } catch (error) {
      console.error("[getDashboardSummaryRoute Error]:", error);
      return createErrorResponse(500, "INTERNAL", "An unexpected internal server error occurred.");
    }
  },
  { minRole: "viewer" }
);
