/**
 * Reserve Juggler - Surplus Yield Optimizer
 *
 * Implements the financial allocation strategy conforming to FINANCIAL_MODEL.md:
 * Maximise over x: sum_i x_i * r_i * (H / 8760) - sum_i pi_i * p_i * x_i
 * Subject to:
 * - sum x_i <= Surplus (reserve never breached)
 * - 0 <= x_i <= K_i (capacity limits)
 *
 * Sorts instruments by net unit value v_i = r_i * (H / 8760) - pi_i * p_i and
 * allocates greedily in descending order while v_i > 0.
 * Guarantees strict sum conservation via the Money module with zero fractional cents lost.
 */

import { Money } from "@/engine/money";
import { Instrument } from "@/engine/models";

const HOURS_IN_YEAR = 8760; // 365 days * 24 hours

export interface AllocationOptions {
  /** Planning horizon H in hours (default: 24) */
  horizonHours?: number;

  /**
   * Default early withdrawal risk probability pi in [0, 1] if not specified on the instrument.
   * Default: 0.0 (zero penalty risk unless specified or stressed).
   */
  defaultEarlyWithdrawalRisk?: number;
}

export interface InstrumentAllocation {
  /** The target yield instrument */
  instrument: Instrument;

  /** Exact amount deployed into this instrument */
  allocated: Money;

  /** Capacity utilization fraction [0, 1] = allocated / capacity */
  utilization: number;

  /** Net unit return rate over horizon H: v_i = r_i * (H/8760) - pi_i * p_i */
  netUnitValue: number;

  /** Whether the instrument yields positive net return after penalties over horizon H */
  isEconomicallyViable: boolean;

  /** Projected gross interest earned over horizon H */
  projectedGrossYield: Money;

  /** Expected early-exit penalty cost over horizon H (pi_i * p_i * x_i) */
  expectedPenalty: Money;

  /** Projected net financial yield over horizon H (grossYield - penalty) */
  projectedNetYield: Money;
}

export interface OptimizationResult {
  /** Original deployable surplus budget */
  totalSurplus: Money;

  /** Sum of all funds allocated to instruments */
  totalAllocated: Money;

  /** Unallocated cash surplus remaining in liquid buffer */
  unallocatedSurplus: Money;

  /** Detailed allocations for every evaluated instrument */
  allocations: InstrumentAllocation[];

  /** Portfolio aggregate gross yield over horizon H */
  expectedGrossYield: Money;

  /** Portfolio aggregate expected penalties over horizon H */
  expectedPenalties: Money;

  /** Portfolio aggregate net yield over horizon H */
  expectedNetYield: Money;

  /** Effective portfolio net annualized yield in basis points (bps) */
  effectiveNetApyBps: number;

  /** Planning horizon H evaluated in hours */
  horizonHours: number;
}

/**
 * Normalizes an APY value to a decimal rate fraction.
 * If value > 1, it is treated as basis points (e.g. 450 -> 0.045).
 */
export function normalizeRate(value: number): number {
  return value > 1 ? value / 10000 : value;
}

/**
 * Normalizes an early withdrawal penalty value to a decimal rate fraction.
 * If value > 1, it is treated as basis points (e.g. 25 -> 0.0025).
 */
export function normalizePenalty(value: number): number {
  return value > 1 ? value / 10000 : value;
}

/**
 * Calculates net unit value v_i for an instrument over planning horizon H:
 * v_i = r_i * (H / 8760) - pi_i * p_i
 */
export function computeNetUnitValue(
  instrument: Instrument,
  horizonHours: number,
  defaultRisk = 0
): {
  netUnitValue: number;
  grossHorizonRate: number;
  expectedPenaltyRate: number;
  isEconomicallyViable: boolean;
} {
  const r_i = normalizeRate(instrument.apy);
  const p_i = normalizePenalty(instrument.withdrawalPenalty);
  const pi_i = instrument.earlyWithdrawalRisk ?? defaultRisk;

  const grossHorizonRate = r_i * (horizonHours / HOURS_IN_YEAR);
  const expectedPenaltyRate = pi_i * p_i;
  const netUnitValue = grossHorizonRate - expectedPenaltyRate;

  return {
    netUnitValue,
    grossHorizonRate,
    expectedPenaltyRate,
    isEconomicallyViable: netUnitValue > 0,
  };
}

/**
 * Optimizes the deployment of liquid surplus cash across yield instruments.
 *
 * @param deployableSurplus Total available surplus cash from Phase 9 (C - R)
 * @param instruments Available yield instruments with capacity and penalty terms
 * @param options Planning horizon and risk parameters
 */
