/**
 * Reserve Juggler - Live Tick Document (pure, I/O-free, client-safe types)
 *
 * One `StreamTick` is written per dataset hour by the clock service and listened to by the
 * browser. It carries everything the pages need for that hour: the treasury snapshot, the
 * reserve decision, a 24 h forecast with an uncertainty band, forecast accuracy against a
 * seasonal-naive baseline, and the events that happened. All money is a decimal string of
 * minor units (cents).
 *
 * Forecast accuracy is measured out of sample: before each hour is applied, the forecaster
 * predicts that hour from earlier history only, and the absolute error is recorded.
 */

import { Money } from "@/engine/money";
import { HourOfWeekSmoothingForecaster } from "@/engine/forecast";
import { calculateQuantile } from "@/engine/reserve";
import type { HourlyBucket } from "@/engine/models";
import type { TimelineFrame, TreasuryEngineState } from "@/engine/treasury-step";
import type { TreasuryHourRecord } from "@/engine/dataset";

export const STREAM_SOURCE = "dataset" as const;
export const FORECAST_HORIZON_HOURS = 24;
export const ACCURACY_WINDOW = 168;
export const SEASONAL_LAG_HOURS = 168;
export const MIN_ERRORS_FOR_ACCURACY = 24;

/** Rolling out-of-sample error tracker persisted with the engine state. */
export interface AccuracyTracker {
  /** |actual - forecast| in minor units, newest last, at most ACCURACY_WINDOW entries */
  modelAbsErrorsMinor: number[];
  /** |actual - same hour last week| in minor units, aligned with the model errors */
  seasonalAbsErrorsMinor: number[];
}

export function emptyAccuracyTracker(): AccuracyTracker {
  return { modelAbsErrorsMinor: [], seasonalAbsErrorsMinor: [] };
}

/**
 * Records the out-of-sample one-step error for the hour about to be applied.
 * `historyBefore` must NOT include the hour being applied.
 */
export function recordOneStepError(
  tracker: AccuracyTracker,
  historyBefore: readonly HourlyBucket[],
  actualNetMinor: bigint
): void {
  if (historyBefore.length < 24) return;
  const forecaster = new HourOfWeekSmoothingForecaster({ mode: "ewma", lambda: 0.3 });
  const predicted = forecaster.predict(historyBefore, 1)[0].amountMinor;
  const modelErr = Math.abs(Number(actualNetMinor - predicted));

  let seasonalErr: number | null = null;
  if (historyBefore.length >= SEASONAL_LAG_HOURS) {
    const lagged = historyBefore[historyBefore.length - SEASONAL_LAG_HOURS].netFlow.amountMinor;
    seasonalErr = Math.abs(Number(actualNetMinor - lagged));
  }

  if (seasonalErr === null) return; // only score hours where the baseline is defined, so both use the same sample
  tracker.modelAbsErrorsMinor.push(modelErr);
  tracker.seasonalAbsErrorsMinor.push(seasonalErr);
  if (tracker.modelAbsErrorsMinor.length > ACCURACY_WINDOW) {
    tracker.modelAbsErrorsMinor.shift();
    tracker.seasonalAbsErrorsMinor.shift();
  }
}

export interface TickAccuracy {
  /** Mean absolute error of the model, minor units */
  maeMinor: number | null;
  /** Mean absolute error of the seasonal-naive baseline over the same hours, minor units */
  seasonalNaiveMaeMinor: number | null;
  /** maeMinor / seasonalNaiveMaeMinor. Below 1 means the model beat the baseline. */
  mase: number | null;
  /** 1 - mase. Positive means better than the baseline. */
  skillVsSeasonalNaive: number | null;
  sampleSize: number;
  method: string;
  reason?: string;
}

export function computeAccuracy(tracker: AccuracyTracker): TickAccuracy {
  const n = tracker.modelAbsErrorsMinor.length;
  const method = `rolling one-step-ahead, out of sample, last ${ACCURACY_WINDOW} hours, scaled by seasonal naive (${SEASONAL_LAG_HOURS} h lag)`;
  if (n < MIN_ERRORS_FOR_ACCURACY) {
    return {
      maeMinor: null,
      seasonalNaiveMaeMinor: null,
      mase: null,
      skillVsSeasonalNaive: null,
      sampleSize: n,
      method,
      reason: `Needs ${MIN_ERRORS_FOR_ACCURACY} scored hours (history of ${SEASONAL_LAG_HOURS + 24}+ hours); have ${n}.`,
    };
  }
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const mae = mean(tracker.modelAbsErrorsMinor);
  const seasonal = mean(tracker.seasonalAbsErrorsMinor);
  if (!(seasonal > 0)) {
    return {
      maeMinor: Math.round(mae),
      seasonalNaiveMaeMinor: 0,
      mase: null,
      skillVsSeasonalNaive: null,
      sampleSize: n,
      method,
      reason: "Seasonal-naive baseline error is zero, so a ratio is undefined.",
    };
  }
  const mase = mae / seasonal;
  return {
    maeMinor: Math.round(mae),
    seasonalNaiveMaeMinor: Math.round(seasonal),
    mase,
    skillVsSeasonalNaive: 1 - mase,
    sampleSize: n,
    method,
  };
}

