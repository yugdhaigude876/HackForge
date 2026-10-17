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

export interface SkillScoreResult {
  /**
   * Skill score: (baselineScore - modelScore) / baselineScore
   * Positive (> 0): model outperforms baseline.
   * Zero (0): model performs identically to baseline.
   * Negative (< 0): model performs worse than baseline.
   * null: degenerate evaluation (zero baseline score, missing metric, etc.)
   */
  skill: number | null;
  /** True if skill > 0 (model strictly beats baseline) */
  isBetter: boolean;
  /** Explanatory note if skill is null or at boundary */
  reason?: string;
}

/**
 * Computes the relative forecast skill score for an error metric (where lower is better):
 * Skill = (baselineScore - modelScore) / baselineScore
 *
 * Degenerate cases:
 * - If baselineScore <= 0: returns null with reason (division by zero / zero error baseline).
 * - If modelScore or baselineScore is NaN / non-finite: returns null with reason.
 */
export function calculateSkillScore(
  modelScore: number | null | undefined,
  baselineScore: number | null | undefined
): SkillScoreResult {
  if (
    modelScore === null ||
    modelScore === undefined ||
    baselineScore === null ||
    baselineScore === undefined ||
    !Number.isFinite(modelScore) ||
    !Number.isFinite(baselineScore)
  ) {
    return { skill: null, isBetter: false, reason: "Non-finite or missing metric score" };
  }

  if (baselineScore <= 0) {
    return {
      skill: null,
      isBetter: false,
      reason: "Baseline score is non-positive; skill score undefined",
    };
  }

  const skill = (baselineScore - modelScore) / baselineScore;
  if (!Number.isFinite(skill)) {
    return { skill: null, isBetter: false, reason: "Computed skill score is not finite" };
  }

  return {
    skill,
    isBetter: skill > 0,
  };
}

export interface IntervalCoverageResult {
  /** Fraction of actuals that fell within [lowerBounds, upperBounds] in [0, 1] */
  coverageRate: number | null;
  /** Count of actuals inside the prediction interval */
  inBandCount: number;
  /** Total number of observations evaluated */
  totalCount: number;
  /** Reason when evaluation is degenerate */
  reason?: string;
}

/**
 * Evaluates empirical coverage rate of a probabilistic residual interval band:
 * Coverage = Count(lower <= actual <= upper) / totalCount
 *
 * Degenerate cases:
 * - If series is empty: returns null coverage with reason.
 * - If lengths mismatch: returns null coverage with reason.
 */
export function calculateIntervalCoverage(
  actuals: readonly Money[],
  lowerBounds: readonly Money[],
  upperBounds: readonly Money[]
): IntervalCoverageResult {
  if (actuals.length === 0) {
    return {
      coverageRate: null,
      inBandCount: 0,
      totalCount: 0,
      reason: "Empty actuals series provided",
    };
  }
  if (actuals.length !== lowerBounds.length || actuals.length !== upperBounds.length) {
    return {
      coverageRate: null,
      inBandCount: 0,
      totalCount: actuals.length,
      reason: `Mismatched lengths: actuals (${actuals.length}), lowerBounds (${lowerBounds.length}), upperBounds (${upperBounds.length})`,
    };
  }

  let inBandCount = 0;
  for (let i = 0; i < actuals.length; i++) {
    const act = actuals[i].amountMinor;
    const low = lowerBounds[i].amountMinor;
    const high = upperBounds[i].amountMinor;
    if (act >= low && act <= high) {
      inBandCount++;
    }
  }

  return {
    coverageRate: inBandCount / actuals.length,
    inBandCount,
    totalCount: actuals.length,
  };
}

export interface ForecasterMetricSet {
  name: string;
  maeMinor: number | null;
  maeDollars: number | null;
  mase: number | null;
  pinballLoss: number | null;
  reason?: string;
}

