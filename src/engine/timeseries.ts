/**
 * Reserve Juggler - Time-Series & Continuous Hourly Aggregator
 *
 * Formalizes raw transaction streams and hourly aggregates into strictly continuous,
 * evenly spaced hourly time series (delta t = 1 hour). Guarantees zero-filling for
 * inactive hours, sliding rolling-window generation for cross-validation backtesting,
 * and leakage-free train/test splitting.
 */

import { Money } from "@/engine/money";
import { Transaction, TransactionType, TransactionStatus, HourlyBucket } from "@/engine/models";

const ONE_HOUR_MS = 60 * 60 * 1000;

export interface ContinuousTimeSeriesOptions {
  /** Optional explicit start timestamp (will be floored to the start of the hour) */
  startDate?: Date;

  /** Optional explicit end timestamp (will be ceilinged to the start of the hour) */
  endDate?: Date;

  /** Default currency for zero-filled buckets (default: "USD") */
  currency?: string;
}

export interface RollingWindow {
  /** 0-based index of this evaluation window */
  index: number;

  /**
   * The "as-of" cutoff timestamp: the timestamp of the last hour of the history window.
   * Target forecasting horizon begins immediately after this timestamp.
   */
  asOf: Date;

  /** Historical context series of exact length lookbackHours (e.g., 168h = 1 week) */
  history: HourlyBucket[];

  /** Ground truth future horizon of exact length horizonHours (e.g., 24h) */
  target: HourlyBucket[];
}

export type TimeSeriesSplitConfig =
  | { splitDate: Date }
  | { trainRatio: number };

export interface TimeSeriesSplitResult {
  train: HourlyBucket[];
  test: HourlyBucket[];
  splitDate: Date;
}

/**
 * Floors a Date to the top of its UTC hour (HH:00:00.000Z).
 */
export function floorToHour(date: Date): Date {
  const ms = date.getTime();
  return new Date(Math.floor(ms / ONE_HOUR_MS) * ONE_HOUR_MS);
}

/**
 * Creates an empty/zero-filled HourlyBucket for a specific hour.
 */
export function createZeroBucket(hourStart: Date, currency = "USD"): HourlyBucket {
  const floored = floorToHour(hourStart);
  return {
    bucketId: floored.toISOString(),
    hourStart: floored,
    inbound: Money.zero(currency),
    outbound: Money.zero(currency),
    netFlow: Money.zero(currency),
    grossVolume: Money.zero(currency),
    transactionCount: 0,
  };
}

/**
 * Converts raw transactions into a strictly continuous, zero-filled hourly time series.
 * If an hour has no transactions, an HourlyBucket with zero flows is injected.
 */
