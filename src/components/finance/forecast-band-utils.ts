/**
 * Pure functions for preparing time-series history, forecast mean,
 * and uncertainty bands from backtest residual quantiles.
 */

export interface HistoryInputPoint {
  hour?: string | number;
  ts?: string | Date;
  net: number;
}

export interface ForecastInputPoint {
  hour?: string | number;
  ts?: string | Date;
  mean: number;
  bandLower?: number;
  bandUpper?: number;
}

export interface ResidualQuantilesConfig {
  mae?: number;
  mase?: number;
  pinballLoss?: number;
  worstCaseResidualShortfall?: number;
  q05?: number;
  q95?: number;
}

export interface ForecastBandPoint {
  step: string;
  actual: number | null;
  mean: number | null;
  bandLower: number | null;
  bandUpper: number | null;
  bandRange: [number, number] | null;
}

/**
 * Calculates allocation / utilization percentage safely using BigInt arithmetic
 * to prevent IEEE 754 precision loss on values exceeding 2^53.
 */
export function calculateAllocationPercentage(
  amountMinor: string | bigint | number,
  capacityMinor: string | bigint | number
): number {
  const amt = BigInt(amountMinor);
  const cap = BigInt(capacityMinor);
  if (cap <= 0n) return 0;
  if (amt <= 0n) return 0;
  if (amt >= cap) return 100;

  // Scale by 10,000 for 2 decimal places precision in integer math
  const scaledBps = (amt * 10000n) / cap;
  return Math.min(100, Math.max(0, Number(scaledBps) / 100));
}

/**
 * Builds unified chart points combining historical actuals and future forecast
 * with confidence bands computed from residual metrics or stored quantile bands.
 */
export function buildForecastBandSeries(
  history: readonly HistoryInputPoint[],
  predictions: readonly ForecastInputPoint[],
  residualMetrics?: ResidualQuantilesConfig
): ForecastBandPoint[] {
  const result: ForecastBandPoint[] = [];

  // 1. Process history points
  for (let i = 0; i < history.length; i++) {
    const pt = history[i];
    const label =
      pt.hour !== undefined
        ? typeof pt.hour === "number"
          ? `${pt.hour}h`
          : String(pt.hour)
        : `-${history.length - i}h`;

    result.push({
      step: label,
      actual: pt.net,
      mean: null,
      bandLower: null,
      bandUpper: null,
      bandRange: null,
    });
  }

  // Determine uncertainty scale (in minor units or data scale)
  // Default base spread from MAE or pinballLoss or 10% of mean magnitude if not supplied
  const baseSpread = Math.max(
    Math.abs(residualMetrics?.q95 ?? 0),
    Math.abs(residualMetrics?.worstCaseResidualShortfall ?? 0),
    (residualMetrics?.mae ?? 0) * 1.5,
    (residualMetrics?.pinballLoss ?? 0) * 2.0,
    1_000_000_00 // fallback $1M
  );

  // 2. Connect horizon expansion
  const horizon = Math.max(predictions.length, 1);

  // 3. Process forecast points: use real stored quantile bands if present, or expanding cone fallback
  for (let h = 0; h < predictions.length; h++) {
    const f = predictions[h];
    const stepNum = h + 1;
    const label =
      f.hour !== undefined
        ? typeof f.hour === "number"
          ? `+${f.hour}h`
          : String(f.hour)
        : `+${stepNum}h`;

    let lower: number;
    let upper: number;

    if (f.bandLower !== undefined && f.bandUpper !== undefined) {
      // Use exact empirical residual quantiles from the backtest
      lower = Math.round(f.bandLower);
      upper = Math.round(f.bandUpper);
    } else {
      // Expanding confidence cone over horizon: sqrt((h+1)/horizon)
      const coneExpansion = Math.sqrt((h + 1) / horizon);
      const halfWidth = Math.round(baseSpread * (0.8 + 0.6 * coneExpansion));
      lower = Math.round(f.mean - halfWidth);
      upper = Math.round(f.mean + halfWidth);
    }

    result.push({
      step: label,
      actual: null,
      mean: f.mean,
      bandLower: lower,
      bandUpper: upper,
      bandRange: [lower, upper],
    });
  }

  return result;
}
