/**
 * Reserve Juggler - Stepwise Treasury Engine
 *
 * Pure, I/O-free single-hour step of the 4-tier treasury timeline. `runTimelineSimulation`
 * (batch replay) and the realtime clock service both call `stepTreasury`, so a stream advanced
 * one hour at a time produces exactly the same frames as a batch run over the same data.
 *
 * The engine state is JSON-serialisable (`serializeTreasuryState` / `deserializeTreasuryState`)
 * so it can be persisted between ticks. BigInt money is stored as decimal strings.
 */

import { Money } from "@/engine/money";
import { TreasuryHourRecord, treasuryRecordToHourlyBucket } from "@/engine/dataset";
import { HourlyBucket } from "@/engine/models";
import {
  TreasuryPortfolio,
  TreasurySnapshot,
  TierLiquidationOrder,
} from "@/engine/treasury-vaults";
import { HourOfWeekSmoothingForecaster } from "@/engine/forecast";
import { computeRequiredReserve, calculateQuantile } from "@/engine/reserve";

export type TimelinePolicy = "reserve-juggler" | "hold-all-cash" | "fixed-buffer";

export type LiquidityStatus = "HEALTHY" | "UNDER_RESERVED" | "LOW_CONFIDENCE";

export interface TimelineFrame {
  hourIndex: number;
  timestamp: string;
  depositsUsd: number;
  withdrawalsUsd: number;
  netFlowUsd: number;
  portfolio: TreasurySnapshot;
  requiredReserveMinor: string;
  deployableSurplusMinor: string;
  liquidityStatus: LiquidityStatus;
  events: string[];
  liquidations: TierLiquidationOrder[];
}

export interface TimelineAuditLog {
  hour: number;
  timestamp: string;
  message: string;
  type: "SWEEP" | "MATURITY" | "LIQUIDATION" | "OVERDRAFT" | "INFO";
}

export interface AllocationWeights {
  repoPct: number;
  bondsPct: number;
  equitiesPct: number;
}

export const DEFAULT_ALLOCATION_WEIGHTS: AllocationWeights = {
  repoPct: 50,
  bondsPct: 35,
  equitiesPct: 15,
};

/** Rolling history length kept for the forecaster (hours). */
export const HISTORY_LIMIT_HOURS = 720;
/** Rolling residual sample length kept for the quantile reserve. */
export const RESIDUAL_LIMIT = 500;

export interface StressShocks {
  outflowShockPct?: number;
  rateShiftBps?: number;
  equityDrawdownShockPct?: number;
}

/**
 * Applies optional stress shocks to a dataset record. With no shocks the record's withdrawals
 * are unchanged, but net flow is recomputed as deposits - withdrawals (float), exactly as the
 * batch simulator has always done. Both batch and streamed runs must call this so they agree.
 */
export function applyStressShocks(raw: TreasuryHourRecord, shocks: StressShocks = {}): TreasuryHourRecord {
  const outflowShockMultiplier = 1.0 + Math.max(0, shocks.outflowShockPct ?? 0) / 100.0;
  return {
    ...raw,
    withdrawals_usd: raw.withdrawals_usd * outflowShockMultiplier,
    net_flow_usd: raw.deposits_usd - raw.withdrawals_usd * outflowShockMultiplier,
    tier1_repo_rate_apy: Math.max(0, raw.tier1_repo_rate_apy + (shocks.rateShiftBps ?? 0) / 100.0),
    tier3_stock_index_price:
      raw.tier3_stock_index_price * (1.0 - Math.max(0, shocks.equityDrawdownShockPct ?? 0) / 100.0),
  };
}

export interface StepContext {
  policy: TimelinePolicy;
  operationalFloor: Money;
  horizonHours: number;
  alpha: number;
  weights: AllocationWeights;
}

/** Mutable engine state advanced by `stepTreasury`. */
export interface TreasuryEngineState {
  portfolio: TreasuryPortfolio;
  historyBuckets: HourlyBucket[];
  residualHistory: number[];
  shortfallEventsCount: number;
  overdraftHoursCount: number;
  maxOverdraftDrawn: Money;
}

export function createTreasuryState(initialCash: Money): TreasuryEngineState {
  return {
    portfolio: new TreasuryPortfolio(initialCash),
    historyBuckets: [],
    residualHistory: [],
    shortfallEventsCount: 0,
    overdraftHoursCount: 0,
    maxOverdraftDrawn: Money.zero("USD"),
  };
}