export function buildContinuousTimeSeries(
  transactions: readonly Transaction[],
  options?: ContinuousTimeSeriesOptions
): HourlyBucket[] {
  const currency = options?.currency ?? (transactions[0]?.amount.currency || "USD");

  if (transactions.length === 0 && !options?.startDate) {
    return [];
  }

  // Determine global time span
  let startMs: number;
  let endMs: number;

  if (options?.startDate) {
    startMs = floorToHour(options.startDate).getTime();
  } else {
    let earliest = transactions[0].timestamp.getTime();
    for (const tx of transactions) {
      if (tx.timestamp.getTime() < earliest) {
        earliest = tx.timestamp.getTime();
      }
    }
    startMs = Math.floor(earliest / ONE_HOUR_MS) * ONE_HOUR_MS;
  }

  if (options?.endDate) {
    endMs = floorToHour(options.endDate).getTime();
  } else {
    let latest = transactions[0].timestamp.getTime();
    for (const tx of transactions) {
      if (tx.timestamp.getTime() > latest) {
        latest = tx.timestamp.getTime();
      }
    }
    endMs = Math.floor(latest / ONE_HOUR_MS) * ONE_HOUR_MS;
  }

  if (startMs > endMs) {
    return [];
  }

  // Aggregate non-failed transactions by hour slot
  interface Accumulator {
    inbound: Money;
    outbound: Money;
    count: number;
  }
  const slotMap = new Map<number, Accumulator>();

  for (const tx of transactions) {
    if (tx.status === TransactionStatus.FAILED) {
      continue;
    }

    const txMs = tx.timestamp.getTime();
    const slot = Math.floor(txMs / ONE_HOUR_MS) * ONE_HOUR_MS;

    // Filter out of bounds if explicit dates were provided
    if (slot < startMs || slot > endMs) {
      continue;
    }

    let acc = slotMap.get(slot);
    if (!acc) {
      acc = {
        inbound: Money.zero(currency),
        outbound: Money.zero(currency),
        count: 0,
      };
      slotMap.set(slot, acc);
    }

    if (tx.type === TransactionType.DEPOSIT) {
      acc.inbound = acc.inbound.add(tx.amount);
    } else if (tx.type === TransactionType.WITHDRAWAL || tx.type === TransactionType.SETTLEMENT) {
      acc.outbound = acc.outbound.add(tx.amount);
    }

    acc.count += 1;
  }

  // Generate continuous sequence including zero-filled missing hours
  const result: HourlyBucket[] = [];
  for (let t = startMs; t <= endMs; t += ONE_HOUR_MS) {
    const acc = slotMap.get(t);
    const hourStart = new Date(t);

    if (acc) {
      const netFlow = acc.inbound.subtract(acc.outbound);
      const grossVolume = acc.inbound.add(acc.outbound);

      result.push({
        bucketId: hourStart.toISOString(),
        hourStart,
        inbound: acc.inbound,
        outbound: acc.outbound,
        netFlow,
        grossVolume,
        transactionCount: acc.count,
      });
    } else {
      // Zero-filling: guaranteed continuous interval
      result.push(createZeroBucket(hourStart, currency));
    }
  }

  return result;
}

/** Alias for buildContinuousTimeSeries */
export const buildContinuousHourlySeries = buildContinuousTimeSeries;

/**
 * Ensures an existing array of sparse HourlyBuckets is filled with zero-buckets for any missing hours.
 */
export function fillTimeSeriesGaps(
  sparseBuckets: readonly HourlyBucket[],
  options?: ContinuousTimeSeriesOptions
): HourlyBucket[] {
  if (sparseBuckets.length === 0 && !options?.startDate) {
    return [];
  }

  const currency = options?.currency ?? (sparseBuckets[0]?.inbound.currency || "USD");

  const startMs = options?.startDate
    ? floorToHour(options.startDate).getTime()
    : floorToHour(sparseBuckets[0].hourStart).getTime();

  const endMs = options?.endDate
    ? floorToHour(options.endDate).getTime()
    : floorToHour(sparseBuckets[sparseBuckets.length - 1].hourStart).getTime();

  if (startMs > endMs) {
    return [];
  }

  const bucketMap = new Map<number, HourlyBucket>();
  for (const b of sparseBuckets) {
    const ms = floorToHour(b.hourStart).getTime();
    bucketMap.set(ms, b);
  }

  const result: HourlyBucket[] = [];
  for (let t = startMs; t <= endMs; t += ONE_HOUR_MS) {
    const existing = bucketMap.get(t);
    if (existing) {
      result.push(existing);
    } else {
      result.push(createZeroBucket(new Date(t), currency));
    }
  }

  return result;
}

/**
 * Slices a continuous hourly series into an array of evaluation windows for rolling-origin backtesting.
 *
 * @param series Strictly continuous hourly series
 * @param lookbackHours Number of historical hours for model training (e.g., 168 for 1 week)
 * @param horizonHours Number of future hours for target evaluation (e.g., 24 for next day)
 * @param stepHours Step interval between windows (default: 1 hour)
 */
export interface RollingWindowsOptions {
  lookbackHours: number;
  horizonHours: number;
  stepHours?: number;
}

