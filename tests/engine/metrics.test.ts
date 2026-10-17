import { describe, it, expect } from "vitest";
import {
  calculateMAE,
  calculateInSampleScaleMAE,
  calculateMASE,
  calculatePinballLoss,
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
});