export function optimizeAllocation(
  deployableSurplus: Money,
  instruments: readonly Instrument[],
  options?: AllocationOptions
): OptimizationResult {
  deployableSurplus.assertNonNegative("deployableSurplus must be non-negative");

  const horizonHours = options?.horizonHours ?? 24;
  if (horizonHours <= 0 || !Number.isFinite(horizonHours)) {
    throw new Error(`horizonHours must be a positive number, received: ${horizonHours}`);
  }

  const defaultRisk = options?.defaultEarlyWithdrawalRisk ?? 0;
  const currency = deployableSurplus.currency;

  if (instruments.length === 0 || deployableSurplus.isZero()) {
    const emptyAllocations: InstrumentAllocation[] = instruments.map((inst) => ({
      instrument: inst,
      allocated: Money.zero(currency),
      utilization: 0,
      netUnitValue: 0,
      isEconomicallyViable: false,
      projectedGrossYield: Money.zero(currency),
      expectedPenalty: Money.zero(currency),
      projectedNetYield: Money.zero(currency),
    }));

    return {
      totalSurplus: deployableSurplus,
      totalAllocated: Money.zero(currency),
      unallocatedSurplus: deployableSurplus,
      allocations: emptyAllocations,
      expectedGrossYield: Money.zero(currency),
      expectedPenalties: Money.zero(currency),
      expectedNetYield: Money.zero(currency),
      effectiveNetApyBps: 0,
      horizonHours,
    };
  }

  // Evaluate net unit value v_i for each instrument
  interface EvaluatedInstrument {
    instrument: Instrument;
    netUnitValue: number;
    grossHorizonRate: number;
    expectedPenaltyRate: number;
    isEconomicallyViable: boolean;
    originalIndex: number;
  }

  const evaluated: EvaluatedInstrument[] = instruments.map((inst, index) => {
    const metrics = computeNetUnitValue(inst, horizonHours, defaultRisk);
    return {
      instrument: inst,
      ...metrics,
      originalIndex: index,
    };
  });

  // Sort descending by net unit value v_i
  // Break ties by lower settlement lag, then higher capacity
  const sorted = [...evaluated].sort((a, b) => {
    if (b.netUnitValue !== a.netUnitValue) {
      return b.netUnitValue - a.netUnitValue;
    }
    const lagA = a.instrument.settlementLagHours ?? 0;
    const lagB = b.instrument.settlementLagHours ?? 0;
    if (lagA !== lagB) {
      return lagA - lagB;
    }
    return Number(b.instrument.capacity.amountMinor - a.instrument.capacity.amountMinor);
  });

  let remaining = deployableSurplus;
  const allocatedAmountsByIndex: Money[] = new Array(instruments.length);

  // Greedily fill instruments while v_i > 0 and remaining surplus > 0
  for (const item of sorted) {
    const { instrument, isEconomicallyViable, originalIndex } = item;
    const cap = instrument.capacity;

    if (!isEconomicallyViable || remaining.isZero() || cap.isZero()) {
      allocatedAmountsByIndex[originalIndex] = Money.zero(currency);
      continue;
    }

    // Allocate min(remaining, capacity)
    const amountToAllocate = Money.min(remaining, cap);
    allocatedAmountsByIndex[originalIndex] = amountToAllocate;
    remaining = remaining.subtract(amountToAllocate);
  }

  // Construct final allocations preserving original input order
  const allocations: InstrumentAllocation[] = evaluated.map((item) => {
    const { instrument, netUnitValue, grossHorizonRate, expectedPenaltyRate, isEconomicallyViable, originalIndex } = item;
    const allocated = allocatedAmountsByIndex[originalIndex];

    const utilization = instrument.capacity.isZero()
      ? 0
      : Number(allocated.amountMinor) / Number(instrument.capacity.amountMinor);

    // Yield math
    const projectedGrossYield = allocated.multiply(grossHorizonRate, "half-even");
    const expectedPenalty = allocated.multiply(expectedPenaltyRate, "half-even");
    const projectedNetYield = projectedGrossYield.subtract(expectedPenalty);

    return {
      instrument,
      allocated,
      utilization,
      netUnitValue,
      isEconomicallyViable,
      projectedGrossYield,
      expectedPenalty,
      projectedNetYield,
    };
  });

  const totalAllocated = Money.sum(
    allocations.map((a) => a.allocated),
    currency
  );
  const unallocatedSurplus = deployableSurplus.subtract(totalAllocated);

  const expectedGrossYield = Money.sum(
    allocations.map((a) => a.projectedGrossYield),
    currency
  );
  const expectedPenalties = Money.sum(
    allocations.map((a) => a.expectedPenalty),
    currency
  );
  const expectedNetYield = expectedGrossYield.subtract(expectedPenalties);

  // Effective net APY in basis points
  let effectiveNetApyBps = 0;
  if (totalAllocated.isPositive() && horizonHours > 0) {
    const netReturnFraction =
      Number(expectedNetYield.amountMinor) / Number(totalAllocated.amountMinor);
    const annualizedRate = netReturnFraction * (HOURS_IN_YEAR / horizonHours);
    effectiveNetApyBps = Math.round(annualizedRate * 10000);
  }

  return {
    totalSurplus: deployableSurplus,
    totalAllocated,
    unallocatedSurplus,
    allocations,
    expectedGrossYield,
    expectedPenalties,
    expectedNetYield,
    effectiveNetApyBps,
    horizonHours,
  };
}

export interface OptimizerOptions {
  defaultHorizonHours?: number;
  defaultEarlyWithdrawalRisk?: number;
}

/**
 * Optimizer class implementing yield instrument portfolio optimization.
 */
export class Optimizer {
  readonly defaultHorizonHours: number;
  readonly defaultEarlyWithdrawalRisk: number;

  constructor(options?: OptimizerOptions) {
    this.defaultHorizonHours = options?.defaultHorizonHours ?? 24;
    this.defaultEarlyWithdrawalRisk = options?.defaultEarlyWithdrawalRisk ?? 0;
  }

  /**
   * Deploys surplus cash into yield instruments according to maximum net yield LP strategy.
   */
  allocate(
    deployableSurplus: Money,
    instruments: readonly Instrument[],
    options?: AllocationOptions
  ): OptimizationResult {
    return optimizeAllocation(deployableSurplus, instruments, {
      horizonHours: options?.horizonHours ?? this.defaultHorizonHours,
      defaultEarlyWithdrawalRisk:
        options?.defaultEarlyWithdrawalRisk ?? this.defaultEarlyWithdrawalRisk,
    });
  }
}
