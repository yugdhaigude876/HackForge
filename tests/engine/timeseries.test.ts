import { describe, it, expect } from "vitest";
import {
  buildContinuousTimeSeries,
  fillTimeSeriesGaps,
  createRollingWindows,
  splitTimeSeries,
  validateContinuousSeries,
  floorToHour,
  createZeroBucket,
} from "@/engine/timeseries";
import { Money } from "@/engine/money";
import { Transaction, TransactionType, TransactionStatus, HourlyBucket } from "@/engine/models";
import { generateTransactions } from "@/engine/generator";

describe("Time-Series Pipeline & Hourly Aggregation", () => {
  const ONE_HOUR_MS = 60 * 60 * 1000;

  function mockTransaction(
    id: string,
    isoTimestamp: string,
    type: TransactionType,
    amountDollars: number,
    status = TransactionStatus.COMPLETED
  ): Transaction {
    return {
      id,
      timestamp: new Date(isoTimestamp),
      type,
      amount: Money.fromDecimal(amountDollars.toFixed(2), "USD"),
      status,
    };
  }

  describe("Continuous Time-Series Builder & Zero-Filling", () => {
    it("floors date to the start of the hour", () => {
      const d = new Date("2026-10-19T14:35:22.123Z");
      const floored = floorToHour(d);
      expect(floored.toISOString()).toBe("2026-10-19T14:00:00.000Z");
    });

    it("creates a valid zero-filled bucket", () => {
      const d = new Date("2026-10-19T08:00:00.000Z");
      const zeroBucket = createZeroBucket(d, "USD");

      expect(zeroBucket.bucketId).toBe("2026-10-19T08:00:00.000Z");
      expect(zeroBucket.inbound.amountMinor).toBe(0n);
      expect(zeroBucket.outbound.amountMinor).toBe(0n);
      expect(zeroBucket.netFlow.amountMinor).toBe(0n);
      expect(zeroBucket.grossVolume.amountMinor).toBe(0n);
      expect(zeroBucket.transactionCount).toBe(0);
    });

    it("correctly zero-fills missing hours in sparse transaction streams", () => {
      // Transactions only at hour 10:00 and hour 14:00 (4 hours later)
      const sparseTxs: Transaction[] = [
        mockTransaction("tx1", "2026-10-19T10:15:00.000Z", TransactionType.DEPOSIT, 5000),
        mockTransaction("tx2", "2026-10-19T14:45:00.000Z", TransactionType.WITHDRAWAL, 2000),
      ];

      const continuous = buildContinuousTimeSeries(sparseTxs);

      // Expected hours: 10:00, 11:00, 12:00, 13:00, 14:00 = 5 continuous hours
      expect(continuous.length).toBe(5);

      // Hour 10 (has deposit)
      expect(continuous[0].bucketId).toBe("2026-10-19T10:00:00.000Z");
      expect(continuous[0].inbound.toDecimal()).toBe(5000);
      expect(continuous[0].outbound.amountMinor).toBe(0n);
      expect(continuous[0].netFlow.toDecimal()).toBe(5000);
      expect(continuous[0].transactionCount).toBe(1);

      // Zero-filled gap: Hours 11, 12, 13
      for (let i = 1; i <= 3; i++) {
        const gapBucket = continuous[i];
        expect(gapBucket.inbound.amountMinor).toBe(0n);
        expect(gapBucket.outbound.amountMinor).toBe(0n);
        expect(gapBucket.netFlow.amountMinor).toBe(0n);
        expect(gapBucket.grossVolume.amountMinor).toBe(0n);
        expect(gapBucket.transactionCount).toBe(0);
      }
      expect(continuous[1].bucketId).toBe("2026-10-19T11:00:00.000Z");
      expect(continuous[2].bucketId).toBe("2026-10-19T12:00:00.000Z");
      expect(continuous[3].bucketId).toBe("2026-10-19T13:00:00.000Z");

      // Hour 14 (has withdrawal)
      expect(continuous[4].bucketId).toBe("2026-10-19T14:00:00.000Z");
      expect(continuous[4].inbound.amountMinor).toBe(0n);
      expect(continuous[4].outbound.toDecimal()).toBe(2000);
      expect(continuous[4].netFlow.toDecimal()).toBe(-2000);
      expect(continuous[4].transactionCount).toBe(1);

      // Verify strict continuity
      const validation = validateContinuousSeries(continuous);
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it("respects explicit startDate and endDate with leading/trailing zero-filling", () => {
      // Transaction only at 12:00
      const txs = [
        mockTransaction("tx1", "2026-10-19T12:30:00.000Z", TransactionType.DEPOSIT, 1000),
      ];

      // Explicit range: 09:00 to 15:00 (7 hours total)
      const startDate = new Date("2026-10-19T09:00:00.000Z");
      const endDate = new Date("2026-10-19T15:00:00.000Z");

      const series = buildContinuousTimeSeries(txs, { startDate, endDate });

      expect(series.length).toBe(7);
      expect(series[0].bucketId).toBe("2026-10-19T09:00:00.000Z");
      expect(series[6].bucketId).toBe("2026-10-19T15:00:00.000Z");

      // Only index 3 (12:00) has transactions
      expect(series[3].inbound.toDecimal()).toBe(1000);
      expect(series[3].transactionCount).toBe(1);

      // All other indices are zero-filled
      for (let i = 0; i < series.length; i++) {
        if (i !== 3) {
          expect(series[i].inbound.amountMinor).toBe(0n);
          expect(series[i].transactionCount).toBe(0);
        }
      }
    });

    it("excludes FAILED transactions from net flows", () => {
      const txs = [
        mockTransaction("tx1", "2026-10-19T10:00:00.000Z", TransactionType.DEPOSIT, 1000),
        mockTransaction(
          "tx2",
          "2026-10-19T10:10:00.000Z",
          TransactionType.DEPOSIT,
          5000,
          TransactionStatus.FAILED
        ),
      ];

      const series = buildContinuousTimeSeries(txs);
      expect(series.length).toBe(1);
      expect(series[0].inbound.toDecimal()).toBe(1000); // 5000 failed excluded
      expect(series[0].transactionCount).toBe(1);
    });

    it("fills gaps in an already existing sparse HourlyBucket array", () => {
      const sparseBuckets: HourlyBucket[] = [
        {
          bucketId: "2026-10-19T08:00:00.000Z",
          hourStart: new Date("2026-10-19T08:00:00.000Z"),
          inbound: Money.fromDecimal("100.00"),
          outbound: Money.zero(),
          netFlow: Money.fromDecimal("100.00"),
          grossVolume: Money.fromDecimal("100.00"),
          transactionCount: 2,
        },
        {
          bucketId: "2026-10-19T11:00:00.000Z",
          hourStart: new Date("2026-10-19T11:00:00.000Z"),
          inbound: Money.zero(),
          outbound: Money.fromDecimal("50.00"),
          netFlow: Money.fromDecimal("-50.00"),
          grossVolume: Money.fromDecimal("50.00"),
          transactionCount: 1,
        },
      ];

      const filled = fillTimeSeriesGaps(sparseBuckets);
      expect(filled.length).toBe(4); // 08:00, 09:00, 10:00, 11:00
      expect(filled[0].inbound.toDecimal()).toBe(100);
      expect(filled[1].inbound.amountMinor).toBe(0n);
      expect(filled[2].inbound.amountMinor).toBe(0n);
      expect(filled[3].outbound.toDecimal()).toBe(50);

      expect(validateContinuousSeries(filled).isValid).toBe(true);
    });
  });

  describe("Rolling Window Generator", () => {
    // Generate a continuous synthetic 200-hour series
    function generateSyntheticSeries(totalHours: number): HourlyBucket[] {
      const start = new Date("2026-10-01T00:00:00.000Z");
      const buckets: HourlyBucket[] = [];

      for (let h = 0; h < totalHours; h++) {
        const hourStart = new Date(start.getTime() + h * ONE_HOUR_MS);
        const inAmt = (1000 + (h % 24) * 100).toFixed(2);
        const outAmt = (800 + ((h + 5) % 24) * 80).toFixed(2);
        const inbound = Money.fromDecimal(inAmt);
        const outbound = Money.fromDecimal(outAmt);

        buckets.push({
          bucketId: hourStart.toISOString(),
          hourStart,
          inbound,
          outbound,
          netFlow: inbound.subtract(outbound),
          grossVolume: inbound.add(outbound),
          transactionCount: 10,
        });
      }

      return buckets;
    }

    it("creates exact number of rolling windows with strict boundary lengths", () => {
      const totalHours = 200;
      const series = generateSyntheticSeries(totalHours);

      const lookbackHours = 168; // 1 week
      const horizonHours = 24; // 1 day
      // Window size = 168 + 24 = 192 hours
      // Expected windows with step = 1: 200 - 192 + 1 = 9 windows

      const windows = createRollingWindows(series, lookbackHours, horizonHours, 1);

      expect(windows.length).toBe(9);

      for (let w = 0; w < windows.length; w++) {
        const win = windows[w];
        expect(win.index).toBe(w);

        // Strict length enforcement
        expect(win.history).toHaveLength(168);
        expect(win.target).toHaveLength(24);

        // asOf corresponds to the last timestamp of history
        expect(win.asOf.getTime()).toBe(win.history[167].hourStart.getTime());

        // target starts exactly 1 hour after asOf
        const firstTargetMs = win.target[0].hourStart.getTime();
        expect(firstTargetMs - win.asOf.getTime()).toBe(ONE_HOUR_MS);

        // Last element of history immediately precedes first element of target
        expect(win.history[win.history.length - 1].hourStart.getTime()).toBe(
          win.target[0].hourStart.getTime() - ONE_HOUR_MS
        );
      }
    });

    it("preserves netFlow and Money values accurately in windowed slices", () => {
      const series = generateSyntheticSeries(100);
      const windows = createRollingWindows(series, 48, 12, 1);

      const firstWindow = windows[0];

      for (let i = 0; i < 48; i++) {
        expect(firstWindow.history[i].netFlow.equals(series[i].netFlow)).toBe(true);
      }

      for (let j = 0; j < 12; j++) {
        expect(firstWindow.target[j].netFlow.equals(series[48 + j].netFlow)).toBe(
          true
        );
      }
    });

    it("supports custom step intervals (e.g. daily step = 24 hours)", () => {
      // 240 hours series = 10 days
      const series = generateSyntheticSeries(240);
      // Window = 168 + 24 = 192 hours.
      // (240 - 192) = 48 hours slack. With step = 24: window at offset 0, offset 24, offset 48 -> 3 windows
      const dailyWindows = createRollingWindows(series, 168, 24, 24);

      expect(dailyWindows).toHaveLength(3);
      expect(dailyWindows[0].index).toBe(0);
      expect(dailyWindows[1].index).toBe(1);
      expect(dailyWindows[2].index).toBe(2);

      // asOf should advance by 24 hours between consecutive windows
      expect(dailyWindows[1].asOf.getTime() - dailyWindows[0].asOf.getTime()).toBe(
        24 * ONE_HOUR_MS
      );
      expect(dailyWindows[2].asOf.getTime() - dailyWindows[1].asOf.getTime()).toBe(
        24 * ONE_HOUR_MS
      );
    });

    it("returns empty array when series is shorter than lookback + horizon", () => {
      const shortSeries = generateSyntheticSeries(50);
      const windows = createRollingWindows(shortSeries, 168, 24);
      expect(windows).toEqual([]);
    });

    it("throws error on invalid window parameters", () => {
      const series = generateSyntheticSeries(100);
      expect(() => createRollingWindows(series, 0, 24)).toThrow(/lookbackHours/);
      expect(() => createRollingWindows(series, -10, 24)).toThrow(/lookbackHours/);
      expect(() => createRollingWindows(series, 24, 0)).toThrow(/horizonHours/);
      expect(() => createRollingWindows(series, 24, 12, 0)).toThrow(/stepHours/);
    });
  });

  describe("Data Splitting Utility", () => {
    const series = Array.from({ length: 100 }, (_, i) => {
      const hourStart = new Date(new Date("2026-10-01T00:00:00.000Z").getTime() + i * ONE_HOUR_MS);
      return createZeroBucket(hourStart);
    });

    it("splits series by train ratio with no future data leakage", () => {
      const { train, test, splitDate } = splitTimeSeries(series, { trainRatio: 0.8 });

      expect(train.length).toBe(80);
      expect(test.length).toBe(20);
      expect(train.length + test.length).toBe(series.length);

      // Verify no overlap: last train timestamp < first test timestamp
      const lastTrainMs = train[train.length - 1].hourStart.getTime();
      const firstTestMs = test[0].hourStart.getTime();
      expect(firstTestMs - lastTrainMs).toBe(ONE_HOUR_MS);
      expect(splitDate.getTime()).toBe(firstTestMs);
    });

    it("splits series by explicit splitDate", () => {
      const targetSplit = new Date("2026-10-02T12:00:00.000Z");
      const { train, test } = splitTimeSeries(series, { splitDate: targetSplit });

      expect(train.every((b) => b.hourStart.getTime() < targetSplit.getTime())).toBe(
        true
      );
      expect(test.every((b) => b.hourStart.getTime() >= targetSplit.getTime())).toBe(
        true
      );
    });

    it("handles boundary ratios 0 and 1 cleanly", () => {
      const split0 = splitTimeSeries(series, { trainRatio: 0 });
      expect(split0.train).toHaveLength(0);
      expect(split0.test).toHaveLength(100);

      const split1 = splitTimeSeries(series, { trainRatio: 1 });
      expect(split1.train).toHaveLength(100);
      expect(split1.test).toHaveLength(0);
    });
  });

  describe("End-to-End Pipeline Integration with Generator", () => {
    it("converts raw synthetic generator output into a valid continuous time-series", () => {
      const startDate = new Date("2026-10-19T00:00:00.000Z");
      const endDate = new Date("2026-10-21T00:00:00.000Z"); // 48 hours

      const rawTxs = generateTransactions({
        seed: "pipeline-e2e-seed",
        startDate,
        endDate,
        baseVolumePerHour: Money.fromDecimal("20000000.00"),
      });

      const series = buildContinuousTimeSeries(rawTxs, { startDate, endDate });

      // Must have exactly 49 hourly buckets (00:00 day 1 through 00:00 day 3)
      expect(series.length).toBe(49);

      // Verify validation passes without any gap or duplicate
      const validation = validateContinuousSeries(series);
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);

      // Generate sliding windows (24h lookback, 12h horizon)
      const windows = createRollingWindows(series, 24, 12, 1);
      // 49 - (24 + 12) + 1 = 14 windows
      expect(windows.length).toBe(14);
      expect(windows[0].history).toHaveLength(24);
      expect(windows[0].target).toHaveLength(12);
    });
  });
});
