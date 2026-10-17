/**
 * Reserve Juggler - Stress Scenario Simulator Engine (Digital Twin)
 *
 * Implements Phase 18: Pure TypeScript Monte Carlo simulation engine with:
 * - Parameterized stress shocks (outflow multipliers, settlement delays, correlated runs, rate shifts, outages)
 * - Three policy benchmarks (reserve-juggler, hold-all-cash, fixed-buffer)
 * - Reproducible seeded bootstrap resampling from empirical historical residuals
 * - Liquidation prioritization via solveLiquidation (lowest penalty, fastest lag, outage filtering)
 * - Emergency borrowing facility for cash shortfalls
 * - Strict Money (BigInt minor units) accounting identities without floating-point balance drift
 */

import { Money } from "@/engine/money";
import { Instrument, HourlyBucket } from "@/engine/models";
import { AllocatedHolding, solveLiquidation } from "@/engine/decision";
import { computeRequiredReserve } from "@/engine/reserve";
import { optimizeAllocation } from "@/engine/optimizer";
import { HourOfWeekSmoothingForecaster } from "@/engine/forecast";
import { SeededPRNG } from "@/engine/prng";
import { calculateQuantile } from "@/engine/reserve";
import {
  ScenarioSchema,
  type Scenario,
  type ScenarioInput,
  type PolicyType,
} from "@/engine/schemas";

// ---------------------------------------------------------------------------
// Type Definitions & Safe Arithmetic Guards
// ---------------------------------------------------------------------------

export type { Scenario, ScenarioInput, PolicyType };

const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER); // 9_007_199_254_740_991n
const MIN_SAFE_INTEGER_BIGINT = BigInt(Number.MIN_SAFE_INTEGER); // -9_007_199_254_740_991n

/**
 * Converts a BigInt minor unit value to a JavaScript double-precision number,
 * throwing a RangeError loudly if the value exceeds Number.MAX_SAFE_INTEGER.
 * Protects against silent IEEE 754 precision loss when balances approach $90 Trillion USD.
 */
export function safeBigIntToNumber(val: bigint, context = "value"): number {
  if (val > MAX_SAFE_INTEGER_BIGINT || val < MIN_SAFE_INTEGER_BIGINT) {
    throw new RangeError(
      `Numeric overflow: ${context} (${val.toString()}) exceeds Number.MAX_SAFE_INTEGER (2^53 - 1). Cannot safely convert to floating point.`
    );
  }
  return Number(val);
}

export interface SimulationParams {
  /** PRNG seed string or numeric seed for 100% deterministic reproduction */
  seed?: string | number;

  /** Historical hourly series available strictly before the simulated window (no look-ahead) */
  history: readonly HourlyBucket[];

  /** Starting unencumbered cash balance at t=0 */
  startingCash: Money;

  /** Configured yield instruments eligible for investment */
  instruments: readonly Instrument[];

  /** Existing active holdings at t=0 (if any) */
  holdings?: readonly AllocatedHolding[];

  /** Stress scenario parameters (accepts partial input with sensible defaults) */
  scenario: ScenarioInput;

  /** Liquidity management policy under test */
  policy: PolicyType;

  /** Optional policy-specific parameters (e.g. bufferPct for fixed-buffer) */
  policyParams?: {
    bufferPct?: number;
  };

  /** Simulation horizon in hours (1..168, default: 24) */
  horizonHours?: number;

  /** Number of Monte Carlo trials (1..2000, default: 500) */
  trials?: number;

  /** Operational floor buffer F for reserve policies */
  operationalFloor?: Money;

  /** Emergency borrowing rate in basis points annualized (default: 1000 = 10%) */
  emergencyBorrowingRateBps?: number;

  /** Merchant settlement fraction of inbound cash (default: 0.35 = 35%) */
  settlementShareOfInflow?: number;

  /** Optional pre-computed common random numbers noise index matrix: [trials][horizonHours] */
  precomputedNoiseIndices?: readonly (readonly number[])[];
}

export interface CashPathPoint {
  /** Hour index from 0 to horizonHours */
  hour: number;

  /** 5th percentile cash balance at this hour */
  p5Cash: Money;

  /** Median (50th percentile) cash balance at this hour */
  medianCash: Money;

  /** 95th percentile cash balance at this hour */
  p95Cash: Money;
}

export interface SimulationResult {
  /** Deterministic seed used for the run */
  seed: string;

