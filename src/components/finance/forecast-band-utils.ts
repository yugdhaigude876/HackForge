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
 * Builds unified chart points combining historical actuals and future forecast
 * with confidence bands computed from residual metrics.
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

  // 3. Process forecast points with expanding uncertainty cone sqrt(h)
  for (let h = 0; h < predictions.length; h++) {
    const f = predictions[h];
    const stepNum = h + 1;
    const label =
      f.hour !== undefined
        ? typeof f.hour === "number"
          ? `+${f.hour}h`
          : String(f.hour)
        : `+${stepNum}h`;

    // Expanding confidence cone over horizon: sqrt((h+1)/horizon)
    const coneExpansion = Math.sqrt((h + 1) / horizon);
    const halfWidth = Math.round(baseSpread * (0.8 + 0.6 * coneExpansion));

    const lower = Math.round(f.mean - halfWidth);
    const upper = Math.round(f.mean + halfWidth);

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
