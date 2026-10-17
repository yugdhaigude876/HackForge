/**
 * Reserve Juggler - Forecasting Engine & Backtest Harness
 *
 * Implements benchmark time-series forecasters (Naive, Seasonal Naive)
 * and the rolling-origin evaluation harness for backtesting net cash flow predictions.
 */

import { Money } from "@/engine/money";
import { HourlyBucket } from "@/engine/models";
import { RollingWindow } from "@/engine/timeseries";

export class InsufficientHistoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsufficientHistoryError";
  }
}

export class InvalidForecastParameterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidForecastParameterError";
  }
}

/**
 * Common interface for all cash flow forecasters.
 */
export interface Forecaster {
  /** Descriptive identifier of the model */
  readonly name: string;

  /** Human-readable explanation of forecasting mechanism */
  readonly description?: string;

  /**
   * Forecasts net cash flow for horizonHours steps ahead.
   *
   * @param history Strictly continuous historical hourly sequence ending at asOf
   * @param horizonHours Steps ahead to predict (H >= 1)
   * @returns Array of predicted netFlow Money amounts of length horizonHours
   */
  predict(history: readonly HourlyBucket[], horizonHours: number): Money[];
}

/**
 * Naive Forecaster Benchmark
 *
 * Projects the last observed net flow value forward as a flat line:
 * y_{t+h} = y_t for all h = 1..H.
 */
export class NaiveForecaster implements Forecaster {
  readonly name = "Naive (Flat Line)";
  readonly description = "Projects the last observed hourly net flow flat across the forecast horizon.";

  predict(history: readonly HourlyBucket[], horizonHours: number): Money[] {
    if (horizonHours <= 0 || !Number.isInteger(horizonHours)) {
      throw new InvalidForecastParameterError(
        `horizonHours must be a positive integer, received: ${horizonHours}`
      );
    }

    if (history.length === 0) {
      throw new InsufficientHistoryError(
        "Naive forecaster requires at least 1 historical observation, but received empty history."
      );
    }

    const lastObserved = history[history.length - 1].netFlow;
    return Array.from({ length: horizonHours }, () => lastObserved);
  }
}

export interface SeasonalNaiveOptions {
  /** Seasonal cycle period in hours (default: 168 for weekly seasonality on hourly data) */
  seasonalLag?: number;

  /**
   * If true, falls back gracefully to a flat naive forecast when history is shorter
   * than seasonalLag instead of throwing an error. Default: false.
   */
  fallbackToNaive?: boolean;
}

/**
 * Seasonal Naive Forecaster Benchmark (FPP3 Definition)
 *
 * Sets each forecast to equal the observed value from the same time in the previous cycle:
 * y_{t+h} = y_{t+h-m(k+1)} where m is seasonalLag (168 for weekly) and k is floor((h-1)/m).
 */
export class SeasonalNaiveForecaster implements Forecaster {
  readonly name = "Seasonal Naive (Same Hour Last Week)";
  readonly description =
    "Projects values from the exact same hour in the previous seasonal cycle (168h weekly lag).";
  readonly seasonalLag: number;
  readonly fallbackToNaive: boolean;

  constructor(options?: SeasonalNaiveOptions) {
    this.seasonalLag = options?.seasonalLag ?? 168; // 24 * 7 hours
    this.fallbackToNaive = options?.fallbackToNaive ?? false;

    if (this.seasonalLag <= 0 || !Number.isInteger(this.seasonalLag)) {
      throw new InvalidForecastParameterError(
        `seasonalLag must be a positive integer, received: ${this.seasonalLag}`
      );
    }
  }

  predict(history: readonly HourlyBucket[], horizonHours: number): Money[] {
    if (horizonHours <= 0 || !Number.isInteger(horizonHours)) {
      throw new InvalidForecastParameterError(
        `horizonHours must be a positive integer, received: ${horizonHours}`
      );
    }

    if (history.length === 0) {
      throw new InsufficientHistoryError(
        "Seasonal Naive forecaster requires history, but received empty array."
      );
    }

    if (history.length < this.seasonalLag) {
      if (this.fallbackToNaive) {
        // Fallback to flat naive
        const lastValue = history[history.length - 1].netFlow;
        return Array.from({ length: horizonHours }, () => lastValue);
      }
      throw new InsufficientHistoryError(
        `Seasonal Naive forecaster requires at least ${this.seasonalLag} hours of history, but received ${history.length}.`
      );
    }

    const predictions: Money[] = [];
    const T = history.length;

    for (let h = 1; h <= horizonHours; h++) {
      // Offset within the seasonal cycle: 0..m-1
      const cycleOffset = (h - 1) % this.seasonalLag;
      const indexInHistory = T - this.seasonalLag + cycleOffset;
      predictions.push(history[indexInHistory].netFlow);
    }

    return predictions;
  }
}

/**
 * Evaluated rolling window result pairing ground truth with predictions.
 */
export interface EvaluatedWindow {
  /** Window index */
  windowIndex: number;

  /** Timestamp cutoff as of which forecast was executed */
  asOf: Date;

  /** Target ground truth hourly buckets */
  target: HourlyBucket[];

  /** Predicted net flow Money series */
  predictions: Money[];

  /** Actual ground-truth net flow Money series */
  actuals: Money[];

  /** Prediction residuals: (actual - prediction) */
  residuals: Money[];
}

/**
 * Result collection of rolling-origin backtest evaluation.
 */
export interface BacktestEvaluationResult {
  /** Name of the evaluated forecaster */
  forecasterName: string;

  /** Total evaluation windows processed */
  windowCount: number;

  /** Horizon steps evaluated in each window */
  horizonHours: number;

  /** Detailed window evaluations */
  windows: EvaluatedWindow[];
}

/**
 * Backtest evaluation runner.
 * Iterates through rolling windows, runs the forecaster, and pairs predictions with ground truth.
 *
 * @param forecaster Forecaster instance to benchmark
 * @param windows Array of RollingWindow slices generated from continuous time series
 * @returns BacktestEvaluationResult containing paired actuals, predictions, and residuals
 */
export function evaluateForecaster(
  forecaster: Forecaster,
  windows: readonly RollingWindow[]
): BacktestEvaluationResult {
  if (windows.length === 0) {
    return {
      forecasterName: forecaster.name,
      windowCount: 0,
      horizonHours: 0,
      windows: [],
    };
  }

  const horizonHours = windows[0].target.length;
  const evaluatedWindows: EvaluatedWindow[] = [];

  for (const win of windows) {
    const predictions = forecaster.predict(win.history, win.target.length);

    if (predictions.length !== win.target.length) {
      throw new Error(
        `Forecaster ${forecaster.name} returned ${predictions.length} predictions, but target requires ${win.target.length}`
      );
    }

    const actuals = win.target.map((t) => t.netFlow);
    const residuals = actuals.map((actual, idx) => actual.subtract(predictions[idx]));

    evaluatedWindows.push({
      windowIndex: win.index,
      asOf: win.asOf,
      target: [...win.target],
      predictions,
      actuals,
      residuals,
    });
  }

  return {
    forecasterName: forecaster.name,
    windowCount: evaluatedWindows.length,
    horizonHours,
    windows: evaluatedWindows,
  };
}