export interface ComparativeEvaluationResult {
  windowCount: number;
  horizonHours: number;
  tau: number;
  model: ForecasterMetricSet;
  naive: ForecasterMetricSet;
  seasonalNaive: ForecasterMetricSet;
  skillScores: {
    vsNaive: {
      mase: SkillScoreResult;
      pinball: SkillScoreResult;
      mae: SkillScoreResult;
    };
    vsSeasonalNaive: {
      mase: SkillScoreResult;
      pinball: SkillScoreResult;
      mae: SkillScoreResult;
    };
  };
  intervalCoverage?: IntervalCoverageResult;
  reason?: string;
}

export interface RollingWindowInput {
  index: number;
  asOf: Date;
  history: readonly HourlyBucket[];
  target: readonly HourlyBucket[];
}

export interface ForecasterInput {
  name: string;
  predict(history: readonly HourlyBucket[], horizonHours: number): Money[];
}

/**
 * Predicts using 1-step Naive Benchmark (last observed value repeated).
 */
export function predictNaive(history: readonly HourlyBucket[], horizonHours: number): Money[] {
  if (history.length === 0) {
    throw new Error("Naive forecaster requires at least 1 historical observation.");
  }
  const lastObserved = history[history.length - 1].netFlow;
  return Array.from({ length: horizonHours }, () => lastObserved);
}

/**
 * Predicts using Seasonal Naive Benchmark (168h weekly cycle with fallback to 1-step naive).
 */
export function predictSeasonalNaive(
  history: readonly HourlyBucket[],
  horizonHours: number,
  seasonalLag = 168
): Money[] {
  if (history.length === 0) {
    throw new Error("Seasonal naive forecaster requires history observations.");
  }
  const T = history.length;
  if (T < seasonalLag) {
    // Fallback to flat naive
    const lastValue = history[T - 1].netFlow;
    return Array.from({ length: horizonHours }, () => lastValue);
  }

  const predictions: Money[] = [];
  for (let h = 1; h <= horizonHours; h++) {
    const cycleOffset = (h - 1) % seasonalLag;
    const indexInHistory = T - seasonalLag + cycleOffset;
    predictions.push(history[indexInHistory].netFlow);
  }
  return predictions;
}

/**
 * Evaluates the chosen forecaster and both naive benchmarks on the EXACT SAME rolling-origin windows.
 * Computes MAE, MASE (scaled by in-sample seasonal-naive error), Pinball loss at reserve quantile tau,
 * and skill scores against each baseline.
 *
 * Degenerate cases (e.g. zero scale, zero windows) return null fields with explicit reasons, never NaN.
 */
