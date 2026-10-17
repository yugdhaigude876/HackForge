/**
 * Reserve Juggler - Liquidity Decision Engine & State Machine
 *
 * Orchestrates bank liquidity positions under Basel III principles:
 * - HEALTHY: C >= R and confidence satisfied. Deploys surplus via Optimizer.
 * - UNDER_RESERVED: C < R. Halts deployment. Solves liquidation of deployed holdings
 *   with minimum penalty and fastest settlement.
 * - LOW_CONFIDENCE: N < 30 or MASE > 1.2. Halts deployments, applies conservative buffer.
 */

import { Money } from "@/engine/money";
import { Instrument } from "@/engine/models";
import {
  computeRequiredReserve,
  ReserveCalculationResult,
} from "@/engine/reserve";
import {
  optimizeAllocation,
  normalizePenalty,
  InstrumentAllocation,
} from "@/engine/optimizer";

export type DecisionStatus = "HEALTHY" | "UNDER_RESERVED" | "LOW_CONFIDENCE";

export interface AllocatedHolding {
  /** Active yield instrument */
  instrument: Instrument;

  /** Active deployed principal balance held in this instrument */
  currentAmount: Money;
}

export interface LiquidationOrder {
  /** Identifier of the liquidated instrument */
  instrumentId: string;

  /** Display name of the instrument */
  instrumentName: string;

  /** Gross amount pulled from the holding */
  amountToLiquidate: Money;

  /** Penalty rate applied (decimal fraction) */
  penaltyRate: number;

  /** Realized penalty fee deducted upon liquidation */
  realizedPenalty: Money;

  /** Net cash returned to available bank liquidity: amountToLiquidate - realizedPenalty */
  netRecoveredCash: Money;

  /** Hours required for settlement (0 for instant) */
  settlementLagHours: number;

  /** Remaining balance in the instrument after this liquidation */
  remainingHolding: Money;
}

export interface LiquidationPlan {
  /** Step-by-step liquidation orders prioritized by lowest penalty and fastest settlement */
  orders: LiquidationOrder[];

  /** Total gross amount pulled from holdings */
  totalGrossLiquidated: Money;

  /** Total penalty fees incurred across all liquidations */
  totalRealizedPenalties: Money;

  /** Total net cash added back to liquid reserves */
  totalNetRecoveredCash: Money;

  /** Target deficit that needed recovery: R - C */
  targetDeficit: Money;

  /** Remaining unrecovered reserve gap if holdings were insufficient */
  residualReserveGap: Money;

  /** True if net recovered cash completely eliminated the deficit */
  isFullyCovered: boolean;
}

export interface DecisionContext {
  /** Available unencumbered cash balance (C) */
  availableCash: Money;

  /** Expected cumulative flow over horizon H: mu_H */
  expectedCumulativeFlow: Money;

  /** Worst-case residual shortfall from backtest: q_H(alpha) */
  worstCaseResidualShortfall: Money;

  /** Backtest sample size N (number of evaluated windows) */
  sampleSize: number;

  /** Model MASE score */
  mase: number;

  /** Currently deployed holdings in yield instruments */
  currentHoldings: readonly AllocatedHolding[];

  /** Available instruments for new deployment */
  availableInstruments: readonly Instrument[];

  /** Tier 1 fixed operational floor buffer (F) */
  operationalFloor: Money;

  /** Tier 2/3 stress add-on (Z, default $0) */
  stressAddOn?: Money;

  /** Planning horizon H in hours (default: 24) */
  horizonHours?: number;

  /** Optional decision thresholds */
  thresholds?: {
    /** Minimum backtest sample size required for high confidence (default: 30) */
    minSampleSize?: number;

    /** Maximum acceptable MASE before flagging forecast unreliability (default: 1.20) */
    maxMase?: number;

    /** Multiplier applied to operational floor during LOW_CONFIDENCE fallback (default: 1.5) */
    conservativeBufferMultiplier?: number;
  };
}

export interface LiquidityDecision {
  /** Unique decision ID */
  id: string;

  /** Timestamp when decision was formulated */
  timestamp: Date;