  /** Total trials simulated */
  trials: number;

  /** Planning horizon in hours */
  horizonHours: number;

  /** Stress scenario parameters applied */
  scenario: Scenario;

  /** Policy evaluated */
  policy: PolicyType;

  /** Fraction of trials experiencing at least one liquidity shortfall [0, 1] */
  shortfallFrequency: number;

  /** Expected (mean) shortfall amount across all trials */
  expectedShortfall: Money;

  /** 95th percentile shortfall amount across all trials */
  p95Shortfall: Money;

  /** Mean emergency borrowing costs incurred across trials */
  emergencyBorrowingCost: Money;

  /** Mean early liquidation penalty fees paid across trials */
  penaltiesPaid: Money;

  /** Mean gross yield generated across trials */
  grossYield: Money;

  /** Net yield = grossYield - penaltiesPaid - emergencyBorrowingCost */
  netYield: Money;

  /** Minimum cash balance reached percentiles */
  minCash: {
    p5: Money;
    p50: Money;
    p95: Money;
  };

  /** Mean idle liquid cash balance across the horizon (Money minor units) */
  meanIdleCash: Money;

  /** Cumulative idle liquid cash-hours: sum of cash over time (Money * hours) */
  idleCashHours: Money;

  /** Median cash path and uncertainty bands for charting */
  cashPath: CashPathPoint[];

  /** Execution runtime in milliseconds */
  executionDurationMs: number;

  /** Regulatory and mathematical disclaimer */
  disclaimer: string;
}

export const SIMULATION_DISCLAIMER =
  "Stress simulation results are probabilistic model outputs derived from historical resampling and parameterized shocks under stationarity assumptions. They do not constitute a credit guarantee, deposit insurance, or committed liquidity facility.";

// ---------------------------------------------------------------------------
// Residual Extraction (In-Sample Empirical Noise Pool)
// ---------------------------------------------------------------------------

/**
 * Extracts empirical hourly net flow residuals from history for bootstrap resampling.
 */
export function extractHistoricalResiduals(history: readonly HourlyBucket[]): number[] {
  if (history.length === 0) {
    return [0];
  }

  if (history.length >= 168) {
    try {
      const forecaster = new HourOfWeekSmoothingForecaster({ lambda: 0.3 });
      // Calculate profile residuals for each hour
      const residuals: number[] = [];
      for (let i = 0; i < history.length; i++) {
        const bucket = history[i];
        // Use forecaster's historical hour profile
        const expected = forecaster.predict(history.slice(0, Math.max(168, i)), 1)[0];
        const actual = bucket.netFlow;
        const diffMinor = actual.amountMinor - expected.amountMinor;
        residuals.push(safeBigIntToNumber(diffMinor, "residual flow"));
      }
      if (residuals.length > 0) return residuals;
    } catch {
      // Fall through to mean subtraction
    }
  }

  // Fallback: difference from historical sample mean
  const totalMinor = history.reduce((acc, b) => acc + safeBigIntToNumber(b.netFlow.amountMinor, "netFlow"), 0);
  const meanMinor = totalMinor / history.length;
  return history.map((b) => safeBigIntToNumber(b.netFlow.amountMinor, "netFlow") - meanMinor);
}

// ---------------------------------------------------------------------------
// Main Simulation Engine
// ---------------------------------------------------------------------------

/**
 * Executes a Monte Carlo stress simulation across parameterized trials.
 * Pure function: deterministic, no side effects, no I/O.
 */
