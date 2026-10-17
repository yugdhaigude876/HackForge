import { describe, it, expect } from "vitest";
import {
  generateTransactions,
  aggregateHourly,
  getSeasonalityMultiplier,
} from "@/engine/generator";
import { Money } from "@/engine/money";
import { TransactionType, TransactionStatus } from "@/engine/models";
import { SeededPRNG } from "@/engine/prng";

describe("Synthetic Transaction Generator", () => {
  const baseVolume = Money.fromMinor(20_000_000_00n, "USD"); // $20,000,000.00
  const defaultSeed = "hackathon-seed-123";

  describe("PRNG & String Seed Hashing", () => {
    it("produces identical random sequences for identical string seeds", () => {
      const prng1 = new SeededPRNG("seed-alpha");
      const prng2 = new SeededPRNG("seed-alpha");

      const seq1 = Array.from({ length: 10 }, () => prng1.next());
      const seq2 = Array.from({ length: 10 }, () => prng2.next());

      expect(seq1).toEqual(seq2);
    });

    it("produces different sequences for different string seeds", () => {
      const prng1 = new SeededPRNG("seed-alpha");
      const prng2 = new SeededPRNG("seed-beta");

      const seq1 = Array.from({ length: 10 }, () => prng1.next());
      const seq2 = Array.from({ length: 10 }, () => prng2.next());

      expect(seq1).not.toEqual(seq2);
    });

    it("generates integers strictly within [min, max]", () => {
      const prng = new SeededPRNG("integer-test");
      for (let i = 0; i < 100; i++) {
        const val = prng.nextInt(5, 12);
        expect(val).toBeGreaterThanOrEqual(5);
        expect(val).toBeLessThanOrEqual(12);
        expect(Number.isInteger(val)).toBe(true);
      }
    });

    it("generates deterministic valid UUID v4 strings", () => {
      const prng = new SeededPRNG("uuid-seed");
      const uuid1 = prng.nextUUID();
      const uuid2 = prng.nextUUID();

      expect(uuid1).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      );
      expect(uuid1).not.toBe(uuid2);

      // Reproducibility
      const prngCopy = new SeededPRNG("uuid-seed");
      expect(prngCopy.nextUUID()).toBe(uuid1);
    });
  });

  describe("Determinism Requirement", () => {
    it("produces deeply equal transaction arrays given the exact same seed", () => {
      const startDate = new Date("2026-10-19T09:00:00.000Z"); // Monday 9 AM
      const endDate = new Date("2026-10-19T13:00:00.000Z"); // 4 hours later

      const run1 = generateTransactions({
        seed: defaultSeed,
        startDate,
        endDate,
        baseVolumePerHour: baseVolume,
      });

      const run2 = generateTransactions({
        seed: defaultSeed,
        startDate,
        endDate,
        baseVolumePerHour: baseVolume,
      });

      expect(run1.length).toBeGreaterThan(0);
      expect(run1.length).toBe(run2.length);

      // Deep equality check across all fields
      for (let i = 0; i < run1.length; i++) {
        expect(run1[i].id).toBe(run2[i].id);
        expect(run1[i].timestamp.getTime()).toBe(run2[i].timestamp.getTime());
        expect(run1[i].type).toBe(run2[i].type);
        expect(run1[i].amount.equals(run2[i].amount)).toBe(true);
        expect(run1[i].amount.amountMinor).toBe(run2[i].amount.amountMinor);
        expect(run1[i].status).toBe(run2[i].status);
        expect(run1[i].counterparty).toBe(run2[i].counterparty);
      }
    });

    it("produces different transactions when seed differs", () => {
      const startDate = new Date("2026-10-19T09:00:00.000Z");
      const endDate = new Date("2026-10-19T11:00:00.000Z");

      const runA = generateTransactions({
        seed: "seed-variant-A",
        startDate,
        endDate,
        baseVolumePerHour: baseVolume,
      });

      const runB = generateTransactions({
        seed: "seed-variant-B",
        startDate,
        endDate,
        baseVolumePerHour: baseVolume,
      });

      expect(runA.map((t) => t.id)).not.toEqual(runB.map((t) => t.id));
      expect(runA.map((t) => t.amount.amountMinor)).not.toEqual(
        runB.map((t) => t.amount.amountMinor)
      );
    });
  });

  describe("Time Boundaries", () => {
    it("ensures no transactions are generated outside startDate and endDate", () => {
      const startDate = new Date("2026-10-19T08:15:00.000Z");
      const endDate = new Date("2026-10-19T14:45:00.000Z");

      const txs = generateTransactions({
        seed: "boundary-seed",
        startDate,
        endDate,
        baseVolumePerHour: baseVolume,
      });

      expect(txs.length).toBeGreaterThan(0);

      const startMs = startDate.getTime();
      const endMs = endDate.getTime();

      for (const tx of txs) {
        const txMs = tx.timestamp.getTime();
        expect(txMs).toBeGreaterThanOrEqual(startMs);
        expect(txMs).toBeLessThanOrEqual(endMs);
      }
    });

    it("returns an empty array when startDate is greater than or equal to endDate", () => {
      const d1 = new Date("2026-10-19T10:00:00.000Z");
      const d2 = new Date("2026-10-19T09:00:00.000Z");

      expect(
        generateTransactions({
          seed: "empty-seed",
          startDate: d1,
          endDate: d2,
          baseVolumePerHour: baseVolume,
        })
      ).toEqual([]);

      expect(
        generateTransactions({
          seed: "same-seed",
          startDate: d1,
          endDate: d1,
          baseVolumePerHour: baseVolume,
        })
      ).toEqual([]);
    });

    it("preserves chronological ordering of transactions", () => {
      const startDate = new Date("2026-10-19T00:00:00.000Z");
      const endDate = new Date("2026-10-19T06:00:00.000Z");

      const txs = generateTransactions({
        seed: "chrono-seed",
        startDate,
        endDate,
        baseVolumePerHour: baseVolume,
      });

      for (let i = 1; i < txs.length; i++) {
        expect(txs[i].timestamp.getTime()).toBeGreaterThanOrEqual(
          txs[i - 1].timestamp.getTime()
        );
      }
    });
  });

  describe("Money Amounts & Negative Constraints", () => {
    it("ensures all amounts are valid non-negative Money instances", () => {
      const startDate = new Date("2026-10-19T09:00:00.000Z");
      const endDate = new Date("2026-10-19T17:00:00.000Z");

      const txs = generateTransactions({
        seed: "money-integrity-seed",
        startDate,
        endDate,
        baseVolumePerHour: baseVolume,
      });

      expect(txs.length).toBeGreaterThan(0);

      for (const tx of txs) {
        expect(tx.amount).toBeInstanceOf(Money);
        expect(tx.amount.currency).toBe("USD");
        expect(tx.amount.isPositive()).toBe(true);
        expect(tx.amount.isNegative()).toBe(false);
        expect(() => tx.amount.assertNonNegative()).not.toThrow();
      }
    });
  });

  describe("Transaction Types & Mix", () => {
    it("generates a realistic mix of Deposits, Withdrawals, and Settlements", () => {
      const startDate = new Date("2026-10-19T09:00:00.000Z");
      const endDate = new Date("2026-10-20T09:00:00.000Z"); // 24 hours

      const txs = generateTransactions({
        seed: "type-mix-seed",
        startDate,
        endDate,
        baseVolumePerHour: baseVolume,
      });

      const deposits = txs.filter((t) => t.type === TransactionType.DEPOSIT);
      const withdrawals = txs.filter((t) => t.type === TransactionType.WITHDRAWAL);
      const settlements = txs.filter((t) => t.type === TransactionType.SETTLEMENT);

      expect(deposits.length).toBeGreaterThan(0);
      expect(withdrawals.length).toBeGreaterThan(0);
      expect(settlements.length).toBeGreaterThan(0);

      // Status checks
      const completed = txs.filter((t) => t.status === TransactionStatus.COMPLETED);
      expect(completed.length).toBeGreaterThan(txs.length * 0.9); // Vast majority completed
    });
  });

  describe("Seasonality & Volume Scaling", () => {
    it("evaluates getSeasonalityMultiplier across weekday and weekend hours", () => {
      // Monday 12 PM UTC (peak business hours)
      const mondayNoon = new Date("2026-10-19T12:00:00.000Z");
      expect(getSeasonalityMultiplier(mondayNoon)).toBe(1.5);

      // Monday 2 AM UTC (night hours)
      const mondayNight = new Date("2026-10-19T02:00:00.000Z");
      expect(getSeasonalityMultiplier(mondayNight)).toBe(0.35);

      // Saturday 2 PM UTC (weekend daytime)
      const saturdayNoon = new Date("2026-10-24T14:00:00.000Z");
      expect(getSeasonalityMultiplier(saturdayNoon)).toBe(0.65);

      // Saturday 3 AM UTC (weekend night)
      const saturdayNight = new Date("2026-10-24T03:00:00.000Z");
      expect(getSeasonalityMultiplier(saturdayNight)).toBe(0.25);
    });

    it("generates significantly higher volume during business hours than night hours", () => {
      // 4 peak business hours: Monday 10:00 - 14:00
      const businessTxs = generateTransactions({
        seed: "seasonality-compare",
        startDate: new Date("2026-10-19T10:00:00.000Z"),
        endDate: new Date("2026-10-19T14:00:00.000Z"),
        baseVolumePerHour: baseVolume,
      });

      // 4 night hours: Monday 01:00 - 05:00
      const nightTxs = generateTransactions({
        seed: "seasonality-compare",
        startDate: new Date("2026-10-19T01:00:00.000Z"),
        endDate: new Date("2026-10-19T05:00:00.000Z"),
        baseVolumePerHour: baseVolume,
      });

      const businessTotal = Money.sum(businessTxs.map((t) => t.amount));
      const nightTotal = Money.sum(nightTxs.map((t) => t.amount));

      // Business volume should be ~3x-5x night volume
      expect(businessTotal.greaterThan(nightTotal)).toBe(true);
      expect(businessTotal.toDecimal()).toBeGreaterThan(nightTotal.toDecimal() * 2.5);
    });

    it("scales total volume close to the digital bank's target rate (~$20M/hour)", () => {
      // Simulate an entire 24-hour weekday
      const txs = generateTransactions({
        seed: "volume-scale-test",
        startDate: new Date("2026-10-19T00:00:00.000Z"),
        endDate: new Date("2026-10-20T00:00:00.000Z"),
        baseVolumePerHour: baseVolume, // $20M
      });

      const totalVolume = Money.sum(txs.map((t) => t.amount));
      const totalMillions = totalVolume.toDecimal() / 1_000_000;

      // 24 hours * $20M with weekday seasonality average (~0.85x - 1.1x)
      // Expected total across 24h: ~$350M - $550M
      expect(totalMillions).toBeGreaterThan(300);
      expect(totalMillions).toBeLessThan(600);
    });
  });

  describe("Hourly Series Aggregation", () => {
    it("aggregates raw transactions into hourly buckets correctly", () => {
      const startDate = new Date("2026-10-19T09:00:00.000Z");
      const endDate = new Date("2026-10-19T12:00:00.000Z"); // 3 hours

      const txs = generateTransactions({
        seed: "hourly-test-seed",
        startDate,
        endDate,
        baseVolumePerHour: baseVolume,
      });

      const buckets = aggregateHourly(txs);
      expect(buckets.length).toBe(3);

      for (const bucket of buckets) {
        expect(bucket.bucketId).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000Z$/);
        expect(bucket.inbound.isPositive()).toBe(true);
        expect(bucket.outbound.isPositive()).toBe(true);
        expect(bucket.transactionCount).toBeGreaterThan(0);

        // Invariant: grossVolume === inbound + outbound
        expect(bucket.grossVolume.equals(bucket.inbound.add(bucket.outbound))).toBe(
          true
        );

        // Invariant: netFlow === inbound - outbound
        expect(
          bucket.netFlow.equals(bucket.inbound.subtract(bucket.outbound))
        ).toBe(true);
      }
    });
  });
});