  /** Operational liquidity status */
  status: DecisionStatus;

  /** Computed required liquid reserve R */
  requiredReserve: Money;

  /** Detailed breakdown of reserve calculation */
  reserveDetails: ReserveCalculationResult;

  /** Available cash balance C */
  availableCash: Money;

  /** Liquidity coverage ratio C / R */
  coverageRatio: number;

  /** Deployable surplus (C - R if HEALTHY, strictly $0 otherwise) */
  deployableSurplus: Money;

  /** Reserve gap if C < R (R - C), otherwise $0 */
  reserveGap: Money;

  /** New instrument allocations if HEALTHY (empty array otherwise) */
  allocations: InstrumentAllocation[];

  /** Liquidation plan if UNDER_RESERVED (empty plan otherwise) */
  liquidationPlan: LiquidationPlan;

  /** Actionable warnings and alerts */
  warnings: string[];

  /** Human-readable explanation conforming to DATA_MODEL.md */
  explanation: string;
}

/**
 * Determines which instruments to liquidate to cover a liquidity deficit (R - C).
 * Prioritizes:
 * 1. Lowest penalty rate first (to minimize realized fees)
 * 2. Shortest settlement lag first (to restore instant liquidity)
 * 3. Largest balance first (to minimize fragmentation)
 */
export function solveLiquidation(
  deficit: Money,
  holdings: readonly AllocatedHolding[]
): LiquidationPlan {
  const currency = deficit.currency;

  if (deficit.isZero() || deficit.isNegative() || holdings.length === 0) {
    return {
      orders: [],
      totalGrossLiquidated: Money.zero(currency),
      totalRealizedPenalties: Money.zero(currency),
      totalNetRecoveredCash: Money.zero(currency),
      targetDeficit: deficit.clampNonNegative(),
      residualReserveGap: deficit.clampNonNegative(),
      isFullyCovered: deficit.isZero() || deficit.isNegative(),
    };
  }

  // Filter holdings with positive balance
  interface EvaluatedHolding {
    holding: AllocatedHolding;
    penaltyRate: number;
    settlementLag: number;
    amount: Money;
  }

  const activeHoldings: EvaluatedHolding[] = [];
  for (const h of holdings) {
    if (h.currentAmount.isPositive()) {
      activeHoldings.push({
        holding: h,
        penaltyRate: normalizePenalty(h.instrument.withdrawalPenalty),
        settlementLag: h.instrument.settlementLagHours ?? 0,
        amount: h.currentAmount,
      });
    }
  }

  // Sort: 1) penaltyRate asc, 2) settlementLag asc, 3) balance desc
  activeHoldings.sort((a, b) => {
    if (a.penaltyRate !== b.penaltyRate) {
      return a.penaltyRate - b.penaltyRate;
    }
    if (a.settlementLag !== b.settlementLag) {
      return a.settlementLag - b.settlementLag;
    }
    return Number(b.amount.amountMinor - a.amount.amountMinor);
  });

  const orders: LiquidationOrder[] = [];
  let remainingNetDeficit = deficit;

  let totalGrossLiquidated = Money.zero(currency);
  let totalRealizedPenalties = Money.zero(currency);
  let totalNetRecoveredCash = Money.zero(currency);

  for (const item of activeHoldings) {
    if (remainingNetDeficit.isZero()) {
      break;
    }

    const { holding, penaltyRate, settlementLag, amount: holdingAmount } = item;

    // To recover remainingNetDeficit net cash:
    // net = gross * (1 - penaltyRate) => gross = ceil(net / (1 - penaltyRate))
    const netMultiplier = Math.max(0.0001, 1 - penaltyRate);
    const grossNeededMinor = BigInt(
      Math.ceil(Number(remainingNetDeficit.amountMinor) / netMultiplier)
    );
    const grossNeeded = Money.fromMinor(grossNeededMinor, currency);

    // Liquidate min(holdingAmount, grossNeeded)
    const amountToLiquidate = Money.min(holdingAmount, grossNeeded);

    // Realized penalty: amountToLiquidate * penaltyRate
    const realizedPenalty = amountToLiquidate.multiply(penaltyRate, "half-even");
    const netRecoveredCash = amountToLiquidate.subtract(realizedPenalty);
    const remainingHolding = holdingAmount.subtract(amountToLiquidate);

    orders.push({
      instrumentId: holding.instrument.id,
      instrumentName: holding.instrument.name,
      amountToLiquidate,
      penaltyRate,
      realizedPenalty,
      netRecoveredCash,
      settlementLagHours: settlementLag,
      remainingHolding,
    });

    totalGrossLiquidated = totalGrossLiquidated.add(amountToLiquidate);
    totalRealizedPenalties = totalRealizedPenalties.add(realizedPenalty);
    totalNetRecoveredCash = totalNetRecoveredCash.add(netRecoveredCash);

    if (netRecoveredCash.greaterThanOrEqual(remainingNetDeficit)) {
      remainingNetDeficit = Money.zero(currency);
    } else {
      remainingNetDeficit = remainingNetDeficit.subtract(netRecoveredCash);
    }
  }

  const residualReserveGap = remainingNetDeficit;
  const isFullyCovered = residualReserveGap.isZero();

  return {
    orders,
    totalGrossLiquidated,
    totalRealizedPenalties,
    totalNetRecoveredCash,
    targetDeficit: deficit,
    residualReserveGap,
    isFullyCovered,
  };
}