export interface TickForecastPoint {
  ts: string;
  meanMinor: string;
  bandLowerMinor?: string;
  bandUpperMinor?: string;
}

export interface TickAllocation {
  instrumentId: string;
  name: string;
  amountMinor: string;
  annualRateBps: number;
  settlementLagHours: number;
  penaltyBps: number;
}

export interface TickLiquidation {
  tierId: string;
  tierName: string;
  grossMinor: string;
  penaltyMinor: string;
  netMinor: string;
  haircutPct: number;
}

export interface TickPortfolio {
  tier0CashMinor: string;
  tier1RepoPrincipalMinor: string;
  tier1AccruedYieldMinor: string;
  tier1IsActive: boolean;
  tier2BondsMarketValueMinor: string;
  tier3EquitiesMarketValueMinor: string;
  overdraftBalanceMinor: string;
  totalAssetsMinor: string;
  cumulativeGrossYieldMinor: string;
  cumulativePenaltiesMinor: string;
  cumulativeOverdraftInterestMinor: string;
  tier2PriceIndex: number;
  tier3IndexPrice: number;
  tier3DrawdownPct: number;
}

export interface StreamTick {
  hourIndex: number;
  /** Dataset timestamp (UTC) of this hour, e.g. "2026-01-02T17:00:00Z" */
  timestamp: string;
  source: typeof STREAM_SOURCE;
  depositsUsd: number;
  withdrawalsUsd: number;
  netFlowUsd: number;
  repoSweepWindowOpen: boolean;
  repoSweepMature: boolean;
  status: "HEALTHY" | "UNDER_RESERVED" | "LOW_CONFIDENCE";
  confidence: number;
  alpha: number;
  horizonHours: number;
  reserveMinor: string;
  surplusMinor: string;
  availableCashMinor: string;
  deployedTotalMinor: string;
  operationalFloorMinor: string;
  expectedNetYieldMinor: string;
  explanation: string;
  portfolio: TickPortfolio;
  allocations: TickAllocation[];
  events: string[];
  liquidations: TickLiquidation[];
  forecast: {
    asOf: string;
    horizon: number;
    method: string;
    bandMethod: string;
    points: TickForecastPoint[];
  };
  accuracy: TickAccuracy;
  createdAtMs: number;
}

const m = (v: Money): string => v.amountMinor.toString();

export interface BuildTickInput {
  frame: TimelineFrame;
  record: TreasuryHourRecord;
  state: TreasuryEngineState;
  tracker: AccuracyTracker;
  operationalFloor: Money;
  alpha: number;
  nowMs: number;
}

function explain(frame: TimelineFrame, tier0: Money, reserve: Money, surplus: Money): string {
  const cash = tier0.format();
  const res = reserve.format();
  switch (frame.liquidityStatus) {
    case "HEALTHY":
      return `Tier 0 cash ${cash} covers the required reserve ${res}. Deployable surplus ${surplus.format()} is eligible for the 17:00 UTC sweep.`;
    case "UNDER_RESERVED":
      return `Tier 0 cash ${cash} is below the required reserve ${res}. No surplus is deployed until cash is restored above the reserve.`;
    default:
      return `Not enough history for a full forecast. A conservative reserve of ${res} is held until 24 hours of data are available.`;
  }
}

