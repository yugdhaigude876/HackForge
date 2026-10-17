import { describe, it, expect } from "vitest";
import {
  calculateAllocationPercentage,
  buildForecastBandSeries,
  type HistoryInputPoint,
  type ForecastInputPoint,
} from "@/components/finance/forecast-band-utils";

describe("Pure Dashboard Utilities", () => {
  describe("calculateAllocationPercentage", () => {
    it("calculates standard allocation percentages correctly", () => {
      // $25M allocated out of $100M capacity
      expect(calculateAllocationPercentage("2500000000", "10000000000")).toBe(25);
      // $1M out of $3M
      expect(calculateAllocationPercentage(1_000_000, 3_000_000)).toBeCloseTo(33.33, 1);
    });

    it("handles zero and negative amounts or zero capacity safely without divide-by-zero", () => {
      expect(calculateAllocationPercentage("0", "1000000")).toBe(0);
      expect(calculateAllocationPercentage("-500", "1000000")).toBe(0);
      expect(calculateAllocationPercentage("1000", "0")).toBe(0);
      expect(calculateAllocationPercentage("1000", "-5000")).toBe(0);
    });

    it("clamps percentages exceeding 100% to 100", () => {
      expect(calculateAllocationPercentage("1500000", "1000000")).toBe(100);
      expect(calculateAllocationPercentage(200, 100)).toBe(100);
    });

    it("preserves precision on very large BigInt values exceeding 2^53 (Number.MAX_SAFE_INTEGER)", () => {
      // 2^53 + 1 = 9007199254740993n
      const hugeAmt = 9007199254740993n;
      // 2 * (2^53 + 1) = 18014398509481986n
      const hugeCap = 18014398509481986n;

      // Exactly 50.00%
      expect(calculateAllocationPercentage(hugeAmt, hugeCap)).toBe(50);

      // Huge capacity with 75% deployment
      const hugeCap75 = 1000000000000000000n; // 10^18 minor units
      const hugeAmt75 = 750000000000000000n;
      expect(calculateAllocationPercentage(hugeAmt75, hugeCap75)).toBe(75);
    });
  });

  describe("buildForecastBandSeries", () => {
    it("uses exact stored quantile bands when provided on forecast points", () => {
      const history: HistoryInputPoint[] = [{ hour: 0, net: 100_000 }];
      const predictions: ForecastInputPoint[] = [
        {
          hour: 1,
          mean: 500_000,
          bandLower: 420_000,
          bandUpper: 580_000,
        },
        {
          hour: 2,
          mean: 600_000,
          bandLower: 510_000,
          bandUpper: 690_000,
        },
      ];

      const series = buildForecastBandSeries(history, predictions);

      expect(series).toHaveLength(3);

      // History point
      expect(series[0].actual).toBe(100_000);
      expect(series[0].mean).toBeNull();
      expect(series[0].bandLower).toBeNull();
      expect(series[0].bandUpper).toBeNull();

      // Forecast points with exact quantiles
      expect(series[1].mean).toBe(500_000);
      expect(series[1].bandLower).toBe(420_000);
      expect(series[1].bandUpper).toBe(580_000);
      expect(series[1].bandRange).toEqual([420_000, 580_000]);

      expect(series[2].mean).toBe(600_000);
      expect(series[2].bandLower).toBe(510_000);
      expect(series[2].bandUpper).toBe(690_000);
      expect(series[2].bandRange).toEqual([510_000, 690_000]);
    });

    it("falls back to expanding cone when points omit stored quantiles", () => {
      const history: HistoryInputPoint[] = [];
      const predictions: ForecastInputPoint[] = [
        { hour: 1, mean: 1_000_000 },
        { hour: 2, mean: 1_200_000 },
      ];

      const series = buildForecastBandSeries(history, predictions, {
        mae: 50_000,
        mase: 0.8,
      });

      expect(series).toHaveLength(2);
      expect(series[0].mean).toBe(1_000_000);
      expect(series[0].bandLower).toBeLessThan(1_000_000);
      expect(series[0].bandUpper).toBeGreaterThan(1_000_000);

      // Uncertainty expands over the horizon
      const spread1 = (series[0].bandUpper ?? 0) - (series[0].bandLower ?? 0);
      const spread2 = (series[1].bandUpper ?? 0) - (series[1].bandLower ?? 0);
      expect(spread2).toBeGreaterThan(spread1);
    });

    it("handles empty history and empty predictions gracefully", () => {
      const series = buildForecastBandSeries([], []);
      expect(series).toEqual([]);
    });
  });
});