export function createRollingWindows(
  series: readonly HourlyBucket[],
  lookbackOrOptions: number | RollingWindowsOptions,
  horizonHoursParam?: number,
  stepHoursParam = 1
): RollingWindow[] {
  let lookbackHours: number;
  let horizonHours: number;
  let stepHours: number;

  if (typeof lookbackOrOptions === "object" && lookbackOrOptions !== null) {
    lookbackHours = lookbackOrOptions.lookbackHours;
    horizonHours = lookbackOrOptions.horizonHours;
    stepHours = lookbackOrOptions.stepHours ?? 1;
  } else {
    lookbackHours = lookbackOrOptions;
    horizonHours = horizonHoursParam as number;
    stepHours = stepHoursParam;
  }

  if (lookbackHours <= 0 || !Number.isInteger(lookbackHours)) {
    throw new Error(`lookbackHours must be a positive integer, received: ${lookbackHours}`);
  }
  if (horizonHours <= 0 || !Number.isInteger(horizonHours)) {
    throw new Error(`horizonHours must be a positive integer, received: ${horizonHours}`);
  }
  if (stepHours <= 0 || !Number.isInteger(stepHours)) {
    throw new Error(`stepHours must be a positive integer, received: ${stepHours}`);
  }

  const totalWindowLength = lookbackHours + horizonHours;
  if (series.length < totalWindowLength) {
    return [];
  }

  const windows: RollingWindow[] = [];
  const maxStartIndex = series.length - totalWindowLength;

  let windowIndex = 0;
  for (let i = 0; i <= maxStartIndex; i += stepHours) {
    const history = series.slice(i, i + lookbackHours);
    const target = series.slice(i + lookbackHours, i + totalWindowLength);
    const asOf = history[history.length - 1].hourStart;

    windows.push({
      index: windowIndex++,
      asOf,
      history,
      target,
    });
  }

  return windows;
}

/**
 * Splits a continuous time series into train and test subsets chronologically.
 * Strictly prevents data leakage by ensuring no test timestamps overlap with train.
 */
export function splitTimeSeries(
  series: readonly HourlyBucket[],
  splitConfig: TimeSeriesSplitConfig
): TimeSeriesSplitResult {
  if (series.length === 0) {
    return {
      train: [],
      test: [],
      splitDate: new Date(0),
    };
  }

  let splitIndex: number;
  let splitDate: Date;

  if ("splitDate" in splitConfig) {
    splitDate = floorToHour(splitConfig.splitDate);
    const splitMs = splitDate.getTime();
    splitIndex = series.findIndex((b) => b.hourStart.getTime() >= splitMs);
    if (splitIndex === -1) {
      splitIndex = series.length;
    }
  } else {
    const { trainRatio } = splitConfig;
    if (trainRatio < 0 || trainRatio > 1 || !Number.isFinite(trainRatio)) {
      throw new Error(`trainRatio must be between 0 and 1, received: ${trainRatio}`);
    }
    splitIndex = Math.round(series.length * trainRatio);
    splitDate =
      splitIndex < series.length
        ? series[splitIndex].hourStart
        : new Date(series[series.length - 1].hourStart.getTime() + ONE_HOUR_MS);
  }

  const train = series.slice(0, splitIndex);
  const test = series.slice(splitIndex);

  return {
    train,
    test,
    splitDate,
  };
}

/**
 * Validates that a series of HourlyBuckets is strictly continuous with exactly 1 hour delta.
 */
export function validateContinuousSeries(series: readonly HourlyBucket[]): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (series.length === 0) {
    return { isValid: true, errors: [] };
  }

  for (let i = 1; i < series.length; i++) {
    const prevMs = series[i - 1].hourStart.getTime();
    const currMs = series[i].hourStart.getTime();
    const delta = currMs - prevMs;

    if (delta !== ONE_HOUR_MS) {
      errors.push(
        `Discontinuity detected between index ${i - 1} (${series[i - 1].bucketId}) and index ${i} (${series[i].bucketId}): delta is ${delta / 60000} minutes, expected 60 minutes`
      );
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