/** Builds the document written for one applied dataset hour. Pure. */
export function buildStreamTick(input: BuildTickInput): StreamTick {
  const { frame, record, state, tracker, operationalFloor, alpha, nowMs } = input;
  const p = frame.portfolio;
  const reserve = Money.fromMinor(BigInt(frame.requiredReserveMinor), "USD");
  const surplus = Money.fromMinor(BigInt(frame.deployableSurplusMinor), "USD");
  const deployed = p.tier1RepoPrincipal.add(p.tier2BondsMarketValue).add(p.tier3EquitiesMarketValue);

  // 24 h forecast from the history that now includes this hour
  const forecaster = new HourOfWeekSmoothingForecaster({ mode: "ewma", lambda: 0.3 });
  const history = state.historyBuckets;
  const points: TickForecastPoint[] = [];
  if (history.length >= 24) {
    const preds = forecaster.predict(history, FORECAST_HORIZON_HOURS);
    const lastStart = history[history.length - 1].hourStart.getTime();
    const residuals = state.residualHistory;
    let lowMinor = 0;
    let highMinor = 0;
    const hasBand = residuals.length >= 20;
    if (hasBand) {
      lowMinor = Math.round(calculateQuantile(residuals, 0.05) * 100);
      highMinor = Math.round(calculateQuantile(residuals, 0.95) * 100);
    }
    preds.forEach((pred, i) => {
      const ts = new Date(lastStart + (i + 1) * 3_600_000).toISOString().replace(".000Z", "Z");
      points.push({
        ts,
        meanMinor: pred.amountMinor.toString(),
        ...(hasBand
          ? {
              bandLowerMinor: (pred.amountMinor + BigInt(lowMinor)).toString(),
              bandUpperMinor: (pred.amountMinor + BigInt(highMinor)).toString(),
            }
          : {}),
      });
    });
  }

  const allocations: TickAllocation[] = [
    {
      instrumentId: "tier1_repo",
      name: "Tier 1: Overnight Repo",
      amountMinor: m(p.tier1RepoPrincipal),
      annualRateBps: Math.round(record.tier1_repo_rate_apy * 100),
      settlementLagHours: 0,
      penaltyBps: Math.round(record.tier1_early_redemption_haircut_pct * 100),
    },
    {
      instrumentId: "tier2_bonds",
      name: "Tier 2: 2Y Sovereign Debt",
      amountMinor: m(p.tier2BondsMarketValue),
      annualRateBps: Math.round(record.tier2_bond_yield_pct * 100),
      settlementLagHours: 1,
      penaltyBps: Math.round(record.tier2_bond_liquidation_haircut_pct * 100),
    },
    {
      instrumentId: "tier3_equities",
      name: "Tier 3: Growth Equities",
      amountMinor: m(p.tier3EquitiesMarketValue),
      annualRateBps: 1000,
      settlementLagHours: 2,
      penaltyBps: Math.round(record.tier3_stock_liquidation_haircut_pct * 100),
    },
  ];

  return {
    hourIndex: frame.hourIndex,
    timestamp: frame.timestamp,
    source: STREAM_SOURCE,
    depositsUsd: record.deposits_usd,
    withdrawalsUsd: record.withdrawals_usd,
    netFlowUsd: record.net_flow_usd,
    repoSweepWindowOpen: record.repo_sweep_window_open,
    repoSweepMature: record.repo_sweep_mature,
    status: frame.liquidityStatus,
    confidence: 1 - alpha,
    alpha,
    horizonHours: FORECAST_HORIZON_HOURS,
    reserveMinor: frame.requiredReserveMinor,
    surplusMinor: frame.deployableSurplusMinor,
    availableCashMinor: m(p.tier0Cash),
    deployedTotalMinor: m(deployed),
    operationalFloorMinor: m(operationalFloor),
    expectedNetYieldMinor: m(p.cumulativeGrossYieldEarned),
    explanation: explain(frame, p.tier0Cash, reserve, surplus),
    portfolio: {
      tier0CashMinor: m(p.tier0Cash),
      tier1RepoPrincipalMinor: m(p.tier1RepoPrincipal),
      tier1AccruedYieldMinor: m(p.tier1RepoAccruedYield),
      tier1IsActive: p.tier1IsActive,
      tier2BondsMarketValueMinor: m(p.tier2BondsMarketValue),
      tier3EquitiesMarketValueMinor: m(p.tier3EquitiesMarketValue),
      overdraftBalanceMinor: m(p.emergencyOverdraftBalance),
      totalAssetsMinor: m(p.totalAssets),
      cumulativeGrossYieldMinor: m(p.cumulativeGrossYieldEarned),
      cumulativePenaltiesMinor: m(p.cumulativePenaltiesPaid),
      cumulativeOverdraftInterestMinor: m(p.cumulativeOverdraftInterestPaid),
      tier2PriceIndex: p.tier2BondsPriceIndex,
      tier3IndexPrice: p.tier3EquitiesIndexPrice,
      tier3DrawdownPct: p.tier3DrawdownPct,
    },
    allocations,
    events: frame.events,
    liquidations: frame.liquidations.map((o) => ({
      tierId: o.tierId,
      tierName: o.tierName,
      grossMinor: m(o.grossLiquidated),
      penaltyMinor: m(o.penaltyPaid),
      netMinor: m(o.netRecoveredCash),
      haircutPct: o.haircutRatePct,
    })),
    forecast: {
      asOf: frame.timestamp,
      horizon: FORECAST_HORIZON_HOURS,
      method: "Hour-of-Week Smoothing (EWMA, lambda 0.3)",
      bandMethod: "empirical 5%/95% quantiles of recent one-step residuals, applied uniformly to every forecast hour",
      points,
    },
    accuracy: computeAccuracy(tracker),
    createdAtMs: nowMs,
  };
}