export interface StepResult {
  frame: TimelineFrame;
  auditLogs: TimelineAuditLog[];
}

/**
 * Advances the treasury by exactly one dataset hour. Mutates `state`.
 * `record` must already include any stress shocks the caller wants applied.
 */
export function stepTreasury(
  state: TreasuryEngineState,
  record: TreasuryHourRecord,
  hourIndex: number,
  ctx: StepContext
): StepResult {
  const { portfolio } = state;
  const { policy, operationalFloor, horizonHours, alpha, weights } = ctx;
  const forecaster = new HourOfWeekSmoothingForecaster({ mode: "ewma", lambda: 0.3 });

  const events: string[] = [];
  const auditLogs: TimelineAuditLog[] = [];
  const stepLiquidations: TierLiquidationOrder[] = [];

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
    state.shortfallEventsCount++;

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
    state.overdraftHoursCount++;
    if (portfolio.emergencyOverdraftBalance.greaterThan(state.maxOverdraftDrawn)) {
      state.maxOverdraftDrawn = portfolio.emergencyOverdraftBalance;
    }
  }

  // 4. Update rolling history bucket
  const currentBucket = treasuryRecordToHourlyBucket(record);
  state.historyBuckets.push(currentBucket);
  if (state.historyBuckets.length > HISTORY_LIMIT_HOURS) {
    state.historyBuckets.shift();
  }

  // 5. Forecaster & Basel III Reserve Sizing
  let requiredReserve = operationalFloor;
  let deployableSurplus = Money.zero("USD");
  let liquidityStatus: LiquidityStatus = "HEALTHY";

  if (policy === "reserve-juggler") {
    if (state.historyBuckets.length >= 24) {
      const forecastHorizon = forecaster.predict(state.historyBuckets, horizonHours);
      let expectedCumulativeMinor = 0n;
      for (const pred of forecastHorizon) {
        expectedCumulativeMinor += pred.amountMinor;
      }
      const expectedCumulativeFlow = Money.fromMinor(expectedCumulativeMinor, "USD");

      // Track residual from previous prediction
      const actualNetMinor = currentBucket.netFlow.amountMinor;
      const predictedMinor = forecastHorizon[0].amountMinor;
      const residual = Number(actualNetMinor - predictedMinor) / 100.0;
      state.residualHistory.push(residual);
      if (state.residualHistory.length > RESIDUAL_LIMIT) state.residualHistory.shift();

      // Calculate 1st percentile worst-case shortfall
      const qVal =
        state.residualHistory.length >= 20
          ? calculateQuantile(state.residualHistory, alpha)
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
  const frame: TimelineFrame = {
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
  };

  return { frame, auditLogs };
}

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

export const TREASURY_STATE_SCHEMA_VERSION = 1;

type MinorStr = string;

export interface SerializedTreasuryState {
  schemaVersion: number;
  tier0Cash: MinorStr;
  tier1: { principal: MinorStr; accruedYield: MinorStr; isOpen: boolean; entryHour: number; rateApy: number };
  tier2: {
    parValue: MinorStr;
    marketValue: MinorStr;
    yieldPct: number;
    priceIndex: number;
    modDuration: number;
    accruedYield: MinorStr;
  };
  tier3: {
    costBasis: MinorStr;
    marketValue: MinorStr;
    indexPrice: number;
    shares: number;
    peakMarketValue: MinorStr;
  };
  overdraftBalance: MinorStr;
  cumulativeGrossYieldEarned: MinorStr;
  cumulativePenaltiesPaid: MinorStr;
  cumulativeOverdraftInterestPaid: MinorStr;
  /** Rolling history as [ISO timestamp, inboundMinor, outboundMinor] */
  history: Array<[string, MinorStr, MinorStr]>;
  residualHistory: number[];
  shortfallEventsCount: number;
  overdraftHoursCount: number;
  maxOverdraftDrawn: MinorStr;
}

const m = (v: Money): MinorStr => v.amountMinor.toString();
const fromM = (s: MinorStr): Money => Money.fromMinor(BigInt(s), "USD");

export function serializeTreasuryState(state: TreasuryEngineState): SerializedTreasuryState {
  const p = state.portfolio;
  return {
    schemaVersion: TREASURY_STATE_SCHEMA_VERSION,
    tier0Cash: m(p.tier0Cash),
    tier1: {
      principal: m(p.tier1RepoPrincipal),
      accruedYield: m(p.tier1RepoAccruedYield),
      isOpen: p.tier1IsOpen,
      entryHour: p.tier1EntryHour,
      rateApy: p.tier1RateApy,
    },
    tier2: {
      parValue: m(p.tier2BondsParValue),
      marketValue: m(p.tier2BondsMarketValue),
      yieldPct: p.tier2BondsYieldPct,
      priceIndex: p.tier2BondsPriceIndex,
      modDuration: p.tier2BondsModDuration,
      accruedYield: m(p.tier2BondsAccruedYield),
    },
    tier3: {
      costBasis: m(p.tier3EquitiesCostBasis),
      marketValue: m(p.tier3EquitiesMarketValue),
      indexPrice: p.tier3EquitiesIndexPrice,
      shares: p.tier3EquitiesShares,
      peakMarketValue: m(p.tier3PeakMarketValue),
    },
    overdraftBalance: m(p.emergencyOverdraftBalance),
    cumulativeGrossYieldEarned: m(p.cumulativeGrossYieldEarned),
    cumulativePenaltiesPaid: m(p.cumulativePenaltiesPaid),
    cumulativeOverdraftInterestPaid: m(p.cumulativeOverdraftInterestPaid),
    history: state.historyBuckets.map((b) => [
      b.hourStart.toISOString().replace(".000Z", "Z"),
      m(b.inbound),
      m(b.outbound),
    ]),
    residualHistory: [...state.residualHistory],
    shortfallEventsCount: state.shortfallEventsCount,
    overdraftHoursCount: state.overdraftHoursCount,
    maxOverdraftDrawn: m(state.maxOverdraftDrawn),
  };
}

export function deserializeTreasuryState(raw: SerializedTreasuryState): TreasuryEngineState {
  if (raw.schemaVersion !== TREASURY_STATE_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported treasury state schemaVersion ${raw.schemaVersion} (expected ${TREASURY_STATE_SCHEMA_VERSION})`
    );
  }

  const portfolio = new TreasuryPortfolio(fromM(raw.tier0Cash));
  portfolio.tier1RepoPrincipal = fromM(raw.tier1.principal);
  portfolio.tier1RepoAccruedYield = fromM(raw.tier1.accruedYield);
  portfolio.tier1IsOpen = raw.tier1.isOpen;
  portfolio.tier1EntryHour = raw.tier1.entryHour;
  portfolio.tier1RateApy = raw.tier1.rateApy;

  portfolio.tier2BondsParValue = fromM(raw.tier2.parValue);
  portfolio.tier2BondsMarketValue = fromM(raw.tier2.marketValue);
  portfolio.tier2BondsYieldPct = raw.tier2.yieldPct;
  portfolio.tier2BondsPriceIndex = raw.tier2.priceIndex;
  portfolio.tier2BondsModDuration = raw.tier2.modDuration;
  portfolio.tier2BondsAccruedYield = fromM(raw.tier2.accruedYield);

  portfolio.tier3EquitiesCostBasis = fromM(raw.tier3.costBasis);
  portfolio.tier3EquitiesMarketValue = fromM(raw.tier3.marketValue);
  portfolio.tier3EquitiesIndexPrice = raw.tier3.indexPrice;
  portfolio.tier3EquitiesShares = raw.tier3.shares;
  portfolio.tier3PeakMarketValue = fromM(raw.tier3.peakMarketValue);

  portfolio.emergencyOverdraftBalance = fromM(raw.overdraftBalance);
  portfolio.cumulativeGrossYieldEarned = fromM(raw.cumulativeGrossYieldEarned);
  portfolio.cumulativePenaltiesPaid = fromM(raw.cumulativePenaltiesPaid);
  portfolio.cumulativeOverdraftInterestPaid = fromM(raw.cumulativeOverdraftInterestPaid);

  const historyBuckets: HourlyBucket[] = raw.history.map(([ts, inMinor, outMinor]) => {
    const inbound = fromM(inMinor);
    const outbound = fromM(outMinor);
    return {
      bucketId: ts,
      hourStart: new Date(ts),
      inbound,
      outbound,
      netFlow: inbound.subtract(outbound),
      grossVolume: inbound.add(outbound),
      transactionCount: 100,
    };
  });

  return {
    portfolio,
    historyBuckets,
    residualHistory: [...raw.residualHistory],
    shortfallEventsCount: raw.shortfallEventsCount,
    overdraftHoursCount: raw.overdraftHoursCount,
    maxOverdraftDrawn: fromM(raw.maxOverdraftDrawn),
  };
}
