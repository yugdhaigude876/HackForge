/**
 * Pure adapters that turn streamed ticks into the shapes the existing pages consume.
 * No React, no I/O. Money stays bigint (minor units) or decimal strings.
 */

import type { StreamTick } from "@/engine/live-tick";
import type {
  NormalizedReplayResult,
  NormalizedTimelineFrame,
  NormalizedMoney,
} from "@/hooks/use-replay-simulation";
import type { TimelineSimulationSummary } from "@/engine/simulator";
import type { TierLiquidationOrder } from "@/engine/treasury-vaults";
import { Money } from "@/engine/money";
import type { DashboardSummaryPayload } from "@/hooks/use-dashboard-data";

const usd = (minor: string): NormalizedMoney => ({ amountMinor: BigInt(minor), currency: "USD" });
const ZERO: NormalizedMoney = { amountMinor: 0n, currency: "USD" };

export type AuditLogType = "SWEEP" | "MATURITY" | "LIQUIDATION" | "OVERDRAFT" | "INFO";

export function classifyEvent(message: string): AuditLogType {
  if (message.startsWith("Surplus swept")) return "SWEEP";
  if (message.startsWith("Overnight Repo matured")) return "MATURITY";
  if (message.startsWith("Liquidation Cascade")) return "LIQUIDATION";
  if (message.startsWith("Emergency Overdraft")) return "OVERDRAFT";
  return "INFO";
}

function liquidationOrders(tick: StreamTick): TierLiquidationOrder[] {
  return tick.liquidations.map((l) => ({
    tierId: l.tierId as TierLiquidationOrder["tierId"],
    tierName: l.tierName,
    grossLiquidated: Money.fromMinor(BigInt(l.grossMinor), "USD"),
    haircutRatePct: l.haircutPct,
    penaltyPaid: Money.fromMinor(BigInt(l.penaltyMinor), "USD"),
    netRecoveredCash: Money.fromMinor(BigInt(l.netMinor), "USD"),
    settlementLagHours: 0,
  }));
}

export function tickToFrame(tick: StreamTick): NormalizedTimelineFrame {
  const p = tick.portfolio;
  return {
    hourIndex: tick.hourIndex,
    hour: tick.hourIndex,
    timestamp: tick.timestamp,
    depositsUsd: tick.depositsUsd,
    withdrawalsUsd: tick.withdrawalsUsd,
    netFlowUsd: tick.netFlowUsd,
    liquidityStatus: tick.status,
    events: tick.events,
    liquidations: liquidationOrders(tick),
    requiredReserveMinor: BigInt(tick.reserveMinor),
    deployableSurplusMinor: BigInt(tick.surplusMinor),
    portfolio: {
      hourIndex: tick.hourIndex,
      timestamp: tick.timestamp,
      tier0Cash: usd(p.tier0CashMinor),
      tier1RepoPrincipal: usd(p.tier1RepoPrincipalMinor),
      tier1RepoAccruedYield: usd(p.tier1AccruedYieldMinor),
      tier1IsActive: p.tier1IsActive,
      tier2BondsMarketValue: usd(p.tier2BondsMarketValueMinor),
      tier2BondsParValue: ZERO,
      tier2BondsPriceIndex: p.tier2PriceIndex,
      tier2BondsAccruedYield: ZERO,
      tier3EquitiesMarketValue: usd(p.tier3EquitiesMarketValueMinor),
      tier3EquitiesCostBasis: ZERO,
      tier3EquitiesIndexPrice: p.tier3IndexPrice,
      tier3PeakMarketValue: ZERO,
      tier3DrawdownPct: p.tier3DrawdownPct,
      emergencyOverdraftBalance: usd(p.overdraftBalanceMinor),
      totalAssets: usd(p.totalAssetsMinor),
      cumulativeGrossYieldEarned: usd(p.cumulativeGrossYieldMinor),
      cumulativePenaltiesPaid: usd(p.cumulativePenaltiesMinor),
      cumulativeOverdraftInterestPaid: usd(p.cumulativeOverdraftInterestMinor),
    },
  };
}

