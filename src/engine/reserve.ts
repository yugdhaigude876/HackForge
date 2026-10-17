/**
 * Reserve Juggler - Risk-Based Liquid Reserve & Deployable Surplus Engine
 *
 * Implements the financial liquidity reserve model conforming to FINANCIAL_MODEL.md:
 * R = max(0, -(mu_H + q_H(alpha))) + F + Z
 * Surplus = max(0, C - R)
 *
 * Extracts empirical residual quantiles from rolling-origin backtests to quantify
 * worst-case net cash outflows and compute deployable surpluses for yield allocation.
 */

import { Money } from "@/engine/money";
import { EvaluatedWindow } from "@/engine/forecast";

export type LiquidityStatus = "HEALTHY" | "UNDER_RESERVED" | "LOW_CONFIDENCE";

/**
 * Calculates a specific quantile (percentile) from an array of numbers using linear interpolation.
 *
 * @param values Array of numbers (may be positive, negative, or zero)
 * @param q Quantile fraction in [0, 1] (e.g., 0.01 for 1st percentile, 0.95 for 95th percentile)
 * @returns Interpolated quantile value
 */
export function calculateQuantile(values: readonly number[], q: number): number {
  if (values.length === 0) {
    throw new Error("Cannot compute quantile of empty array");
  }
  if (q < 0 || q > 1 || !Number.isFinite(q)) {
    throw new Error(`Quantile q must be between 0 and 1 inclusive, received: ${q}`);
  }

  if (values.length === 1) {
    return values[0];
  }

  // Sort values ascending
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;

  // Linear interpolation: rank index r in [0, n - 1]
  const r = q * (n - 1);
  const lowerIndex = Math.floor(r);
  const upperIndex = Math.ceil(r);
  const weight = r - lowerIndex;

  if (lowerIndex === upperIndex) {
    return sorted[lowerIndex];
  }

  return sorted[lowerIndex] + weight * (sorted[upperIndex] - sorted[lowerIndex]);
}

/**
 * Extracts cumulative horizon residuals (S_H - mu_H) across all evaluated backtest windows.
 *
 * For each window:
 * Cumulative residual e_H = sum_{h=1}^H (actual_{t+h} - prediction_{t+h})
 */
export function extractCumulativeResiduals(
  windows: readonly EvaluatedWindow[]
): Money[] {
  if (windows.length === 0) {
    return [];
  }

  const currency = windows[0].residuals[0]?.currency ?? "USD";

  return windows.map((w) => {
    let sumMinor = 0n;
    for (const res of w.residuals) {
      sumMinor += res.amountMinor;
    }
    return Money.fromMinor(sumMinor, currency);
  });
}

/**
 * Computes the empirical residual quantile q_H(alpha) from an array of Money residuals.
 *
 * @param residuals Array of cumulative horizon residuals
 * @param alpha Miss tolerance / tail risk level (e.g., 0.01 for 99% confidence, 0.05 for 95%)
 */
export function calculateResidualQuantile(
  residuals: readonly Money[],
  alpha: number
): Money {
  if (residuals.length === 0) {
    throw new Error("Cannot compute residual quantile from empty residuals array");
  }

  const currency = residuals[0].currency;
  const numbersMinor = residuals.map((r) => Number(r.amountMinor));
  const quantileMinor = calculateQuantile(numbersMinor, alpha);

  return Money.fromMinor(Math.round(quantileMinor), currency);
}

export interface ReserveCalculationParams {
  /** Expected cumulative net flow over planning horizon: mu_H = sum_{h=1}^H N_hat_{t+h} */
  expectedCumulativeFlow: Money;

  /**
   * Worst-case residual shortfall at level alpha: q_H(alpha).
   * Typically negative, reflecting unexpected additional outflows beyond forecast.
   */
  worstCaseResidualShortfall: Money;

  /** Fixed operational buffer floor F (Tier 1 buffer) */
  operationalFloor: Money;

  /** Optional stress add-on Z (Tier 2/3 add-on from scenario stress testing, default $0) */
  stressAddOn?: Money;
}