export function runSimulation(params: SimulationParams): SimulationResult {
  const startTime = Date.now();
  safeBigIntToNumber(params.startingCash.amountMinor, "startingCash");
  if (params.operationalFloor) {
    safeBigIntToNumber(params.operationalFloor.amountMinor, "operationalFloor");
  }

  const currency = params.startingCash.currency;
  const scenario = ScenarioSchema.parse(params.scenario);

  const horizonHours = Math.min(168, Math.max(1, params.horizonHours ?? 24));
  const trials = Math.min(2000, Math.max(1, params.trials ?? 500));
  const seedString = params.seed !== undefined ? String(params.seed) : "sim-seed-default";
  const prng = new SeededPRNG(seedString);

  const emergencyBorrowingRateBps = params.emergencyBorrowingRateBps ?? 1000;
  const settlementShare = Math.min(1, Math.max(0, params.settlementShareOfInflow ?? 0.35));
  const operationalFloor = params.operationalFloor ?? Money.fromMinor(2_000_000_00n, currency); // $20,000

  // 1. Prepare Base Forecast and Historical Noise Pool
  const forecaster = new HourOfWeekSmoothingForecaster({ lambda: 0.3 });
  let baselineForecast: Money[] = [];
  try {
    baselineForecast = forecaster.predict(params.history, horizonHours);
  } catch {
    // Fallback if history is shorter than 168 hours: repeat last observed net flow or mean
    const fallbackFlow = params.history.length > 0
      ? params.history[params.history.length - 1].netFlow
      : Money.zero(currency);
    baselineForecast = Array.from({ length: horizonHours }, () => fallbackFlow);
  }

  const residuals = extractHistoricalResiduals(params.history);

  // Derive average gross inbound/outbound for shock multipliers
  let avgInboundMinor = 10_000_000_00n; // default $100k
  let avgOutboundMinor = 10_000_000_00n;
  if (params.history.length > 0) {
    const totalIn = params.history.reduce((acc, b) => acc + b.inbound.amountMinor, 0n);
    const totalOut = params.history.reduce((acc, b) => acc + b.outbound.amountMinor, 0n);
    avgInboundMinor = totalIn / BigInt(params.history.length);
    avgOutboundMinor = totalOut / BigInt(params.history.length);
  }

  // 2. Adjust Instruments for Yield Rate Shock
  // Instrument.apy is strictly a decimal fraction (e.g. 0.045 for 4.5%, 0.0005 for 0.05%)
  const adjustedInstruments: Instrument[] = params.instruments.map((inst) => {
    const rateShift = (scenario.yieldRateShockBps ?? 0) / 10_000;
    const baseApy = inst.apy;
    const adjustedApy = Math.max(0, baseApy + rateShift);
    return {
      ...inst,
      apy: adjustedApy,
    };
  });

  // 3. Initial Portfolio Deployment Under Selected Policy
  // "Policies are pure functions of the history available before the simulated window; no look-ahead."
  let initialLiquidCash = params.startingCash;
  const initialHoldingsMap: Map<string, Money> = new Map();

  // Populate from existing holdings if provided
  if (params.holdings) {
    for (const h of params.holdings) {
      initialHoldingsMap.set(h.instrument.id, h.currentAmount);
    }
  }

  if (params.policy === "hold-all-cash") {
    // Hold all cash liquid; deploy nothing
    initialLiquidCash = params.startingCash;
    initialHoldingsMap.clear();
  } else if (params.policy === "fixed-buffer") {
    // Retain fixed buffer percentage, deploy the rest by yield
    const bufferPct = params.policyParams?.bufferPct ?? 0.2;
    const bufferCash = params.startingCash.multiply(bufferPct, "half-even");
    const deployableSurplus = params.startingCash.subtract(bufferCash).clampNonNegative();

    // Sort instruments by APY descending
    const sorted = [...adjustedInstruments].sort((a, b) => b.apy - a.apy);
    let remainingToDeploy = deployableSurplus;
    let deployedTotal = Money.zero(currency);

    for (const inst of sorted) {
      if (remainingToDeploy.isZero()) break;
      const amount = Money.min(remainingToDeploy, inst.capacity);
      if (amount.isPositive()) {
        initialHoldingsMap.set(inst.id, amount);
        remainingToDeploy = remainingToDeploy.subtract(amount);
        deployedTotal = deployedTotal.add(amount);
      }
    }
    initialLiquidCash = params.startingCash.subtract(deployedTotal);
  } else {
    // "reserve-juggler" policy: reserve.ts + optimizer.ts
    const alpha = Math.max(0.001, Math.min(0.5, 1 - scenario.confidence));

    // Compute expected flow and empirical worst-case shortfall
    const expectedCumulative = baselineForecast.reduce(
      (acc, m) => acc.add(m),
      Money.zero(currency)
    );

    // Worst-case quantile from history
    const cumResiduals = residuals.slice(0, Math.min(residuals.length, 100));
    const qAlpha = calculateQuantile(cumResiduals, alpha);
    const worstCaseShortfall = Money.fromMinor(BigInt(Math.round(qAlpha)), currency);

    const reserveResult = computeRequiredReserve({
      expectedCumulativeFlow: expectedCumulative,
      worstCaseResidualShortfall: worstCaseShortfall,
      operationalFloor,
      stressAddOn: Money.zero(currency),
    });

    const deployableSurplus = params.startingCash
      .subtract(reserveResult.requiredReserve)
      .clampNonNegative();

    if (deployableSurplus.isPositive() && adjustedInstruments.length > 0) {
      const optResult = optimizeAllocation(
        deployableSurplus,
        adjustedInstruments,
        { horizonHours }
      );
      let deployedTotal = Money.zero(currency);
      for (const alloc of optResult.allocations) {
        if (alloc.allocated.isPositive()) {
          initialHoldingsMap.set(alloc.instrument.id, alloc.allocated);
          deployedTotal = deployedTotal.add(alloc.allocated);
        }
      }
      initialLiquidCash = params.startingCash.subtract(deployedTotal);
    } else {
      initialLiquidCash = params.startingCash;
    }
  }

  // 4. Monte Carlo Trial Loops
  const trialShortfalls: Money[] = [];
  const trialBorrowingCosts: Money[] = [];
  const trialPenalties: Money[] = [];
  const trialGrossYields: Money[] = [];
  const trialNetYields: Money[] = [];
  const trialMinCash: Money[] = [];
  const trialMeanIdleCash: Money[] = [];
  const trialIdleCashHours: Money[] = [];

  // Track cash paths across all trials for percentiles per hour: hour -> Money[]
  const hourlyPaths: Money[][] = Array.from({ length: horizonHours + 1 }, () => []);

  const outageSet = new Set(scenario.instrumentOutageIds ?? []);
  const shockStart = scenario.shockStartHour ?? 0;
  const shockDuration = scenario.shockDurationHours ?? horizonHours;
  const shockEnd = shockStart + shockDuration;

  for (let t = 0; t < trials; t++) {
    let currentCash = initialLiquidCash;
    const currentHoldings = new Map<string, Money>(initialHoldingsMap);

    // Scheduled arrivals queue for delayed settlements or delayed liquidation proceeds: hour -> Money
    const scheduledArrivals: Map<number, Money> = new Map();

    let trialTotalShortfall = Money.zero(currency);
    let trialBorrowingCost = Money.zero(currency);
    let trialPenaltiesPaid = Money.zero(currency);
    let trialGrossYield = Money.zero(currency);
    let trialMin = currentCash;
    let trialCashSum = currentCash.amountMinor;

    hourlyPaths[0].push(currentCash);

    for (let h = 1; h <= horizonHours; h++) {
      // A. Deliver scheduled in-transit arrivals
      const arrived = scheduledArrivals.get(h);
      if (arrived && arrived.isPositive()) {
        currentCash = currentCash.add(arrived);
      }

      // B. Accrue hourly yield on deployed holdings
      for (const inst of adjustedInstruments) {
        const balance = currentHoldings.get(inst.id);
        if (balance && balance.isPositive()) {
          // Annual rate to hourly rate: rate / 8760
          const hourlyRate = inst.apy / 8760;
          const balanceNum = safeBigIntToNumber(balance.amountMinor, "instrument balance");
          const yieldMinor = BigInt(
            Math.round(balanceNum * hourlyRate)
          );
          if (yieldMinor > 0n) {
            const earned = Money.fromMinor(yieldMinor, currency);
            trialGrossYield = trialGrossYield.add(earned);
          }
        }
      }

      // C. Sample net cash flow for hour h with bootstrap noise and shocks
      const basePoint = baselineForecast[h - 1] ?? Money.zero(currency);
      const resIndex = params.precomputedNoiseIndices
        ? params.precomputedNoiseIndices[t][h - 1]
        : prng.nextInt(0, residuals.length - 1);
      const noiseMinor = BigInt(Math.round(residuals[resIndex]));

      // Determine nominal inflow and outflow
      let nominalInflow = avgInboundMinor;
      let nominalOutflow = avgOutboundMinor;

      // Apply baseline drift to inflow/outflow
      if (basePoint.isPositive()) {
        nominalInflow += basePoint.amountMinor / 2n;
      } else {
        nominalOutflow += (-basePoint.amountMinor) / 2n;
      }

      // Apply bootstrap noise
      if (noiseMinor >= 0n) {
        nominalInflow += noiseMinor;
      } else {
        nominalOutflow += -noiseMinor;
      }

      // Shock 1: Outflow multiplier shock
      let effectiveOutflow = nominalOutflow;
      if (h >= shockStart && h <= shockEnd) {
        const shockFactor = 1 + (scenario.outflowShockPct ?? 0) / 100;
        const outflowNum = safeBigIntToNumber(effectiveOutflow, "effective outflow");
        effectiveOutflow = BigInt(Math.round(outflowNum * shockFactor));
      }

      // Shock 2: Correlated bank-run outflow tail
      if (scenario.correlatedRun && h >= shockStart) {
        const tau = h - shockStart;
        const { intensityPct, decay } = scenario.correlatedRun;
        const runFactor = (intensityPct / 100) * Math.pow(decay, tau);
        const nominalOutNum = safeBigIntToNumber(nominalOutflow, "nominal outflow");
        const extraOutflow = BigInt(Math.round(nominalOutNum * runFactor));
        effectiveOutflow += extraOutflow;
      }

      // Shock 3: Settlement delay
      let effectiveInflow = nominalInflow;
      const delay = scenario.settlementDelayHours ?? 0;
      if (delay > 0) {
        const nominalInNum = safeBigIntToNumber(nominalInflow, "nominal inflow");
        const settlementPortion = BigInt(Math.round(nominalInNum * settlementShare));
        effectiveInflow = nominalInflow - settlementPortion;
        // Schedule settlement arrival at hour h + delay
        const arrivalHour = h + delay;
        const existing = scheduledArrivals.get(arrivalHour) ?? Money.zero(currency);
        scheduledArrivals.set(arrivalHour, existing.add(Money.fromMinor(settlementPortion, currency)));
      }

      // Net hourly flow
      const netHourlyFlow = Money.fromMinor(effectiveInflow - effectiveOutflow, currency);
      currentCash = currentCash.add(netHourlyFlow);

      // D. Check for cash deficit & execute liquidation
      if (currentCash.isNegative()) {
        let deficit = currentCash.negate(); // Positive gap to 0

        // Build list of active holdings eligible for liquidation (outages excluded)
        const eligibleHoldings: AllocatedHolding[] = [];
        for (const inst of adjustedInstruments) {
          if (outageSet.has(inst.id)) continue; // Outage: cannot be liquidated
          const bal = currentHoldings.get(inst.id);
          if (bal && bal.isPositive()) {
            eligibleHoldings.push({
              instrument: inst,
              currentAmount: bal,
            });
          }
        }

        // Reuse decision engine's solveLiquidation
        const plan = solveLiquidation(deficit, eligibleHoldings);

        for (const order of plan.orders) {
          // Update holding balance
          currentHoldings.set(order.instrumentId, order.remainingHolding);
          trialPenaltiesPaid = trialPenaltiesPaid.add(order.realizedPenalty);

          if (order.settlementLagHours === 0) {
            // Instant settlement: funds immediately restore cash at hour h
            currentCash = currentCash.add(order.netRecoveredCash);
            deficit = deficit.subtract(order.netRecoveredCash).clampNonNegative();
          } else {
            // Lagged settlement: proceeds arrive at h + settlementLagHours
            const arrivalHour = h + order.settlementLagHours;
            const existing = scheduledArrivals.get(arrivalHour) ?? Money.zero(currency);
            scheduledArrivals.set(arrivalHour, existing.add(order.netRecoveredCash));
          }
        }

        // E. Any remaining cash deficit at hour h is an unrecovered Shortfall
        if (currentCash.isNegative()) {
          const shortfallAmount = currentCash.negate();
          trialTotalShortfall = trialTotalShortfall.add(shortfallAmount);

          // Emergency borrowing at configurable rate to bridge the gap
          // Per-hour rate: emergencyBorrowingRateBps / 10000 / 8760
          const hourlyBorrowingRate = emergencyBorrowingRateBps / 10_000 / 8760;
          const shortfallNum = safeBigIntToNumber(shortfallAmount.amountMinor, "shortfall amount");
          const borrowingFeeMinor = BigInt(
            Math.ceil(shortfallNum * hourlyBorrowingRate)
          );
          if (borrowingFeeMinor > 0n) {
            trialBorrowingCost = trialBorrowingCost.add(Money.fromMinor(borrowingFeeMinor, currency));
          }

          // Emergency liquidity facility restores cash to 0 for subsequent hour calculations
          currentCash = Money.zero(currency);
        }
      }

      // F. Track hourly statistics
      if (currentCash.lessThan(trialMin)) {
        trialMin = currentCash;
      }
      trialCashSum += currentCash.amountMinor;
      hourlyPaths[h].push(currentCash);
    }

    const trialNetYield = trialGrossYield
      .subtract(trialPenaltiesPaid)
      .subtract(trialBorrowingCost);

    trialShortfalls.push(trialTotalShortfall);
    trialBorrowingCosts.push(trialBorrowingCost);
    trialPenalties.push(trialPenaltiesPaid);
    trialGrossYields.push(trialGrossYield);
    trialNetYields.push(trialNetYield);
    trialMinCash.push(trialMin);
    trialMeanIdleCash.push(Money.fromMinor(trialCashSum / BigInt(horizonHours), currency));
    trialIdleCashHours.push(Money.fromMinor(trialCashSum, currency));
  }

  // 5. Aggregate Across All Trials
  const shortfallCount = trialShortfalls.filter((s) => s.isPositive()).length;
  const shortfallFrequency = shortfallCount / trials;

  const expectedShortfallMinor =
    trialShortfalls.reduce((acc, s) => acc + s.amountMinor, 0n) / BigInt(trials);
  const expectedShortfall = Money.fromMinor(expectedShortfallMinor, currency);

  const sortedShortfalls = [...trialShortfalls].sort((a, b) => (a.amountMinor > b.amountMinor ? 1 : -1));
  const p95Shortfall = sortedShortfalls[Math.floor(0.95 * (trials - 1))] ?? Money.zero(currency);

  const meanBorrowingCost = Money.fromMinor(
    trialBorrowingCosts.reduce((acc, c) => acc + c.amountMinor, 0n) / BigInt(trials),
    currency
  );

  const meanPenalties = Money.fromMinor(
    trialPenalties.reduce((acc, p) => acc + p.amountMinor, 0n) / BigInt(trials),
    currency
  );

  const meanGrossYield = Money.fromMinor(
    trialGrossYields.reduce((acc, y) => acc + y.amountMinor, 0n) / BigInt(trials),
    currency
  );

  // Accounting identity: netYield = grossYield - penaltiesPaid - emergencyBorrowingCost
  const netYield = meanGrossYield.subtract(meanPenalties).subtract(meanBorrowingCost);

  // Min cash percentiles
  const sortedMinCash = [...trialMinCash].sort((a, b) => (a.amountMinor > b.amountMinor ? 1 : -1));
  const p5MinCash = sortedMinCash[Math.floor(0.05 * (trials - 1))] ?? Money.zero(currency);
  const p50MinCash = sortedMinCash[Math.floor(0.50 * (trials - 1))] ?? Money.zero(currency);
  const p95MinCash = sortedMinCash[Math.floor(0.95 * (trials - 1))] ?? Money.zero(currency);

  const meanIdleCash = Money.fromMinor(
    trialMeanIdleCash.reduce((acc, i) => acc + i.amountMinor, 0n) / BigInt(trials),
    currency
  );

  const idleCashHours = Money.fromMinor(
    trialIdleCashHours.reduce((acc, i) => acc + i.amountMinor, 0n) / BigInt(trials),
    currency
  );

  // 6. Build Hourly Path Percentiles for Charting
  const cashPath: CashPathPoint[] = [];
  for (let h = 0; h <= horizonHours; h++) {
    const values = [...hourlyPaths[h]].sort((a, b) => (a.amountMinor > b.amountMinor ? 1 : -1));
    const p5 = values[Math.floor(0.05 * (values.length - 1))] ?? Money.zero(currency);
    const median = values[Math.floor(0.50 * (values.length - 1))] ?? Money.zero(currency);
    const p95 = values[Math.floor(0.95 * (values.length - 1))] ?? Money.zero(currency);
    cashPath.push({
      hour: h,
      p5Cash: p5,
      medianCash: median,
      p95Cash: p95,
    });
  }

  const durationMs = Date.now() - startTime;

  return {
    seed: seedString,
    trials,
    horizonHours,
    scenario,
    policy: params.policy,
    shortfallFrequency,
    expectedShortfall,
    p95Shortfall,
    emergencyBorrowingCost: meanBorrowingCost,
    penaltiesPaid: meanPenalties,
    grossYield: meanGrossYield,
    netYield,
    minCash: {
      p5: p5MinCash,
      p50: p50MinCash,
      p95: p95MinCash,
    },
    meanIdleCash,
    idleCashHours,
    cashPath,
    executionDurationMs: durationMs,
    disclaimer: SIMULATION_DISCLAIMER,
  };
}