/**
 * Builds the replay-shaped result the dashboard already knows how to render, from the streamed
 * window of ticks (oldest first). The summary only contains values that can be derived from the
 * window itself.
 */
export function ticksToReplayResult(ticks: readonly StreamTick[]): NormalizedReplayResult | null {
  if (ticks.length === 0) return null;
  const frames = ticks.map(tickToFrame);
  const first = ticks[0];
  const last = ticks[ticks.length - 1];

  const auditLogs = ticks.flatMap((t) =>
    t.events.map((message) => ({
      hour: t.hourIndex,
      timestamp: t.timestamp,
      message,
      type: classifyEvent(message),
    }))
  );

  const firstAssets = BigInt(first.portfolio.totalAssetsMinor);
  const lastAssets = BigInt(last.portfolio.totalAssetsMinor);
  const pnl = lastAssets - firstAssets;
  const hours = ticks.length;
  const annualised = firstAssets > 0n ? (Number(pnl) / Number(firstAssets)) * (8760 / hours) * 100 : 0;
  const overdraftHours = ticks.filter((t) => BigInt(t.portfolio.overdraftBalanceMinor) > 0n).length;
  const maxOverdraft = ticks.reduce((m, t) => {
    const v = BigInt(t.portfolio.overdraftBalanceMinor);
    return v > m ? v : m;
  }, 0n);

  const summary: TimelineSimulationSummary = {
    policy: "reserve-juggler",
    totalHoursSimulated: hours,
    startHour: first.hourIndex,
    startTimestamp: first.timestamp,
    endTimestamp: last.timestamp,
    initialCashUsd: Number(firstAssets) / 100,
    finalNetAssetsUsd: Number(lastAssets) / 100,
    netPnlUsd: Number(pnl) / 100,
    annualizedNetReturnPct: Math.round(annualised * 100) / 100,
    grossYieldEarnedUsd: Number(BigInt(last.portfolio.cumulativeGrossYieldMinor)) / 100,
    penaltiesPaidUsd: Number(BigInt(last.portfolio.cumulativePenaltiesMinor)) / 100,
    overdraftInterestPaidUsd: Number(BigInt(last.portfolio.cumulativeOverdraftInterestMinor)) / 100,
    shortfallEventsCount: ticks.filter((t) => t.liquidations.length > 0).length,
    overdraftHoursCount: overdraftHours,
    maxOverdraftDrawnUsd: Number(maxOverdraft) / 100,
    maxTier3DrawdownPct: Math.max(...ticks.map((t) => t.portfolio.tier3DrawdownPct)),
  };

  return { summary, frames, auditLogs };
}

/** Last N hours of net flow in minor units, for the forecast chart's history. */
export function ticksToActuals(ticks: readonly StreamTick[], n = 24): Array<{ hour: string; netMinor: string }> {
  return ticks.slice(-n).map((t) => ({
    hour: t.timestamp,
    netMinor: Math.round(t.netFlowUsd * 100).toString(),
  }));
}

/** Notifications derived from real stream events, newest first. */
export interface LiveNotification {
  id: string;
  hourIndex: number;
  timestamp: string;
  type: AuditLogType | "STATUS";
  message: string;
}

export function ticksToNotifications(ticks: readonly StreamTick[], max = 30): LiveNotification[] {
  const out: LiveNotification[] = [];
  for (let i = 0; i < ticks.length; i++) {
    const t = ticks[i];
    const prev = i > 0 ? ticks[i - 1] : null;
    if (prev && prev.status !== t.status) {
      out.push({
        id: `status-${t.hourIndex}`,
        hourIndex: t.hourIndex,
        timestamp: t.timestamp,
        type: "STATUS",
        message: `Solvency status changed from ${prev.status} to ${t.status}`,
      });
    }
    t.events.forEach((message, idx) =>
      out.push({
        id: `event-${t.hourIndex}-${idx}`,
        hourIndex: t.hourIndex,
        timestamp: t.timestamp,
        type: classifyEvent(message),
        message,
      })
    );
  }
  return out.slice(-max).reverse();
}
/**
 * Builds the dashboard summary payload (decision, forecast, actuals) from the streamed window.
 * Used by `useDashboardData` so Reserve, Optimizer and other pages update live.
 * Accuracy values that are not yet measurable stay null; nothing is invented.
 */