export interface ReserveCalculationResult {
  /** Total required liquid cash reserve R = expectedOutflowCover + F + Z */
  requiredReserve: Money;

  /** Cash needed to cover expected + worst-case net outflows: max(0, -(mu_H + q_H(alpha))) */
  expectedOutflowCover: Money;

  /** Fixed operational floor buffer (F) */
  operationalFloor: Money;

  /** Stress scenario add-on (Z) */
  stressAddOn: Money;

  /** Expected cumulative flow (mu_H) */
  expectedCumulativeFlow: Money;

  /** Worst-case residual shortfall q_H(alpha) */
  worstCaseResidualShortfall: Money;
}

/**
 * Computes required liquid reserve R according to FINANCIAL_MODEL.md:
 * R = max(0, -(mu_H + q_H(alpha))) + F + Z
 */
export function computeRequiredReserve(
  params: ReserveCalculationParams
): ReserveCalculationResult {
  const {
    expectedCumulativeFlow,
    worstCaseResidualShortfall,
    operationalFloor,
    stressAddOn = Money.zero(expectedCumulativeFlow.currency),
  } = params;

  operationalFloor.assertNonNegative("operationalFloor must be non-negative");
  stressAddOn.assertNonNegative("stressAddOn must be non-negative");

  // Net worst-case flow over horizon: mu_H + q_H(alpha)
  const netWorstCaseFlow = expectedCumulativeFlow.add(worstCaseResidualShortfall);

  // If net worst case is negative (outflow), we must hold its positive magnitude
  const expectedOutflowCover = netWorstCaseFlow.isNegative()
    ? netWorstCaseFlow.abs()
    : Money.zero(expectedCumulativeFlow.currency);

  const requiredReserve = expectedOutflowCover
    .add(operationalFloor)
    .add(stressAddOn);

  return {
    requiredReserve,
    expectedOutflowCover,
    operationalFloor,
    stressAddOn,
    expectedCumulativeFlow,
    worstCaseResidualShortfall,
  };
}

export interface SurplusCalculationParams {
  /** Total currently available cash balance (C) */
  totalCash: Money;

  /** Required liquid reserve (R) */
  requiredReserve: Money;

  /** Flag indicating low historical confidence (e.g. small sample or skill <= 0) */
  isLowConfidence?: boolean;
}

export interface SurplusCalculationResult {
  /** Total cash available C */
  totalCash: Money;

  /** Required liquid reserve R */
  requiredReserve: Money;

  /** Deployable surplus: max(0, C - R) */
  deployableSurplus: Money;

  /** Reserve gap if under-reserved: max(0, R - C) */
  reserveGap: Money;

  /** Liquidity coverage ratio (C / R) */
  coverageRatio: number;

  /** Financial liquidity status */
  status: LiquidityStatus;

  /** Human-readable explanation */
  explanation: string;
}

/**
 * Computes deployable surplus and liquidity coverage status:
 * Surplus = max(0, C - R)
 */
export function computeDeployableSurplus(
  params: SurplusCalculationParams
): SurplusCalculationResult {
  const { totalCash, requiredReserve, isLowConfidence = false } = params;

  totalCash.assertNonNegative("totalCash must be non-negative");
  requiredReserve.assertNonNegative("requiredReserve must be non-negative");

  const currency = totalCash.currency;

  if (totalCash.greaterThanOrEqual(requiredReserve)) {
    const deployableSurplus = totalCash.subtract(requiredReserve);
    const reserveGap = Money.zero(currency);
    const coverageRatio = requiredReserve.isZero()
      ? Number.POSITIVE_INFINITY
      : totalCash.toDecimal() / requiredReserve.toDecimal();

    const status: LiquidityStatus = isLowConfidence ? "LOW_CONFIDENCE" : "HEALTHY";
    const explanation = isLowConfidence
      ? `Cash covers reserve requirement ($${requiredReserve.format()}), but historical sample confidence is low. Deploy with caution.`
      : `Surplus of ${deployableSurplus.format()} is safe to deploy across yield instruments. Reserve fully secured.`;

    return {
      totalCash,
      requiredReserve,
      deployableSurplus,
      reserveGap,
      coverageRatio,
      status,
      explanation,
    };
  } else {
    // Under-reserved state (C < R)
    const deployableSurplus = Money.zero(currency);
    const reserveGap = requiredReserve.subtract(totalCash);
    const coverageRatio = requiredReserve.isZero()
      ? 1
      : totalCash.toDecimal() / requiredReserve.toDecimal();

    return {
      totalCash,
      requiredReserve,
      deployableSurplus,
      reserveGap,
      coverageRatio,
      status: "UNDER_RESERVED",
      explanation: `Liquidity shortfall: Cash balance (${totalCash.format()}) is below required reserve (${requiredReserve.format()}). Gap is ${reserveGap.format()}. Recommend redeeming liquid instruments.`,
    };
  }
}