// ---------------------------------------------------------------------------
// Multi-Policy Comparison Engine (Common Random Numbers)
// ---------------------------------------------------------------------------

export interface MetricDeltas {
  /** Net yield delta = policy netYield minus baseline netYield */
  netYield: Money;

  /** Shortfall frequency delta = policy shortfallFrequency minus baseline shortfallFrequency */
  shortfallFrequency: number;

  /** Expected shortfall delta = policy expectedShortfall minus baseline expectedShortfall */
  expectedShortfall: Money;

  /** 95th percentile shortfall delta = policy p95Shortfall minus baseline p95Shortfall */
  p95Shortfall: Money;

  /** Liquidation penalties delta = policy penaltiesPaid minus baseline penaltiesPaid */
  penaltiesPaid: Money;

  /** Emergency borrowing cost delta = policy emergencyBorrowingCost minus baseline emergencyBorrowingCost */
  emergencyBorrowingCost: Money;
}

export interface PolicyComparisonDeltas {
  /** Differences versus the hold-all-cash baseline (if hold-all-cash is included) */
  vsHoldAllCash?: MetricDeltas;

  /** Differences versus the fixed-buffer baseline (if fixed-buffer is included) */
  vsFixedBuffer?: MetricDeltas;
}

export interface MetricWinners {
  netYield: PolicyType;
  shortfallFrequency: PolicyType;
  expectedShortfall: PolicyType;
  p95Shortfall: PolicyType;
  penaltiesPaid: PolicyType;
  emergencyBorrowingCost: PolicyType;
}