export function ticksToDashboardPayload(
  ticks: readonly StreamTick[],
  orgId: string,
  userRole: string
): DashboardSummaryPayload | null {
  if (ticks.length === 0) return null;
  const latest = ticks[ticks.length - 1];
  const createdAt = new Date(latest.createdAtMs).toISOString();
  const acc = latest.accuracy;

  const expectedCumulative = latest.forecast.points.reduce((s, p) => s + BigInt(p.meanMinor), 0n);

  return {
    decision: {
      id: `dataset-h${latest.hourIndex}`,
      orgId,
      forecastId: `dataset-h${latest.hourIndex}`,
      confidence: latest.confidence,
      reserveMinor: latest.reserveMinor,
      surplusMinor: latest.surplusMinor,
      availableCashMinor: latest.availableCashMinor,
      deployedTotalMinor: latest.deployedTotalMinor,
      operationalFloorMinor: latest.operationalFloorMinor,
      horizonHours: latest.horizonHours,
      alpha: latest.alpha,
      expectedCumulativeFlowMinor: expectedCumulative.toString(),
      worstCaseResidualShortfallMinor: "0",
      backtest: acc.mase === null ? null : { mase: acc.mase, sampleSize: acc.sampleSize },
      allocations: latest.allocations.map((a) => ({
        instrumentId: a.instrumentId,
        name: a.name,
        amountMinor: a.amountMinor,
        annualRateBps: a.annualRateBps,
        settlementLagHours: a.settlementLagHours,
        penaltyBps: a.penaltyBps,
        capacityMinor: a.amountMinor,
      })),
      status: latest.status,
      expectedNetYieldMinor: latest.expectedNetYieldMinor,
      explanation: latest.explanation,
      source: "dataset",
      createdAt,
      createdBy: "dataset-clock",
    },
    forecast: {
      id: `dataset-h${latest.hourIndex}`,
      orgId,
      method: latest.forecast.method,
      asOf: latest.forecast.asOf,
      horizon: latest.forecast.horizon,
      points: latest.forecast.points,
      backtest: {
        mase: acc.mase,
        pinball: null,
        skillVsBaseline: acc.skillVsSeasonalNaive ?? undefined,
        sampleSize: acc.sampleSize,
      },
      source: "dataset",
      createdAt,
    },
    actuals: ticksToActuals(ticks, 24),
    userRole,
  };
}

// ---------------------------------------------------------------------------
// Forecast page
// ---------------------------------------------------------------------------

type SkillEntry = { skill: number | null; isBetter: boolean; reason?: string };
type ModelScore = {
  name: string;
  maeMinor: number | null;
  maeDollars: number | null;
  mase: number | null;
  pinballLoss: number | null;
  reason?: string;
};

export interface LiveForecastAnalytics {
  forecastId: string;
  source: "dataset";
  asOf: string;
  seed: null;
  method: string;
  windowCount: number;
  evaluation: {
    windowCount: number;
    horizonHours: number;
    tau: number;
    model: ModelScore;
    naive: ModelScore;
    seasonalNaive: ModelScore;
    skillScores: {
      vsNaive: { mase: SkillEntry; pinball: SkillEntry; mae: SkillEntry };
      vsSeasonalNaive: { mase: SkillEntry; pinball: SkillEntry; mae: SkillEntry };
    };
    reason?: string;
  } | null;
  residualQuantiles: null;
  reason?: string;
}

