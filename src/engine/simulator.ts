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
import {
  TreasuryHourRecord,
  loadTreasuryDataset,
  treasuryRecordToHourlyBucket,
} from "@/engine/dataset";
import { HourlyBucket } from "@/engine/models";
import {
  TreasuryPortfolio,
  TreasurySnapshot,
  TierLiquidationOrder,
} from "@/engine/treasury-vaults";
import {
  HourOfWeekSmoothingForecaster,
} from "@/engine/forecast";
import {
  computeRequiredReserve,
  calculateQuantile,
} from "@/engine/reserve";

export type TimelinePolicy = "reserve-juggler" | "hold-all-cash" | "fixed-buffer";

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

export interface TimelineFrame {
  hourIndex: number;
  timestamp: string;
  depositsUsd: number;
  withdrawalsUsd: number;
  netFlowUsd: number;
  portfolio: TreasurySnapshot;
  requiredReserveMinor: string;
  deployableSurplusMinor: string;
  liquidityStatus: "HEALTHY" | "UNDER_RESERVED" | "LOW_CONFIDENCE";
  events: string[];
  liquidations: TierLiquidationOrder[];
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
  auditLogs: { hour: number; timestamp: string; message: string; type: "SWEEP" | "MATURITY" | "LIQUIDATION" | "OVERDRAFT" | "INFO" }[];
}

