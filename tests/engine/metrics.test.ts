import { describe, it, expect } from "vitest";
import {
  calculateMAE,
  calculateInSampleScaleMAE,
  calculateMASE,
  calculatePinballLoss,
  calculateSkillScore,
  calculateIntervalCoverage,
  evaluateModelAndBaselinesOnWindows,
} from "@/engine/metrics";
import { Money } from "@/engine/money";
import { HourlyBucket } from "@/engine/models";

describe("Forecast Evaluation Metrics", () => {
  const ONE_HOUR_MS = 60 * 60 * 1000;

  function createMockBucket(hourIndex: number, netFlowDollars: number): HourlyBucket {
    const hourStart = new Date(new Date("2026-10-01T00:00:00.000Z").getTime() + hourIndex * ONE_HOUR_MS);
    const netFlow = Money.fromDecimal(netFlowDollars.toFixed(2));
    const isPos = netFlowDollars >= 0;
    return {
      bucketId: hourStart.toISOString(),
      hourStart,
      inbound: isPos ? netFlow : Money.zero(),
      outbound: isPos ? Money.zero() : netFlow.abs(),
      netFlow,
      grossVolume: netFlow.abs(),
      transactionCount: 5,
    };
  }

  describe("MAE (Mean Absolute Error)", () => {
    it("computes exact MAE in minor units and dollars", () => {
      // actuals: [$100.00, $200.00, $300.00]
      // predictions: [$110.00, $180.00, $300.00]
      // absolute errors: [$10.00, $20.00, $0.00] -> mean = $10.00 (1000 cents)
      const actuals = [
        Money.fromDecimal("100.00"),
        Money.fromDecimal("200.00"),
        Money.fromDecimal("300.00"),
      ];
      const predictions = [
        Money.fromDecimal("110.00"),
        Money.fromDecimal("180.00"),
        Money.fromDecimal("300.00"),
      ];

      const res = calculateMAE(actuals, predictions);
      expect(res.maeMinor).toBe(1000);
      expect(res.maeDollars).toBe(10);
    });

    it("returns 0 for identical actuals and predictions", () => {
      const series = [Money.fromDecimal("50.00"), Money.fromDecimal("-30.00")];
      const res = calculateMAE(series, series);
      expect(res.maeMinor).toBe(0);
      expect(res.maeDollars).toBe(0);
    });

    it("throws error when lengths mismatch", () => {
      const a = [Money.fromDecimal("10.00")];
      const b = [Money.fromDecimal("10.00"), Money.fromDecimal("20.00")];
      expect(() => calculateMAE(a, b)).toThrow(/length/);
    });
  });

  describe("MASE (Mean Absolute Scaled Error)", () => {
    it("computes in-sample scaling denominator Q from history", () => {
      // Create 5 buckets: 100, 110, 120, 130, 140
      // 1-step differences: 10, 10, 10, 10 -> average = 10 ($10.00 = 1000 cents)
      const history = [
        createMockBucket(0, 100),
        createMockBucket(1, 110),
        createMockBucket(2, 120),
        createMockBucket(3, 130),
        createMockBucket(4, 140),
      ];

      const Q = calculateInSampleScaleMAE(history, 168);
      expect(Q).toBe(1000); // 1000 cents
    });

    it("evaluates MASE correctly against scale", () => {
      const actuals = [Money.fromDecimal("100.00")];
      const predictions = [Money.fromDecimal("105.00")]; // error = $5.00 = 500 cents
      const scaleMAE = 1000; // baseline scale = $10.00 = 1000 cents

      // MASE = 500 / 1000 = 0.5 (model is 2x better than baseline)
      const mase = calculateMASE(actuals, predictions, scaleMAE);
      expect(mase).toBe(0.5);
    });

    it("returns 1.0 when forecaster error matches baseline error", () => {
      const actuals = [Money.fromDecimal("100.00")];
      const predictions = [Money.fromDecimal("110.00")]; // error = $10.00 = 1000 cents
      const scaleMAE = 1000;

      const mase = calculateMASE(actuals, predictions, scaleMAE);
      expect(mase).toBe(1.0);
    });

    it("handles zero baseline scale safely", () => {
      const actuals = [Money.fromDecimal("100.00")];
      const predictions = [Money.fromDecimal("105.00")];
      expect(calculateMASE(actuals, predictions, 0)).toBe(Number.POSITIVE_INFINITY);

      // If predictions are also perfect, MASE is 0
      expect(calculateMASE(actuals, actuals, 0)).toBe(0);
    });
  });

  describe("Pinball Loss (Quantile Loss)", () => {
    it("equals exactly half of MAE when tau = 0.5 (median loss)", () => {
      // actual: $100.00, pred: $80.00 -> u = +$20.00 (under-predicted)
      // actual: $200.00, pred: $250.00 -> u = -$50.00 (over-predicted)
      // Absolute errors: $20.00, $50.00 -> MAE = $35.00
      const actuals = [Money.fromDecimal("100.00"), Money.fromDecimal("200.00")];
      const predictions = [Money.fromDecimal("80.00"), Money.fromDecimal("250.00")];

      const mae = calculateMAE(actuals, predictions);
      const pinballHalf = calculatePinballLoss(actuals, predictions, 0.5);

      expect(pinballHalf.lossDollars).toBeCloseTo(mae.maeDollars / 2, 6);
    });

    it("asymmetrically penalizes under-predictions at high quantiles (tau = 0.9)", () => {
      // For tau = 0.9:
      // Scenario A: under-prediction by $100.00 (u = +100). Loss = 0.9 * 100 = $90.00
      // Scenario B: over-prediction by $100.00 (u = -100). Loss = (1 - 0.9) * 100 = $10.00
      const actualA = [Money.fromDecimal("200.00")];
      const predA = [Money.fromDecimal("100.00")]; // under-predicted

      const actualB = [Money.fromDecimal("100.00")];
      const predB = [Money.fromDecimal("200.00")]; // over-predicted

      const lossA = calculatePinballLoss(actualA, predA, 0.9);
      const lossB = calculatePinballLoss(actualB, predB, 0.9);

      expect(lossA.lossDollars).toBeCloseTo(90, 6);
      expect(lossB.lossDollars).toBeCloseTo(10, 6);
      // Under-prediction penalty is 9x higher at tau = 0.9!
      expect(lossA.lossDollars / lossB.lossDollars).toBeCloseTo(9, 6);
    });

    it("evaluates risk-based tail quantile tau = 0.99 accurately", () => {
      const actual = [Money.fromDecimal("1000.00")];
      const pred = [Money.fromDecimal("500.00")]; // shortfall of $500.00

      const loss = calculatePinballLoss(actual, pred, 0.99);
      // 0.99 * 500 = $495.00
      expect(loss.lossDollars).toBe(495);
    });

    it("throws error for invalid tau values", () => {
      const a = [Money.fromDecimal("100.00")];
      expect(() => calculatePinballLoss(a, a, 0)).toThrow(/tau/);
      expect(() => calculatePinballLoss(a, a, 1)).toThrow(/tau/);
      expect(() => calculatePinballLoss(a, a, -0.5)).toThrow(/tau/);
      expect(() => calculatePinballLoss(a, a, 1.5)).toThrow(/tau/);
    });
  });

  describe("Skill Score: (baseline - model) / baseline", () => {
    it("computes positive skill when model error is lower than baseline", () => {
      // baseline = 100, model = 80 -> skill = (100 - 80) / 100 = 0.20 (+20%)
      const res = calculateSkillScore(80, 100);
      expect(res.skill).toBeCloseTo(0.2, 6);
      expect(res.isBetter).toBe(true);
    });

    it("computes negative skill when model error exceeds baseline", () => {
      // baseline = 100, model = 120 -> skill = (100 - 120) / 100 = -0.20 (-20%)
      const res = calculateSkillScore(120, 100);
      expect(res.skill).toBeCloseTo(-0.2, 6);
      expect(res.isBetter).toBe(false);
    });

    it("computes zero skill when model error equals baseline error", () => {
      const res = calculateSkillScore(100, 100);
      expect(res.skill).toBe(0);
      expect(res.isBetter).toBe(false);
    });

    it("handles degenerate zero or negative baseline error safely with null and reason", () => {
      const resZero = calculateSkillScore(50, 0);
      expect(resZero.skill).toBeNull();
      expect(resZero.reason).toContain("Baseline score is non-positive");

      const resNegative = calculateSkillScore(50, -10);
      expect(resNegative.skill).toBeNull();
      expect(resNegative.reason).toContain("Baseline score is non-positive");
    });

    it("handles non-finite or missing scores safely with null, never NaN", () => {
      const resNaN = calculateSkillScore(Number.NaN, 100);
      expect(resNaN.skill).toBeNull();
      expect(Number.isNaN(resNaN.skill)).toBe(false);

      const resNull = calculateSkillScore(null, 100);
      expect(resNull.skill).toBeNull();
    });
  });

  describe("Interval Coverage Rate", () => {
    it("calculates empirical coverage rate on labelled fixture", () => {
      // 5 observations:
      // actuals: [10, 25, 50, 75, 120]
      // lower:   [10, 20, 40, 70, 100]
      // upper:   [20, 30, 60, 80, 110] -> 120 is out of band!
      // In-band: 4/5 = 0.80 (80%)
      const actuals = [
        Money.fromDecimal("10.00"),
        Money.fromDecimal("25.00"),
        Money.fromDecimal("50.00"),
        Money.fromDecimal("75.00"),
        Money.fromDecimal("120.00"),
      ];
      const lower = [
        Money.fromDecimal("10.00"),
        Money.fromDecimal("20.00"),
        Money.fromDecimal("40.00"),
        Money.fromDecimal("70.00"),
        Money.fromDecimal("100.00"),
      ];
      const upper = [
        Money.fromDecimal("20.00"),
        Money.fromDecimal("30.00"),
        Money.fromDecimal("60.00"),
        Money.fromDecimal("80.00"),
        Money.fromDecimal("110.00"),
      ];

      const res = calculateIntervalCoverage(actuals, lower, upper);
      expect(res.coverageRate).toBe(0.8);
      expect(res.inBandCount).toBe(4);
      expect(res.totalCount).toBe(5);
    });

    it("returns null with reason for empty series or mismatched lengths", () => {
      const empty = calculateIntervalCoverage([], [], []);
      expect(empty.coverageRate).toBeNull();
      expect(empty.reason).toContain("Empty actuals series");

      const mismatched = calculateIntervalCoverage(
        [Money.fromDecimal("10.00")],
        [Money.fromDecimal("5.00")],
        []
      );
      expect(mismatched.coverageRate).toBeNull();
      expect(mismatched.reason).toContain("Mismatched lengths");
    });
  });

  describe("Comparative Model vs Baselines Evaluation on Identical Windows", () => {
    it("returns null fields with reason when window count is zero", () => {
      const res = evaluateModelAndBaselinesOnWindows(
        { name: "TestModel", predict: () => [] },
        []
      );
      expect(res.windowCount).toBe(0);
      expect(res.model.mase).toBeNull();
      expect(res.naive.mase).toBeNull();
      expect(res.seasonalNaive.mase).toBeNull();
      expect(res.skillScores.vsNaive.mase.skill).toBeNull();
      expect(res.reason).toContain("Too few windows");
    });

    it("evaluates model, naive, and seasonal-naive baselines on identical windows", () => {
      // Build 2 rolling windows with distinct histories and targets
      const win1 = {
        index: 0,
        asOf: new Date("2026-10-01T10:00:00.000Z"),
        history: [
          createMockBucket(0, 100),
          createMockBucket(1, 110),
          createMockBucket(2, 120),
          createMockBucket(3, 130),
        ],
        target: [createMockBucket(4, 140), createMockBucket(5, 150)],
      };
      const win2 = {
        index: 1,
        asOf: new Date("2026-10-01T11:00:00.000Z"),
        history: [
          createMockBucket(1, 110),
          createMockBucket(2, 120),
          createMockBucket(3, 130),
          createMockBucket(4, 140),
        ],
        target: [createMockBucket(5, 150), createMockBucket(6, 160)],
      };

      // Model accurately predicts +10 trend
      const model = {
        name: "LinearTrendModel",
        predict: (history: readonly HourlyBucket[], horizon: number) => {
          const last = history[history.length - 1].netFlow;
          return Array.from({ length: horizon }, (_, idx) =>
            last.add(Money.fromDecimal(((idx + 1) * 10).toFixed(2)))
          );
        },
      };

      const res = evaluateModelAndBaselinesOnWindows(model, [win1, win2], {
        tau: 0.95,
        seasonalLag: 2,
      });

      expect(res.windowCount).toBe(2);
      expect(res.horizonHours).toBe(2);
      expect(res.model.name).toBe("LinearTrendModel");
      expect(res.naive.name).toBe("Naive (Flat Line)");
      expect(res.seasonalNaive.name).toBe("Seasonal Naive (Same Hour Last Week)");

      // Model made perfect predictions -> MAE = $0
      expect(res.model.maeDollars).toBe(0);
      expect(res.model.mase).toBe(0);

      // Naive projected flat line:
      // win1: last was 130 -> target was 140, 150 -> errors: 10, 20
      // win2: last was 140 -> target was 150, 160 -> errors: 10, 20
      // Naive MAE = (10+20+10+20)/4 = $15.00
      expect(res.naive.maeDollars).toBe(15);
      expect(res.naive.mase).toBeGreaterThan(0);

      // Model skill vs naive should be positive: (15 - 0) / 15 = 1.0 (100% skill)
      expect(res.skillScores.vsNaive.mae.skill).toBe(1);
      expect(res.skillScores.vsNaive.mae.isBetter).toBe(true);
    });

    it("handles zero scale history safely without returning NaN", () => {
      // Constant history: difference is always 0
      const win = {
        index: 0,
        asOf: new Date("2026-10-01T10:00:00.000Z"),
        history: [
          createMockBucket(0, 100),
          createMockBucket(1, 100),
          createMockBucket(2, 100),
        ],
        target: [createMockBucket(3, 100)],
      };

      const res = evaluateModelAndBaselinesOnWindows(
        { name: "FlatModel", predict: () => [Money.fromDecimal("100.00")] },
        [win],
        { seasonalLag: 1 }
      );

      expect(res.model.mase).toBeNull();
      expect(res.model.reason).toContain("In-sample scaling denominator is zero");
      expect(res.skillScores.vsNaive.mase.skill).toBeNull();
    });
  });
});