export interface PolicyComparisonParams {
  /** PRNG seed string or numeric seed for 100% deterministic reproduction across all policies */
  seed?: string | number;

  /** Historical hourly series available strictly before the simulated window */
  history: readonly HourlyBucket[];

  /** Starting unencumbered cash balance at t=0 */
  startingCash: Money;

  /** Configured yield instruments eligible for investment */
  instruments: readonly Instrument[];

  /** Existing active holdings at t=0 (if any) */
  holdings?: readonly AllocatedHolding[];

  /** Stress scenario parameters */
  scenario: ScenarioInput;

  /** Policies to compare side-by-side (1 to 3 distinct policies) */
  policies?: readonly PolicyType[];

  /** Optional policy-specific parameters (e.g. bufferPct for fixed-buffer) */
  policyParams?: {
    bufferPct?: number;
  };

  /** Simulation horizon in hours (1..168, default: 24) */
  horizonHours?: number;

  /** Number of Monte Carlo trials per policy (1..1000, default: 500) */
  trials?: number;

  /** Operational floor buffer F for reserve policies */
  operationalFloor?: Money;

  /** Emergency borrowing rate in basis points annualized (default: 1000 = 10%) */
  emergencyBorrowingRateBps?: number;

  /** Merchant settlement fraction of inbound cash (default: 0.35 = 35%) */
  settlementShareOfInflow?: number;
}

