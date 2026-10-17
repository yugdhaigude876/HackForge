/**
 * Reserve Juggler - Synthetic Transaction Generator
 *
 * Produces deterministic, reproducible transaction streams simulating a digital
 * bank's ~$20M/hour net cash flow. Models realistic weekly/daily seasonality,
 * retail vs wholesale transaction distributions, and merchant settlements.
 */

import { Money } from "@/engine/money";
import { SeededPRNG } from "@/engine/prng";
import {
  Transaction,
  TransactionType,
  TransactionStatus,
  HourlyBucket,
} from "@/engine/models";

export interface GenerateTransactionsParams {
  /** PRNG seed string for 100% deterministic reproduction */
  seed: string;

  /** Inclusive start of the generation window */
  startDate: Date;

  /** Inclusive end of the generation window */
  endDate: Date;

  /** Target baseline gross volume per hour (typically ~$20,000,000.00 USD) */
  baseVolumePerHour: Money;

  /**
   * Approximate transaction count per hour (or [min, max] range).
   * Default: [15, 30] per hour for realistic high-value batching & fast tests.
   */
  transactionsPerHour?: number | [min: number, max: number];

  /** Optional override for transaction type probabilities */
  typeDistribution?: {
    deposit?: number;
    withdrawal?: number;
    settlement?: number;
  };
}

const COUNTERPARTIES = [
  "Fedwire Direct",
  "ACH Clearinghouse",
  "Stripe Merchant Payout",
  "Visa Interbank",
  "Mastercard Direct",
  "Corporate Payroll Services",
  "Treasury Liquidity Sweep",
  "ATM Network Switch",
  "E-Commerce Gateway",
  "Point of Sale Batch",
];

/**
 * Calculates seasonality multiplier for a specific date (UTC).
 * Reflects digital bank volume patterns:
 * - Weekday business hours (09:00 - 17:00 UTC): Peak (1.35x - 1.65x)
 * - Weekday shoulder hours (07:00-09:00, 17:00-21:00 UTC): Moderate (0.85x - 1.10x)
 * - Weekday night hours (21:00 - 07:00 UTC): Low (0.25x - 0.45x)
 * - Weekend daytime (09:00 - 21:00 UTC): Weekend retail (0.55x - 0.75x)
 * - Weekend night (21:00 - 09:00 UTC): Minimal (0.15x - 0.30x)
 */
export function getSeasonalityMultiplier(date: Date): number {
  const day = date.getUTCDay(); // 0 = Sun, 6 = Sat
  const hour = date.getUTCHours(); // 0..23
  const isWeekend = day === 0 || day === 6;

  if (isWeekend) {
    if (hour >= 9 && hour < 21) {
      return 0.65;
    }
    return 0.25;
  }

  // Weekdays (Mon - Fri)
  if (hour >= 9 && hour < 17) {
    // Peak business hours
    return 1.5;
  } else if ((hour >= 7 && hour < 9) || (hour >= 17 && hour < 21)) {
    // Morning and evening shoulders
    return 0.95;
  } else {
    // Night hours
    return 0.35;
  }
}

/**
 * Generates a reproducible, seeded array of transactions within the specified date range.
 */