const NOT_SCORED = "Not scored in the realtime stream.";

/**
 * Forecast analytics for the Forecast page, from the latest streamed hour. Values are the
 * out-of-sample one-step errors tracked by the clock service. Anything not measured stays null
 * with a reason; nothing is estimated.
 */
export function tickToForecastAnalytics(tick: StreamTick): LiveForecastAnalytics {
  const acc = tick.accuracy;
  const base = {
    forecastId: `dataset-h${tick.hourIndex}`,
    source: "dataset" as const,
    asOf: tick.forecast.asOf,
    seed: null,
    method: tick.forecast.method,
    windowCount: acc.sampleSize,
    residualQuantiles: null,
  };

  if (acc.mase === null || acc.maeMinor === null || acc.seasonalNaiveMaeMinor === null) {
    return { ...base, evaluation: null, reason: acc.reason };
  }

  const none: SkillEntry = { skill: null, isBetter: false, reason: NOT_SCORED };
  const maeSkill = acc.seasonalNaiveMaeMinor > 0 ? 1 - acc.maeMinor / acc.seasonalNaiveMaeMinor : null;
  const unscored: ModelScore = {
    name: "Naive (flat line)",
    maeMinor: null,
    maeDollars: null,
    mase: null,
    pinballLoss: null,
    reason: "Flat-line naive is not scored in the realtime stream.",
  };

  return {
    ...base,
    evaluation: {
      windowCount: acc.sampleSize,
      horizonHours: tick.horizonHours,
      tau: 0.95,
      model: {
        name: tick.forecast.method,
        maeMinor: acc.maeMinor,
        maeDollars: acc.maeMinor / 100,
        mase: acc.mase,
        pinballLoss: null,
        reason: "Pinball loss is not scored in the realtime stream.",
      },
      naive: unscored,
      seasonalNaive: {
        name: "Seasonal Naive (168 h lag)",
        maeMinor: acc.seasonalNaiveMaeMinor,
        maeDollars: acc.seasonalNaiveMaeMinor / 100,
        mase: 1,
        pinballLoss: null,
      },
      skillScores: {
        vsNaive: { mase: none, pinball: none, mae: none },
        vsSeasonalNaive: {
          mase: { skill: acc.skillVsSeasonalNaive, isBetter: acc.mase < 1 },
          pinball: none,
          mae: { skill: maeSkill, isBetter: maeSkill !== null && maeSkill > 0 },
        },
      },
    },
  };
}

export interface ForecastChartPoint {
  hour: string;
  mean: number | null;
  bandLower: number | null;
  bandUpper: number | null;
  bandRange: [number, number] | null;
  actual: number | null;
}

/** Last 24 actual hours followed by the 24 h forecast with its band, in dollars. */
export function ticksToForecastChart(ticks: readonly StreamTick[]): ForecastChartPoint[] {
  if (ticks.length === 0) return [];
  const latest = ticks[ticks.length - 1];
  const label = (iso: string) => iso.slice(5, 16).replace("T", " ");
  const history: ForecastChartPoint[] = ticks.slice(-24).map((t) => ({
    hour: label(t.timestamp),
    mean: null,
    bandLower: null,
    bandUpper: null,
    bandRange: null,
    actual: t.netFlowUsd,
  }));
  const future: ForecastChartPoint[] = latest.forecast.points.map((p) => {
    const mean = Number(p.meanMinor) / 100;
    const lower = p.bandLowerMinor !== undefined ? Number(p.bandLowerMinor) / 100 : null;
    const upper = p.bandUpperMinor !== undefined ? Number(p.bandUpperMinor) / 100 : null;
    return {
      hour: label(p.ts),
      mean,
      bandLower: lower,
      bandUpper: upper,
      bandRange: lower !== null && upper !== null ? [lower, upper] : null,
      actual: null,
    };
  });
  return [...history, ...future];
}