/**
 * Runs a continuous timeline simulation across the benchmark treasury dataset.
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

  const outflowShockMultiplier = 1.0 + Math.max(0, options.outflowShockPct ?? 0) / 100.0;
  const weights = options.targetWeights ?? {
    repoPct: 50,
    bondsPct: 35,
    equitiesPct: 15,
  };

  const portfolio = new TreasuryPortfolio(initialCash);
  const forecaster = new HourOfWeekSmoothingForecaster({ mode: "ewma", lambda: 0.3 });

  // Rolling history for forecaster and empirical residuals
  const historyBuckets: HourlyBucket[] = [];
  const residualHistory: number[] = [];

  const frames: TimelineFrame[] = [];
  const auditLogs: TimelineSimulationResult["auditLogs"] = [];

  let shortfallEventsCount = 0;
  let overdraftHoursCount = 0;
  let maxOverdraftDrawn = Money.zero("USD");

  const initialAssets = portfolio.getTotalNetAssets();

  for (let step = 0; step < maxHours; step++) {
    const hourIndex = startHour + step;
    const rawRecord = dataset[hourIndex];
    const events: string[] = [];
    const stepLiquidations: TierLiquidationOrder[] = [];

    // Apply stress shocks to record copy
    const record: TreasuryHourRecord = {
      ...rawRecord,
      withdrawals_usd: rawRecord.withdrawals_usd * outflowShockMultiplier,
      net_flow_usd: rawRecord.deposits_usd - rawRecord.withdrawals_usd * outflowShockMultiplier,
      tier1_repo_rate_apy: Math.max(
        0,
        rawRecord.tier1_repo_rate_apy + (options.rateShiftBps ?? 0) / 100.0
      ),
      tier3_stock_index_price:
        rawRecord.tier3_stock_index_price *
        (1.0 - Math.max(0, options.equityDrawdownShockPct ?? 0) / 100.0),
    };

    // 1. Hourly accruals & MTM updates
    portfolio.processHourlyAccruals(record);

    // 2. 08:00 UTC Repo Maturity (Tier 1 releases funds)
    if (policy !== "hold-all-cash" && record.repo_sweep_mature) {
      const matureResult = portfolio.matureRepoAt0800();
      if (matureResult) {
        const msg = `Overnight Repo matured at 08:00 UTC: released ${matureResult.maturedPrincipal.format()} principal + ${matureResult.accruedInterest.format()} interest back to Cash`;
        events.push(msg);
        auditLogs.push({
          hour: hourIndex,
          timestamp: record.timestamp,
          message: msg,
          type: "MATURITY",
        });
      }
    }

    // 3. Process net hourly cash flow
    const inbound = Money.fromDecimal(Math.max(0, record.deposits_usd), "USD");
    const outbound = Money.fromDecimal(Math.max(0, record.withdrawals_usd), "USD");

    portfolio.tier0Cash = portfolio.tier0Cash.add(inbound);

    if (portfolio.tier0Cash.greaterThanOrEqual(outbound)) {
      portfolio.tier0Cash = portfolio.tier0Cash.subtract(outbound);
    } else {
      // Cash deficit: unallocated cash is insufficient to pay customer withdrawals!
      const cashDeficit = outbound.subtract(portfolio.tier0Cash);
      portfolio.tier0Cash = Money.zero("USD");
      shortfallEventsCount++;

      const cascadeResult = portfolio.executeLiquidationCascade(cashDeficit, record);
      stepLiquidations.push(...cascadeResult.orders);

      const msg = `Liquidation Cascade triggered to cover ${cashDeficit.format()} deficit. Recovered: ${cascadeResult.totalRecoveredCash.format()}, Penalties: ${cascadeResult.totalPenaltiesPaid.format()}`;
      events.push(msg);
      auditLogs.push({
        hour: hourIndex,
        timestamp: record.timestamp,
        message: msg,
        type: "LIQUIDATION",
      });

      if (cascadeResult.overdraftDrawn.isPositive()) {
        const odMsg = `Emergency Overdraft Drawn: ${cascadeResult.overdraftDrawn.format()} at 12% APR penalty`;
        events.push(odMsg);
        auditLogs.push({
          hour: hourIndex,
          timestamp: record.timestamp,
          message: odMsg,
          type: "OVERDRAFT",
        });
      }
    }

    // Check overdraft telemetry
    if (portfolio.emergencyOverdraftBalance.isPositive()) {
      overdraftHoursCount++;
      if (portfolio.emergencyOverdraftBalance.greaterThan(maxOverdraftDrawn)) {
        maxOverdraftDrawn = portfolio.emergencyOverdraftBalance;
      }
    }

    // 4. Update rolling history bucket
    const currentBucket = treasuryRecordToHourlyBucket(record);
    historyBuckets.push(currentBucket);

    // Keep history manageable (e.g. up to 720 hours for EWMA smoothing)
    if (historyBuckets.length > 720) {
      historyBuckets.shift();
    }

    // 5. Forecaster & Basel III Reserve Sizing (Policy: Reserve Juggler)
    let requiredReserve = operationalFloor;
    let deployableSurplus = Money.zero("USD");
    let liquidityStatus: "HEALTHY" | "UNDER_RESERVED" | "LOW_CONFIDENCE" = "HEALTHY";

    if (policy === "reserve-juggler") {
      if (historyBuckets.length >= 24) {
        // Run forecast
        const forecastHorizon = forecaster.predict(historyBuckets, horizonHours);
        let expectedCumulativeMinor = 0n;
        for (const pred of forecastHorizon) {
          expectedCumulativeMinor += pred.amountMinor;
        }
        const expectedCumulativeFlow = Money.fromMinor(expectedCumulativeMinor, "USD");

        // Track residual from previous prediction
        const actualNetMinor = currentBucket.netFlow.amountMinor;
        const predictedMinor = forecastHorizon[0].amountMinor;
        const residual = Number(actualNetMinor - predictedMinor) / 100.0;
        residualHistory.push(residual);
        if (residualHistory.length > 500) residualHistory.shift();

        // Calculate 1st percentile worst-case shortfall
        const qVal = residualHistory.length >= 20
          ? calculateQuantile(residualHistory, alpha)
          : -5_000_000; // Conservative fallback

        const worstCaseResidualShortfall = Money.fromDecimal(qVal, "USD");

        const reserveResult = computeRequiredReserve({
          expectedCumulativeFlow,
          worstCaseResidualShortfall,
          operationalFloor,
        });

        requiredReserve = reserveResult.requiredReserve;

        if (portfolio.tier0Cash.greaterThanOrEqual(requiredReserve)) {
          deployableSurplus = portfolio.tier0Cash.subtract(requiredReserve);
          liquidityStatus = "HEALTHY";
        } else {
          liquidityStatus = "UNDER_RESERVED";
        }
      } else {
        liquidityStatus = "LOW_CONFIDENCE";
        // Conservative fallback floor during warm-up
        requiredReserve = operationalFloor.multiply(1.5);
      }

      // 6. 17:00 UTC Repo Sweep Window (Deploy Surplus)
      if (record.repo_sweep_window_open && liquidityStatus === "HEALTHY" && deployableSurplus.isPositive()) {
        const allocated = portfolio.allocateSurplus(deployableSurplus, weights, record, hourIndex);
        const msg = `Surplus swept at 17:00 UTC: Repo=${allocated.repoAllocated.format()}, Bonds=${allocated.bondsAllocated.format()}, Equities=${allocated.equitiesAllocated.format()}`;
        events.push(msg);
        auditLogs.push({
          hour: hourIndex,
          timestamp: record.timestamp,
          message: msg,
          type: "SWEEP",
        });
      }
    } else if (policy === "fixed-buffer") {
      // Fixed Buffer Policy: static floor
      requiredReserve = operationalFloor;
      if (portfolio.tier0Cash.greaterThan(requiredReserve)) {
        deployableSurplus = portfolio.tier0Cash.subtract(requiredReserve);
        if (record.repo_sweep_window_open && deployableSurplus.isPositive()) {
          portfolio.allocateSurplus(deployableSurplus, weights, record, hourIndex);
        }
      } else {
        liquidityStatus = "UNDER_RESERVED";
      }
    } else {
      // Hold All Cash Policy: 100% in Tier 0 Cash
      requiredReserve = operationalFloor;
      deployableSurplus = Money.zero("USD");
      liquidityStatus = portfolio.tier0Cash.greaterThanOrEqual(requiredReserve)
        ? "HEALTHY"
        : "UNDER_RESERVED";
    }

    // 7. Snapshot Frame
    const snapshot = portfolio.getSnapshot(hourIndex, record.timestamp);
    frames.push({
      hourIndex,
      timestamp: record.timestamp,
      depositsUsd: record.deposits_usd,
      withdrawalsUsd: record.withdrawals_usd,
      netFlowUsd: record.net_flow_usd,
      portfolio: snapshot,
      requiredReserveMinor: requiredReserve.amountMinor.toString(),
      deployableSurplusMinor: deployableSurplus.amountMinor.toString(),
      liquidityStatus,
      events,
      liquidations: stepLiquidations,
    });
  }

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
    shortfallEventsCount,
    overdraftHoursCount,
    maxOverdraftDrawnUsd: maxOverdraftDrawn.toDecimal(),
    maxTier3DrawdownPct: Math.round(
      portfolio.getSnapshot(startHour + maxHours - 1, "").tier3DrawdownPct * 100
    ) / 100,
  };

  return { summary, frames, auditLogs };
}
