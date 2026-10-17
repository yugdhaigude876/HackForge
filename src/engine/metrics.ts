/**
 * Reserve Juggler - Forecast Evaluation Metrics
 *
 * Implements statistical metrics for liquidity forecast accuracy and risk evaluation:
 * - MAE (Mean Absolute Error)
 * - MASE (Mean Absolute Scaled Error) against seasonal/non-seasonal naive baselines
 * - Pinball Loss (Quantile Loss) for probabilistic forecasts and risk-based reserves
 */

import { Money } from "@/engine/money";
import { HourlyBucket } from "@/engine/models";

export interface MAEResult {
  /** Mean Absolute Error in minor units (cents) */
  maeMinor: number;
  /** Mean Absolute Error in standard dollars */
  maeDollars: number;
}

/**
 * Calculates Mean Absolute Error (MAE) between actuals and predictions.
 */
export function calculateMAE(
  actuals: readonly Money[],
  predictions: readonly Money[]
): MAEResult {
  if (actuals.length === 0) {
    return { maeMinor: 0, maeDollars: 0 };
  }
  if (actuals.length !== predictions.length) {
    throw new Error(
      `actuals length (${actuals.length}) does not match predictions length (${predictions.length})`
    );
  }

  let totalAbsDiffMinor = 0n;
  for (let i = 0; i < actuals.length; i++) {
    const diff = actuals[i].subtract(predictions[i]).abs();
    totalAbsDiffMinor += diff.amountMinor;
  }

  const maeMinor = Number(totalAbsDiffMinor) / actuals.length;
  const maeDollars = maeMinor / 100;

  return { maeMinor, maeDollars };
}

/**
 * Calculates in-sample naive baseline MAE to serve as the scaling denominator Q for MASE.
 *
 * For seasonal series with period m (default 168 for weekly):
 * Q = (1 / (T - m)) * sum_{t = m + 1}^T |y_t - y_{t - m}|
 *
 * If history is shorter than (seasonalLag + 1), falls back to 1-step naive:
 * Q = (1 / (T - 1)) * sum_{t = 2}^T |y_t - y_{t - 1}|
 */
export function calculateInSampleScaleMAE(
  history: readonly HourlyBucket[],
  seasonalLag = 168
): number {
  const T = history.length;
  if (T < 2) {
    return 0;
  }

  // Use seasonal difference if sufficient history, else 1-step naive difference
  const lag = T > seasonalLag ? seasonalLag : 1;
  const validComparisons = T - lag;

  let sumDiffMinor = 0n;
  for (let t = lag; t < T; t++) {
    const diff = history[t].netFlow.subtract(history[t - lag].netFlow).abs();
    sumDiffMinor += diff.amountMinor;
  }

  return Number(sumDiffMinor) / validComparisons;
}

/**
 * Calculates Mean Absolute Scaled Error (MASE).
 *
 * MASE = MAE / Q
 * where Q is the mean absolute error of the in-sample naive (or seasonal naive) benchmark.
 *
 * Interpretation:
 * - MASE < 1.0: Model outperforms the baseline
 * - MASE = 1.0: Model performs identically to baseline
 * - MASE > 1.0: Model performs worse than baseline
 */
export function calculateMASE(
  actuals: readonly Money[],
  predictions: readonly Money[],
  inSampleScaleMAE: number
): number {
  if (actuals.length === 0) {
    return 0;
  }
  if (inSampleScaleMAE <= 0) {
    // If the baseline has 0 error (e.g. constant series), MASE is 0 if forecast is perfect, else Infinity
    const { maeMinor } = calculateMAE(actuals, predictions);
    return maeMinor === 0 ? 0 : Number.POSITIVE_INFINITY;
  }

  const { maeMinor } = calculateMAE(actuals, predictions);
  return maeMinor / inSampleScaleMAE;
}

/**
 * Calculates Pinball Loss (Quantile Loss) at a specific quantile tau in (0, 1).
 *
 * L_tau(y, q) = max(tau * (y - q), (1 - tau) * (q - y))
 *
 * Crucial for evaluating risk-based reserves:
 * - If actual > forecast (shortfall/under-predicted): penalized by tau
 * - If actual < forecast (surplus/over-predicted): penalized by (1 - tau)
 * - At tau = 0.5, Pinball Loss = 0.5 * MAE
 */
export function calculatePinballLoss(
  actuals: readonly Money[],
  predictions: readonly Money[],
  tau: number
): { lossMinor: number; lossDollars: number } {
  if (tau <= 0 || tau >= 1 || !Number.isFinite(tau)) {
    throw new Error(`tau must be strictly between 0 and 1, received: ${tau}`);
  }
  if (actuals.length === 0) {
    return { lossMinor: 0, lossDollars: 0 };
  }
  if (actuals.length !== predictions.length) {
    throw new Error(
      `actuals length (${actuals.length}) does not match predictions length (${predictions.length})`
    );
  }

  let totalLossMinor = 0;
  for (let i = 0; i < actuals.length; i++) {
    // u = actual - prediction (in dollars or minor)
    const actualMinor = Number(actuals[i].amountMinor);
    const predMinor = Number(predictions[i].amountMinor);
    const u = actualMinor - predMinor;

    const loss = u >= 0 ? tau * u : (tau - 1) * u;
    totalLossMinor += loss;
  }

  const lossMinor = totalLossMinor / actuals.length;
  const lossDollars = lossMinor / 100;

  return { lossMinor, lossDollars };
}