export interface ReserveCalculatorOptions {
  /** Risk tolerance alpha (default: 0.01 for 99% confidence level) */
  alpha?: number;

  /** Operational floor buffer F (default: $0.00) */
  operationalFloor?: Money;

  /** Stress add-on Z (default: $0.00) */
  stressAddOn?: Money;

  /** Minimum backtest sample size required for high confidence (default: 30) */
  minSampleSize?: number;
}

/**
 * High-level ReserveCalculator module.
 * Integrates backtest empirical residuals, active forecast, and bank balances.
 */
export class ReserveCalculator {
  readonly alpha: number;
  readonly operationalFloor: Money;
  readonly stressAddOn: Money;
  readonly minSampleSize: number;

  constructor(options?: ReserveCalculatorOptions) {
    this.alpha = options?.alpha ?? 0.01;
    this.operationalFloor = options?.operationalFloor ?? Money.zero();
    this.stressAddOn = options?.stressAddOn ?? Money.zero();
    this.minSampleSize = options?.minSampleSize ?? 30;

    if (this.alpha <= 0 || this.alpha >= 1 || !Number.isFinite(this.alpha)) {
      throw new Error(`alpha must be in (0, 1), received: ${this.alpha}`);
    }
  }

  /**
   * Calculates required liquid reserve and deployable surplus from an active forecast and backtest windows.
   *
   * @param activeForecast Multi-step forecast Money[] for horizon H
   * @param backtestWindows Historical backtest windows with ground truth actuals & predictions
   * @param totalCash Available liquid cash C
   */
  calculate(
    activeForecast: readonly Money[],
    backtestWindows: readonly EvaluatedWindow[],
    totalCash: Money
  ): {
    reserve: ReserveCalculationResult;
    surplus: SurplusCalculationResult;
    residualQuantile: Money;
    sampleSize: number;
    isLowConfidence: boolean;
  } {
    if (activeForecast.length === 0) {
      throw new Error("activeForecast cannot be empty");
    }

    const currency = activeForecast[0].currency;
    const expectedCumulativeFlow = Money.sum(activeForecast, currency);

    // Cumulative residuals across backtest windows
    const cumulativeResiduals = extractCumulativeResiduals(backtestWindows);
    const sampleSize = cumulativeResiduals.length;
    const isLowConfidence = sampleSize < this.minSampleSize;

    let residualQuantile: Money;
    if (sampleSize > 0) {
      residualQuantile = calculateResidualQuantile(cumulativeResiduals, this.alpha);
    } else {
      // Conservative default if zero backtest windows available
      residualQuantile = Money.zero(currency);
    }

    const reserve = computeRequiredReserve({
      expectedCumulativeFlow,
      worstCaseResidualShortfall: residualQuantile,
      operationalFloor: this.operationalFloor,
      stressAddOn: this.stressAddOn,
    });

    const surplus = computeDeployableSurplus({
      totalCash,
      requiredReserve: reserve.requiredReserve,
      isLowConfidence,
    });

    return {
      reserve,
      surplus,
      residualQuantile,
      sampleSize,
      isLowConfidence,
    };
  }
}
