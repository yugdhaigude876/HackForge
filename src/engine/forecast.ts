/**
 * Reserve Juggler - Forecasting Engine & Backtest Harness
 *
 * Implements benchmark time-series forecasters (Naive, Seasonal Naive, Hour-of-Week Smoothing)
 * and the rolling-origin evaluation harness for backtesting net cash flow predictions.
 */

import { Money } from "@/engine/money";
import { HourlyBucket } from "@/engine/models";
import { RollingWindow } from "@/engine/timeseries";
import {
  calculateMAE,
  calculateMASE,
  calculateInSampleScaleMAE,
  calculatePinballLoss,
} from "@/engine/metrics";

const ONE_HOUR_MS = 60 * 60 * 1000;
const HOURS_IN_WEEK = 168;

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

  constructor(options?: number | SeasonalNaiveOptions) {
    if (typeof options === "number") {
      this.seasonalLag = options;
      this.fallbackToNaive = false;
    } else {
      this.seasonalLag = options?.seasonalLag ?? HOURS_IN_WEEK;
      this.fallbackToNaive = options?.fallbackToNaive ?? false;
    }

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

export interface HourOfWeekSmoothingOptions {
  /**
   * Smoothing factor lambda (alpha) for Exponentially Weighted Moving Average (EWMA).
   * Range: (0, 1].
   * 1.0 = use only the most recent observation for each hour-of-week.
   * Default: 0.3 (adaptive smoothing giving more weight to recent weeks).
   */
  lambda?: number;

  /**
   * Aggregation mode:
   * - "ewma": Exponentially Weighted Moving Average s_k <- lambda * N_t + (1 - lambda) * s_k
   * - "mean": Simple arithmetic average across all occurrences of that hour-of-week
   * Default: "ewma"
   */
  mode?: "ewma" | "mean";

  /** Optional fallback money amount if a specific hour-of-week slot was never observed in history */
  fallbackValue?: Money;
}

/**
 * Hour-of-Week Smoothing Forecaster
 *
 * Groups historical net flows by hour of the week (168 distinct buckets: 7 days x 24 hours)
 * and computes an Exponentially Weighted Moving Average (EWMA) or arithmetic mean for each slot.
 * Projects the horizon by indexing the corresponding hour-of-week profiles.
 */
export class HourOfWeekSmoothingForecaster implements Forecaster {
  readonly name = "Hour-of-Week Smoothing (EWMA)";
  readonly description =
    "Groups history by the 168 hours of the week and applies exponential smoothing to capture recurring diurnal and weekly flow profiles.";
  readonly lambda: number;
  readonly mode: "ewma" | "mean";
  readonly fallbackValue?: Money;

  constructor(options?: HourOfWeekSmoothingOptions) {
    this.mode = options?.mode ?? "ewma";
    this.lambda = options?.lambda ?? 0.3;
    this.fallbackValue = options?.fallbackValue;

    if (this.lambda <= 0 || this.lambda > 1 || !Number.isFinite(this.lambda)) {
      throw new InvalidForecastParameterError(
        `lambda must be in (0, 1], received: ${this.lambda}`
      );
    }
  }

  /**
   * Maps a Date to its hour-of-week index (0 to 167) in UTC.
   * 0 = Sunday 00:00 UTC, 167 = Saturday 23:00 UTC.
   */
  static getHourOfWeekIndex(date: Date): number {
    const day = date.getUTCDay(); // 0..6
    const hour = date.getUTCHours(); // 0..23
    return day * 24 + hour;
  }

  predict(history: readonly HourlyBucket[], horizonHours: number): Money[] {
    if (horizonHours <= 0 || !Number.isInteger(horizonHours)) {
      throw new InvalidForecastParameterError(
        `horizonHours must be a positive integer, received: ${horizonHours}`
      );
    }

    if (history.length === 0) {
      throw new InsufficientHistoryError(
        "Hour-of-Week forecaster requires history, but received empty array."
      );
    }

    const currency = history[0].netFlow.currency;

    // Build the 168 hourly profiles from history
    // slotProfiles: BigInt minor units for each hour-of-week slot
    const slotProfiles: (bigint | null)[] = new Array(HOURS_IN_WEEK).fill(null);
    const slotCounts = new Array(HOURS_IN_WEEK).fill(0);
    const slotSums: bigint[] = new Array(HOURS_IN_WEEK).fill(0n);

    let globalSumMinor = 0n;

    for (const bucket of history) {
      const slot = HourOfWeekSmoothingForecaster.getHourOfWeekIndex(bucket.hourStart);
      const valMinor = bucket.netFlow.amountMinor;
      globalSumMinor += valMinor;
      slotCounts[slot] += 1;
      slotSums[slot] += valMinor;

      if (this.mode === "ewma") {
        if (slotProfiles[slot] === null) {
          slotProfiles[slot] = valMinor;
        } else {
          // s_k <- lambda * N_t + (1 - lambda) * s_k
          // Using scaled integer math (1,000,000 scale) for exact precision
          const scale = 1_000_000n;
          const lambdaScaled = BigInt(Math.round(this.lambda * 1_000_000));
          const prev = slotProfiles[slot]!;
          const updated =
            (lambdaScaled * valMinor + (scale - lambdaScaled) * prev) / scale;
          slotProfiles[slot] = updated;
        }
      }
    }

    // Global mean fallback for slots not observed in history
    const globalMeanMinor = globalSumMinor / BigInt(history.length);
    const defaultFallbackMinor = this.fallbackValue
      ? this.fallbackValue.amountMinor
      : globalMeanMinor;

    // As of the last historical bucket
    const asOfMs = history[history.length - 1].hourStart.getTime();
    const predictions: Money[] = [];

    for (let h = 1; h <= horizonHours; h++) {
      const targetDate = new Date(asOfMs + h * ONE_HOUR_MS);
      const slot = HourOfWeekSmoothingForecaster.getHourOfWeekIndex(targetDate);

      let predictedMinor: bigint;
      if (this.mode === "ewma") {
        predictedMinor = slotProfiles[slot] ?? defaultFallbackMinor;
      } else {
        // Simple mean mode
        predictedMinor =
          slotCounts[slot] > 0
            ? slotSums[slot] / BigInt(slotCounts[slot])
            : defaultFallbackMinor;
      }

      predictions.push(Money.fromMinor(predictedMinor, currency));
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
 * Aggregate summary metrics across all backtest windows.
 */
export interface BacktestMetrics {
  /** Aggregate Mean Absolute Error in minor units (cents) */
  maeMinor: number;

  /** Aggregate Mean Absolute Error in standard dollars */
  maeDollars: number;

  /** Mean Absolute Scaled Error relative to in-sample baseline */
  mase: number;

  /** Pinball loss (quantile loss) evaluated at tau = 0.95 (dollars) */
  pinballLoss95: number;

  /** Pinball loss (quantile loss) evaluated at tau = 0.99 (dollars) */
  pinballLoss99: number;
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

  /** Aggregate benchmark metrics */
  metrics: BacktestMetrics;
}

/**
 * Backtest evaluation runner.
 * Iterates through rolling windows, runs the forecaster, pairs predictions with ground truth,
 * and automatically computes aggregate MAE, MASE, and Pinball loss scores.
 *
 * @param forecaster Forecaster instance to benchmark
 * @param windows Array of RollingWindow slices generated from continuous time series
 * @returns BacktestEvaluationResult containing paired actuals, predictions, residuals, and metrics
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
      metrics: {
        maeMinor: 0,
        maeDollars: 0,
        mase: 0,
        pinballLoss95: 0,
        pinballLoss99: 0,
      },
    };
  }

  const horizonHours = windows[0].target.length;
  const evaluatedWindows: EvaluatedWindow[] = [];

  const allActuals: Money[] = [];
  const allPredictions: Money[] = [];

  let sumInSampleScale = 0;

  for (const win of windows) {
    const predictions = forecaster.predict(win.history, win.target.length);

    if (predictions.length !== win.target.length) {
      throw new Error(
        `Forecaster ${forecaster.name} returned ${predictions.length} predictions, but target requires ${win.target.length}`
      );
    }

    const actuals = win.target.map((t) => t.netFlow);
    const residuals = actuals.map((actual, idx) => actual.subtract(predictions[idx]));

    for (let i = 0; i < actuals.length; i++) {
      allActuals.push(actuals[i]);
      allPredictions.push(predictions[i]);
    }

    // In-sample scale Q from this window's history
    sumInSampleScale += calculateInSampleScaleMAE(win.history, HOURS_IN_WEEK);

    evaluatedWindows.push({
      windowIndex: win.index,
      asOf: win.asOf,
      target: [...win.target],
      predictions,
      actuals,
      residuals,
    });
  }

  // Aggregate metrics
  const { maeMinor, maeDollars } = calculateMAE(allActuals, allPredictions);
  const avgInSampleScale = sumInSampleScale / windows.length;
  const mase = calculateMASE(allActuals, allPredictions, avgInSampleScale);
  const p95 = calculatePinballLoss(allActuals, allPredictions, 0.95);
  const p99 = calculatePinballLoss(allActuals, allPredictions, 0.99);

  return {
    forecasterName: forecaster.name,
    windowCount: evaluatedWindows.length,
    horizonHours,
    windows: evaluatedWindows,
    metrics: {
      maeMinor,
      maeDollars,
      mase,
      pinballLoss95: p95.lossDollars,
      pinballLoss99: p99.lossDollars,
    },
  };
}
