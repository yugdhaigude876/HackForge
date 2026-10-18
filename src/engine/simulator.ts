/**
 * Reserve Juggler - Timeline Replay & 4-Tier Simulation Runner
 *
 * Implements the chronological timeline runner capable of stepping through the
 * official 8,760-hour benchmark treasury dataset.
 *
 * For each hour:
 * 1. Ingests deposits and withdrawals (with optional stress shock multipliers).
 * 2. Accrues hourly interest and mark-to-market valuations across all 4 tiers.
 * 3. At 08:00 UTC, matures overnight repo releasing principal and earned interest.
 * 4. Processes net customer cash flows, executing the 5-tier cascading liquidation
 *    if cash is insufficient.
 * 5. Evaluates rolling-origin forecaster and Basel III dynamic reserve requirements.
 * 6. At 17:00 UTC, sweeps deployable surplus into Tier 1 Repo, Sovereign Debt, and Equities.
 * 7. Records detailed audit events and timeline snapshots for interactive UI scrubbers.
 */


import { Money } from "@/engine/money";
import { TreasuryHourRecord, loadTreasuryDataset } from "@/engine/dataset";
import { TierLiquidationOrder } from "@/engine/treasury-vaults";
import {
  DEFAULT_ALLOCATION_WEIGHTS,
  applyStressShocks,
  createTreasuryState,
  stepTreasury,
  type TimelineAuditLog,
  type TimelineFrame,
  type TimelinePolicy,
} from "@/engine/treasury-step";

export type { TimelineFrame, TimelinePolicy } from "@/engine/treasury-step";
export type { TierLiquidationOrder };

export interface TimelineSimulatorOptions {
  /** Optional custom dataset; defaults to the 8,760-hour benchmark dataset */
  dataset?: TreasuryHourRecord[];

  /** Starting hour index within the dataset (0 to 8759, default 0) */
  startHour?: number;

  /** Number of hours to simulate (default 168, max 8760) */
  maxHours?: number;

  /** Initial cash endowment in Tier 0 (default $50,000,000 USD) */
  initialCash?: Money;

  /** Baseline operational floor F (default $5,000,000 USD) */
  operationalFloor?: Money;

  /** Forecast horizon in hours H (default 24) */
  horizonHours?: number;

  /** Confidence level alpha for quantile reserve (default 0.01 for 99% coverage) */
  alpha?: number;

  /** Outflow shock percentage (0% to 50%, multiplies withdrawals) */
  outflowShockPct?: number;

  /** Settlement delay in hours for Tier 2 bond liquidations (0 to 72) */
  settlementLagHours?: number;

  /** Market interest rate shift in basis points (-300 to +300 bps) */
  rateShiftBps?: number;

  /** Market equity drawdown shock (0% to 50% drop) */
  equityDrawdownShockPct?: number;

  /** Allocation weights for deployable surplus across tiers (default: 50% repo, 35% bonds, 15% equities) */
  targetWeights?: {
    repoPct: number;
    bondsPct: number;
    equitiesPct: number;
  };

  /** Treasury management policy benchmark */
  policy?: TimelinePolicy;
}

export interface TimelineSimulationSummary {
  policy: TimelinePolicy;
  totalHoursSimulated: number;
  startHour: number;
  startTimestamp: string;
  endTimestamp: string;
  initialCashUsd: number;
  finalNetAssetsUsd: number;
  netPnlUsd: number;
  annualizedNetReturnPct: number;
  grossYieldEarnedUsd: number;
  penaltiesPaidUsd: number;
  overdraftInterestPaidUsd: number;
  shortfallEventsCount: number;
  overdraftHoursCount: number;
  maxOverdraftDrawnUsd: number;
  maxTier3DrawdownPct: number;
}


export interface TimelineSimulationResult {
  summary: TimelineSimulationSummary;
  frames: TimelineFrame[];
  auditLogs: TimelineAuditLog[];
}

/**
 * Runs a continuous timeline simulation across the benchmark treasury dataset.
 * Each hour is processed by the shared pure stepTreasury function, which the realtime
 * clock service also uses, so batch and streamed runs are identical.
 */
export function runTimelineSimulation(
  options: TimelineSimulatorOptions = {}
): TimelineSimulationResult {
  const dataset = options.dataset ?? loadTreasuryDataset();
  const startHour = Math.max(0, options.startHour ?? 0);
  const totalAvailable = dataset.length;
  const maxHours = Math.min(
    totalAvailable - startHour,
    Math.max(1, options.maxHours ?? 168)
  );

  const initialCash = options.initialCash ?? Money.fromDecimal(50_000_000, "USD");
  const operationalFloor = options.operationalFloor ?? Money.fromDecimal(5_000_000, "USD");
  const horizonHours = Math.max(1, options.horizonHours ?? 24);
  const alpha = options.alpha ?? 0.01;
  const policy: TimelinePolicy = options.policy ?? "reserve-juggler";

  const weights = options.targetWeights ?? DEFAULT_ALLOCATION_WEIGHTS;

  const state = createTreasuryState(initialCash);
  const ctx = { policy, operationalFloor, horizonHours, alpha, weights };

  const frames: TimelineFrame[] = [];
  const auditLogs: TimelineAuditLog[] = [];

  const initialAssets = state.portfolio.getTotalNetAssets();

  for (let step = 0; step < maxHours; step++) {
    const hourIndex = startHour + step;
    const rawRecord = dataset[hourIndex];

    // Apply stress shocks to record copy
    const record: TreasuryHourRecord = applyStressShocks(rawRecord, options);

    const result = stepTreasury(state, record, hourIndex, ctx);
    frames.push(result.frame);
    auditLogs.push(...result.auditLogs);
  }

  const portfolio = state.portfolio;
  const finalAssets = portfolio.getTotalNetAssets();
  const netPnl = finalAssets.subtract(initialAssets);
  const annualizedNetReturnPct =
    Number(initialAssets.amountMinor) > 0
      ? (Number(netPnl.amountMinor) / Number(initialAssets.amountMinor)) *
        (8760 / maxHours) *
        100
      : 0;

  const summary: TimelineSimulationSummary = {
    policy,
    totalHoursSimulated: maxHours,
    startHour,
    startTimestamp: dataset[startHour].timestamp,
    endTimestamp: dataset[startHour + maxHours - 1].timestamp,
    initialCashUsd: initialAssets.toDecimal(),
    finalNetAssetsUsd: finalAssets.toDecimal(),
    netPnlUsd: netPnl.toDecimal(),
    annualizedNetReturnPct: Math.round(annualizedNetReturnPct * 100) / 100,
    grossYieldEarnedUsd: portfolio.cumulativeGrossYieldEarned.toDecimal(),
    penaltiesPaidUsd: portfolio.cumulativePenaltiesPaid.toDecimal(),
    overdraftInterestPaidUsd: portfolio.cumulativeOverdraftInterestPaid.toDecimal(),
    shortfallEventsCount: state.shortfallEventsCount,
    overdraftHoursCount: state.overdraftHoursCount,
    maxOverdraftDrawnUsd: state.maxOverdraftDrawn.toDecimal(),
    maxTier3DrawdownPct: Math.round(
      portfolio.getSnapshot(startHour + maxHours - 1, "").tier3DrawdownPct * 100
    ) / 100,
  };

  return { summary, frames, auditLogs };
}