export interface PolicyComparisonResult {
  seed: string;
  trials: number;
  horizonHours: number;
  scenario: Scenario;
  policies: PolicyType[];
  /** Per-policy simulation results */
  policyResults: Record<PolicyType, SimulationResult>;
  /** Per-policy deltas vs baselines */
  deltas: Record<PolicyType, PolicyComparisonDeltas>;
  /** Descriptive winner per metric (best-performing policy among evaluated) */
  winners: MetricWinners;
  executionDurationMs: number;
  disclaimer: string;
}

/**
 * Executes a side-by-side policy comparison under Common Random Numbers (CRN).
 *
 * All policies are evaluated using the EXACT same pseudo-random sequence of
 * bootstrap residual draws and shocks for every trial and hour. This eliminates
 * Monte Carlo noise from the policy comparison: observed deltas between policies
 * stem solely from the policy mechanism (reserve sizing, deployment, liquidation),
 * not from differing random shock draws.
 */
export function compareScenarioAcrossPolicies(
  params: PolicyComparisonParams
): PolicyComparisonResult {
  const startTime = Date.now();
  const seedString = params.seed !== undefined ? String(params.seed) : "compare-seed-default";
  const trials = Math.min(1000, Math.max(1, params.trials ?? 500));
  const horizonHours = Math.min(168, Math.max(1, params.horizonHours ?? 24));
  const scenario = ScenarioSchema.parse(params.scenario);

  const rawPolicies = params.policies && params.policies.length > 0
    ? params.policies
    : (["reserve-juggler", "hold-all-cash", "fixed-buffer"] as PolicyType[]);
  const policies: PolicyType[] = Array.from(new Set(rawPolicies));

  // 1. Common Random Numbers: Pre-draw bootstrap residual indices using the shared PRNG seed
  const prng = new SeededPRNG(seedString);
  const residuals = extractHistoricalResiduals(params.history);

  const precomputedNoiseIndices: number[][] = [];
  for (let t = 0; t < trials; t++) {
    const trialNoise: number[] = [];
    for (let h = 0; h < horizonHours; h++) {
      trialNoise.push(prng.nextInt(0, residuals.length - 1));
    }
    precomputedNoiseIndices.push(trialNoise);
  }

  // 2. Execute each policy under the exact same common random number draws
  const policyResults = {} as Record<PolicyType, SimulationResult>;
  for (const policy of policies) {
    policyResults[policy] = runSimulation({
      ...params,
      policy,
      seed: seedString,
      trials,
      horizonHours,
      precomputedNoiseIndices,
    });
  }

  // 3. Compute deltas versus baselines
  const holdAllCashRes = policyResults["hold-all-cash"];
  const fixedBufferRes = policyResults["fixed-buffer"];

  function computeDeltas(target: SimulationResult, baseline: SimulationResult): MetricDeltas {
    return {
      netYield: target.netYield.subtract(baseline.netYield),
      shortfallFrequency: target.shortfallFrequency - baseline.shortfallFrequency,
      expectedShortfall: target.expectedShortfall.subtract(baseline.expectedShortfall),
      p95Shortfall: target.p95Shortfall.subtract(baseline.p95Shortfall),
      penaltiesPaid: target.penaltiesPaid.subtract(baseline.penaltiesPaid),
      emergencyBorrowingCost: target.emergencyBorrowingCost.subtract(baseline.emergencyBorrowingCost),
    };
  }

  const deltas = {} as Record<PolicyType, PolicyComparisonDeltas>;
  for (const policy of policies) {
    const target = policyResults[policy];
    deltas[policy] = {
      ...(holdAllCashRes ? { vsHoldAllCash: computeDeltas(target, holdAllCashRes) } : {}),
      ...(fixedBufferRes ? { vsFixedBuffer: computeDeltas(target, fixedBufferRes) } : {}),
    };
  }

  // 4. Compute descriptive winners per metric
  // netYield: higher is better
  // shortfallFrequency, expectedShortfall, p95Shortfall, penaltiesPaid, emergencyBorrowingCost: lower is better
  let bestNetYield = policies[0];
  let bestShortfallFreq = policies[0];
  let bestExpShortfall = policies[0];
  let bestP95Shortfall = policies[0];
  let bestPenalties = policies[0];
  let bestBorrowing = policies[0];

  for (const p of policies) {
    const res = policyResults[p];
    if (res.netYield.amountMinor > policyResults[bestNetYield].netYield.amountMinor) {
      bestNetYield = p;
    }
    if (res.shortfallFrequency < policyResults[bestShortfallFreq].shortfallFrequency) {
      bestShortfallFreq = p;
    }
    if (res.expectedShortfall.amountMinor < policyResults[bestExpShortfall].expectedShortfall.amountMinor) {
      bestExpShortfall = p;
    }
    if (res.p95Shortfall.amountMinor < policyResults[bestP95Shortfall].p95Shortfall.amountMinor) {
      bestP95Shortfall = p;
    }
    if (res.penaltiesPaid.amountMinor < policyResults[bestPenalties].penaltiesPaid.amountMinor) {
      bestPenalties = p;
    }
    if (res.emergencyBorrowingCost.amountMinor < policyResults[bestBorrowing].emergencyBorrowingCost.amountMinor) {
      bestBorrowing = p;
    }
  }

  const winners: MetricWinners = {
    netYield: bestNetYield,
    shortfallFrequency: bestShortfallFreq,
    expectedShortfall: bestExpShortfall,
    p95Shortfall: bestP95Shortfall,
    penaltiesPaid: bestPenalties,
    emergencyBorrowingCost: bestBorrowing,
  };

  const durationMs = Date.now() - startTime;

  return {
    seed: seedString,
    trials,
    horizonHours,
    scenario,
    policies,
    policyResults,
    deltas,
    winners,
    executionDurationMs: durationMs,
    disclaimer: SIMULATION_DISCLAIMER,
  };
}