/**
 * Orchestrates liquidity decisions across operational states:
 * HEALTHY, UNDER_RESERVED, and LOW_CONFIDENCE.
 */
export function evaluateLiquidityDecision(context: DecisionContext): LiquidityDecision {
  const {
    availableCash,
    expectedCumulativeFlow,
    worstCaseResidualShortfall,
    sampleSize,
    mase,
    currentHoldings,
    availableInstruments,
    operationalFloor,
    stressAddOn = Money.zero(availableCash.currency),
    horizonHours = 24,
    thresholds,
  } = context;

  const minSampleSize = thresholds?.minSampleSize ?? 30;
  const maxMase = thresholds?.maxMase ?? 1.2;
  const conservativeMultiplier = thresholds?.conservativeBufferMultiplier ?? 1.5;

  const currency = availableCash.currency;
  const warnings: string[] = [];

  // 1. Evaluate Confidence Conditions
  const isSampleScarce = sampleSize < minSampleSize;
  const isMasePoor = Number.isFinite(mase) && mase > maxMase;
  const isLowConfidence = isSampleScarce || isMasePoor;

  if (isSampleScarce) {
    warnings.push(
      `Insufficient backtest history sample size (${sampleSize} < ${minSampleSize} windows). Model reliability unconfirmed.`
    );
  }
  if (isMasePoor) {
    warnings.push(
      `Model accuracy below baseline standard: MASE is ${mase.toFixed(2)} (exceeds threshold of ${maxMase.toFixed(2)}). Forecast has negative skill.`
    );
  }

  // Determine operational floor to use
  let effectiveFloor = operationalFloor;
  if (isLowConfidence && conservativeMultiplier > 1) {
    effectiveFloor = operationalFloor.multiply(conservativeMultiplier, "half-even");
    warnings.push(
      `Low confidence triggers conservative buffer: operational floor increased by ${conservativeMultiplier}x to ${effectiveFloor.format()}.`
    );
  }

  // 2. Compute Required Reserve R
  const reserveDetails = computeRequiredReserve({
    expectedCumulativeFlow,
    worstCaseResidualShortfall,
    operationalFloor: effectiveFloor,
    stressAddOn,
  });

  const R = reserveDetails.requiredReserve;
  const C = availableCash;

  const isUnderReserved = C.lessThan(R);
  const coverageRatio = R.isZero()
    ? Number.POSITIVE_INFINITY
    : C.toDecimal() / R.toDecimal();

  const now = new Date();
  const decisionId = `dec-${now.getTime()}-${Math.floor(Math.random() * 10000)}`;

  // 3. State Machine Transition
  if (isUnderReserved) {
    // STATE: UNDER_RESERVED
    const deficit = R.subtract(C);
    warnings.push(
      `CRITICAL: Liquidity deficit of ${deficit.format()} detected. Available cash (${C.format()}) is insufficient to meet required reserve (${R.format()}). Coverage is ${(coverageRatio * 100).toFixed(1)}%.`
    );

    const liquidationPlan = solveLiquidation(deficit, currentHoldings);

    if (!liquidationPlan.isFullyCovered) {
      warnings.push(
        `EMERGENCY: Active holdings (${liquidationPlan.totalNetRecoveredCash.format()} net recoverable) cannot fully cover deficit. Uncovered residual gap: ${liquidationPlan.residualReserveGap.format()}.`
      );
    }

    const explanation = `Bank is UNDER_RESERVED with a deficit of ${deficit.format()}. Deployable surplus is $0.00. Liquidation plan formulated to recover ${liquidationPlan.totalNetRecoveredCash.format()} net cash across ${liquidationPlan.orders.length} instruments with ${liquidationPlan.totalRealizedPenalties.format()} in realized early-exit penalties.`;

    return {
      id: decisionId,
      timestamp: now,
      status: "UNDER_RESERVED",
      requiredReserve: R,
      reserveDetails,
      availableCash: C,
      coverageRatio,
      deployableSurplus: Money.zero(currency),
      reserveGap: deficit,
      allocations: [],
      liquidationPlan,
      warnings,
      explanation,
    };
  }

  if (isLowConfidence) {
    // STATE: LOW_CONFIDENCE (C >= R, but confidence thresholds violated)
    warnings.push(
      `HALT: Surplus yield deployment suspended due to LOW_CONFIDENCE state. Preserving full liquidity in cash.`
    );

    const emptyLiquidation: LiquidationPlan = {
      orders: [],
      totalGrossLiquidated: Money.zero(currency),
      totalRealizedPenalties: Money.zero(currency),
      totalNetRecoveredCash: Money.zero(currency),
      targetDeficit: Money.zero(currency),
      residualReserveGap: Money.zero(currency),
      isFullyCovered: true,
    };

    const explanation = `Liquidity position is solvent (Coverage: ${(coverageRatio * 100).toFixed(1)}%), but forecasting confidence is LOW (${isSampleScarce ? "sparse backtest" : "high MASE"}). Deployments are halted and cash is retained in liquid buffer under expanded operational floor.`;

    return {
      id: decisionId,
      timestamp: now,
      status: "LOW_CONFIDENCE",
      requiredReserve: R,
      reserveDetails,
      availableCash: C,
      coverageRatio,
      deployableSurplus: Money.zero(currency),
      reserveGap: Money.zero(currency),
      allocations: [],
      liquidationPlan: emptyLiquidation,
      warnings,
      explanation,
    };
  }

  // STATE: HEALTHY (C >= R and confidence satisfied)
  const surplus = C.subtract(R);
  const optimization = optimizeAllocation(surplus, availableInstruments, {
    horizonHours,
  });

  const emptyLiquidation: LiquidationPlan = {
    orders: [],
    totalGrossLiquidated: Money.zero(currency),
    totalRealizedPenalties: Money.zero(currency),
    totalNetRecoveredCash: Money.zero(currency),
    targetDeficit: Money.zero(currency),
    residualReserveGap: Money.zero(currency),
    isFullyCovered: true,
  };

  const explanation = `Bank liquidity is HEALTHY. Coverage is ${(coverageRatio * 100).toFixed(1)}% against required reserve of ${R.format()}. Deployable surplus of ${surplus.format()} allocated across ${optimization.allocations.filter((a) => a.allocated.isPositive()).length} instruments delivering ${optimization.effectiveNetApyBps} bps effective net APY.`;

  return {
    id: decisionId,
    timestamp: now,
    status: "HEALTHY",
    requiredReserve: R,
    reserveDetails,
    availableCash: C,
    coverageRatio,
    deployableSurplus: surplus,
    reserveGap: Money.zero(currency),
    allocations: optimization.allocations,
    liquidationPlan: emptyLiquidation,
    warnings,
    explanation,
  };
}