export function evaluateModelAndBaselinesOnWindows(
  modelForecaster: ForecasterInput,
  windows: readonly RollingWindowInput[],
  options: {
    tau?: number;
    seasonalLag?: number;
    residualLowerBounds?: readonly Money[];
    residualUpperBounds?: readonly Money[];
  } = {}
): ComparativeEvaluationResult {
  const tau = options.tau ?? 0.95;
  const seasonalLag = options.seasonalLag ?? 168;

  if (windows.length === 0) {
    const emptyMetrics = (name: string): ForecasterMetricSet => ({
      name,
      maeMinor: null,
      maeDollars: null,
      mase: null,
      pinballLoss: null,
      reason: "No rolling-origin evaluation windows provided",
    });

    const nullSkill: SkillScoreResult = {
      skill: null,
      isBetter: false,
      reason: "No evaluation windows",
    };

    return {
      windowCount: 0,
      horizonHours: 0,
      tau,
      model: emptyMetrics(modelForecaster.name),
      naive: emptyMetrics("Naive (Flat Line)"),
      seasonalNaive: emptyMetrics("Seasonal Naive (Same Hour Last Week)"),
      skillScores: {
        vsNaive: { mase: nullSkill, pinball: nullSkill, mae: nullSkill },
        vsSeasonalNaive: { mase: nullSkill, pinball: nullSkill, mae: nullSkill },
      },
      reason: "Too few windows: history is shorter than backtest requirements",
    };
  }

  const horizonHours = windows[0].target.length;
  const allActuals: Money[] = [];
  const modelPreds: Money[] = [];
  const naivePreds: Money[] = [];
  const seasonalNaivePreds: Money[] = [];

  let sumInSampleScale = 0;

  for (const win of windows) {
    const actuals = win.target.map((t) => t.netFlow);
    const mPred = modelForecaster.predict(win.history, actuals.length);
    const nPred = predictNaive(win.history, actuals.length);
    const snPred = predictSeasonalNaive(win.history, actuals.length, seasonalLag);

    for (let i = 0; i < actuals.length; i++) {
      allActuals.push(actuals[i]);
      modelPreds.push(mPred[i]);
      naivePreds.push(nPred[i]);
      seasonalNaivePreds.push(snPred[i]);
    }

    sumInSampleScale += calculateInSampleScaleMAE(win.history, seasonalLag);
  }

  const avgInSampleScale = sumInSampleScale / windows.length;
  const hasZeroScale = avgInSampleScale <= 0;

  // Model metrics
  const modelMae = calculateMAE(allActuals, modelPreds);
  const modelMase = hasZeroScale ? null : calculateMASE(allActuals, modelPreds, avgInSampleScale);
  const modelPinball = calculatePinballLoss(allActuals, modelPreds, tau);

  // Naive metrics
  const naiveMae = calculateMAE(allActuals, naivePreds);
  const naiveMase = hasZeroScale ? null : calculateMASE(allActuals, naivePreds, avgInSampleScale);
  const naivePinball = calculatePinballLoss(allActuals, naivePreds, tau);

  // Seasonal Naive metrics
  const snMae = calculateMAE(allActuals, seasonalNaivePreds);
  const snMase = hasZeroScale ? null : calculateMASE(allActuals, seasonalNaivePreds, avgInSampleScale);
  const snPinball = calculatePinballLoss(allActuals, seasonalNaivePreds, tau);

  const modelMetrics: ForecasterMetricSet = {
    name: modelForecaster.name,
    maeMinor: modelMae.maeMinor,
    maeDollars: modelMae.maeDollars,
    mase: modelMase,
    pinballLoss: modelPinball.lossDollars,
    ...(hasZeroScale ? { reason: "In-sample scaling denominator is zero" } : {}),
  };

  const naiveMetrics: ForecasterMetricSet = {
    name: "Naive (Flat Line)",
    maeMinor: naiveMae.maeMinor,
    maeDollars: naiveMae.maeDollars,
    mase: naiveMase,
    pinballLoss: naivePinball.lossDollars,
    ...(hasZeroScale ? { reason: "In-sample scaling denominator is zero" } : {}),
  };

  const snMetrics: ForecasterMetricSet = {
    name: "Seasonal Naive (Same Hour Last Week)",
    maeMinor: snMae.maeMinor,
    maeDollars: snMae.maeDollars,
    mase: snMase,
    pinballLoss: snPinball.lossDollars,
    ...(hasZeroScale ? { reason: "In-sample scaling denominator is zero" } : {}),
  };

  // Skill scores: (baseline - model) / baseline
  const vsNaiveMase = calculateSkillScore(modelMase, naiveMase);
  const vsNaivePinball = calculateSkillScore(modelPinball.lossDollars, naivePinball.lossDollars);
  const vsNaiveMae = calculateSkillScore(modelMae.maeDollars, naiveMae.maeDollars);

  const vsSnMase = calculateSkillScore(modelMase, snMase);
  const vsSnPinball = calculateSkillScore(modelPinball.lossDollars, snPinball.lossDollars);
  const vsSnMae = calculateSkillScore(modelMae.maeDollars, snMae.maeDollars);

  let intervalCoverage: IntervalCoverageResult | undefined;
  if (options.residualLowerBounds && options.residualUpperBounds) {
    intervalCoverage = calculateIntervalCoverage(
      allActuals,
      options.residualLowerBounds,
      options.residualUpperBounds
    );
  }

  return {
    windowCount: windows.length,
    horizonHours,
    tau,
    model: modelMetrics,
    naive: naiveMetrics,
    seasonalNaive: snMetrics,
    skillScores: {
      vsNaive: {
        mase: vsNaiveMase,
        pinball: vsNaivePinball,
        mae: vsNaiveMae,
      },
      vsSeasonalNaive: {
        mase: vsSnMase,
        pinball: vsSnPinball,
        mae: vsSnMae,
      },
    },
    ...(intervalCoverage ? { intervalCoverage } : {}),
  };
}