export function generateTransactions(params: GenerateTransactionsParams): Transaction[] {
  const { seed, startDate, endDate, baseVolumePerHour } = params;

  if (!(startDate instanceof Date) || !(endDate instanceof Date)) {
    throw new Error("startDate and endDate must be valid Date objects");
  }

  const startMs = startDate.getTime();
  const endMs = endDate.getTime();

  if (isNaN(startMs) || isNaN(endMs)) {
    throw new Error("Invalid startDate or endDate timestamp");
  }

  if (startMs >= endMs) {
    return [];
  }

  baseVolumePerHour.assertNonNegative("baseVolumePerHour must be non-negative");

  const prng = new SeededPRNG(seed);

  // Type probabilities
  const pDeposit = params.typeDistribution?.deposit ?? 0.48;
  const pWithdrawal = params.typeDistribution?.withdrawal ?? 0.42;
  const pSettlement = params.typeDistribution?.settlement ?? 0.1;
  const typeWeights = [pDeposit, pWithdrawal, pSettlement];
  const typeOptions = [
    TransactionType.DEPOSIT,
    TransactionType.WITHDRAWAL,
    TransactionType.SETTLEMENT,
  ];

  // Transactions per hour range
  let minTxPerHour = 15;
  let maxTxPerHour = 30;
  if (typeof params.transactionsPerHour === "number") {
    minTxPerHour = Math.max(1, params.transactionsPerHour);
    maxTxPerHour = Math.max(minTxPerHour, params.transactionsPerHour);
  } else if (Array.isArray(params.transactionsPerHour)) {
    minTxPerHour = Math.max(1, params.transactionsPerHour[0]);
    maxTxPerHour = Math.max(minTxPerHour, params.transactionsPerHour[1]);
  }

  const transactions: Transaction[] = [];

  // Iterate hourly blocks from startDate to endDate
  const ONE_HOUR_MS = 60 * 60 * 1000;
  let currentBlockStart = startMs;

  while (currentBlockStart < endMs) {
    const currentBlockEnd = Math.min(
      Math.floor(currentBlockStart / ONE_HOUR_MS + 1) * ONE_HOUR_MS,
      endMs
    );
    const blockDate = new Date(currentBlockStart);

    // Seasonality and realistic jitter
    const seasonality = getSeasonalityMultiplier(blockDate);
    // Gaussian noise with mean 1.0, std dev 0.05, clamped [0.85, 1.15]
    const rawNoise = prng.nextGaussian(1.0, 0.05);
    const noise = Math.min(1.15, Math.max(0.85, rawNoise));

    // Scale target volume for this fraction of the hour
    const fractionOfHour = (currentBlockEnd - currentBlockStart) / ONE_HOUR_MS;
    const effectiveMultiplier = seasonality * noise * fractionOfHour;

    const hourTargetVolume = baseVolumePerHour.multiply(effectiveMultiplier);

    // Number of transactions in this block
    const baseTxCount = prng.nextInt(minTxPerHour, maxTxPerHour);
    const txCount = Math.max(1, Math.round(baseTxCount * fractionOfHour));

    if (hourTargetVolume.amountMinor > 0n && txCount > 0) {
      // Assign types, statuses, and allocate volume proportionally
      const blockTypes: TransactionType[] = [];
      const weights: number[] = [];

      for (let i = 0; i < txCount; i++) {
        const type = prng.choice(typeOptions, typeWeights);
        blockTypes.push(type);

        // Heterogeneous financial transaction sizes:
        // Most transactions are retail/business sized, settlements are larger
        let sizeWeight = Math.exp(prng.nextGaussian(0, 0.9));
        if (type === TransactionType.SETTLEMENT) {
          sizeWeight *= 2.5;
        }
        weights.push(Math.max(0.01, sizeWeight));
      }

      // Proportional allocation ensures total sum strictly matches hourTargetVolume
      const allocatedAmounts = hourTargetVolume.allocate(weights);

      // Create transaction objects
      for (let i = 0; i < txCount; i++) {
        // Distribute timestamps uniformly within the block
        const randomOffset = prng.next() * (currentBlockEnd - currentBlockStart);
        const timestamp = new Date(currentBlockStart + randomOffset);

        // Status distribution: ~97% COMPLETED, ~2% PENDING, ~1% FAILED
        const statusRoll = prng.next();
        let status = TransactionStatus.COMPLETED;
        if (statusRoll > 0.99) {
          status = TransactionStatus.FAILED;
        } else if (statusRoll > 0.97) {
          status = TransactionStatus.PENDING;
        }

        const id = prng.nextUUID();
        const counterparty = prng.choice(COUNTERPARTIES);

        transactions.push({
          id,
          timestamp,
          type: blockTypes[i],
          amount: allocatedAmounts[i],
          status,
          source: "synthetic",
          seed,
          counterparty,
        });
      }
    }

    currentBlockStart = currentBlockEnd;
  }

  // Sort chronologically
  transactions.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  return transactions;
}

/**
 * Pre-aggregates raw transactions into hourly series buckets (N_t = In_t - Out_t).
 * Conforms to DATA_MODEL.md specification (series collection).
 */
export function aggregateHourly(
  transactions: readonly Transaction[],
  defaultCurrency = "USD"
): HourlyBucket[] {
  const buckets = new Map<
    string,
    {
      hourStart: Date;
      inbound: Money;
      outbound: Money;
      count: number;
    }
  >();

  const ONE_HOUR_MS = 60 * 60 * 1000;

  for (const tx of transactions) {
    if (tx.status === TransactionStatus.FAILED) {
      // Exclude failed transactions from cash flow aggregates
      continue;
    }

    const hourStartMs = Math.floor(tx.timestamp.getTime() / ONE_HOUR_MS) * ONE_HOUR_MS;
    const bucketId = new Date(hourStartMs).toISOString();

    let bucket = buckets.get(bucketId);
    if (!bucket) {
      bucket = {
        hourStart: new Date(hourStartMs),
        inbound: Money.zero(tx.amount.currency ?? defaultCurrency),
        outbound: Money.zero(tx.amount.currency ?? defaultCurrency),
        count: 0,
      };
      buckets.set(bucketId, bucket);
    }

    if (tx.type === TransactionType.DEPOSIT) {
      bucket.inbound = bucket.inbound.add(tx.amount);
    } else if (tx.type === TransactionType.WITHDRAWAL) {
      bucket.outbound = bucket.outbound.add(tx.amount);
    } else if (tx.type === TransactionType.SETTLEMENT) {
      // In digital banking, merchant settlements are net merchant payouts (outbound)
      bucket.outbound = bucket.outbound.add(tx.amount);
    }

    bucket.count += 1;
  }

  const result: HourlyBucket[] = [];
  const sortedBucketIds = Array.from(buckets.keys()).sort();

  for (const id of sortedBucketIds) {
    const b = buckets.get(id)!;
    const netFlow = b.inbound.subtract(b.outbound);
    const grossVolume = b.inbound.add(b.outbound);

    result.push({
      bucketId: id,
      hourStart: b.hourStart,
      inbound: b.inbound,
      outbound: b.outbound,
      netFlow,
      grossVolume,
      transactionCount: b.count,
    });
  }

  return result;
}
