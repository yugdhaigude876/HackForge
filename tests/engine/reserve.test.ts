import { describe, it, expect } from "vitest";
import {
  calculateQuantile,
  calculateResidualQuantile,
  extractCumulativeResiduals,
  computeRequiredReserve,
  computeDeployableSurplus,
  ReserveCalculator,
} from "@/engine/reserve";
import { Money } from "@/engine/money";
import { EvaluatedWindow } from "@/engine/forecast";
import { HourlyBucket } from "@/engine/models";

describe("Reserve & Deployable Surplus Engine", () => {
  describe("Quantile Mathematics (calculateQuantile)", () => {
    it("returns the exact single value for a 1-element array", () => {
      expect(calculateQuantile([42], 0)).toBe(42);
      expect(calculateQuantile([42], 0.5)).toBe(42);
      expect(calculateQuantile([42], 1)).toBe(42);
    });

    it("performs exact linear interpolation across sorted array", () => {
      // 5 values: indices 0..4
      const values = [10, 20, 30, 40, 50];

      // Exact grid points: rank = q * 4
      expect(calculateQuantile(values, 0.0)).toBe(10);
      expect(calculateQuantile(values, 0.25)).toBe(20);
      expect(calculateQuantile(values, 0.5)).toBe(30); // median
      expect(calculateQuantile(values, 0.75)).toBe(40);
      expect(calculateQuantile(values, 1.0)).toBe(50);

      // Fractional interpolation: q = 0.3 -> rank = 1.2 -> 20 + 0.2 * (30 - 20) = 22
      expect(calculateQuantile(values, 0.3)).toBeCloseTo(22, 6);

      // q = 0.85 -> rank = 3.4 -> 40 + 0.4 * (50 - 40) = 44
      expect(calculateQuantile(values, 0.85)).toBeCloseTo(44, 6);
    });

    it("handles negative numbers and mixed-sign distributions correctly", () => {
      // Unsorted input with negative, zero, and positive values
      const mixed = [10, -50, 80, 0, -20];
      // Sorted: [-50, -20, 0, 10, 80]

      expect(calculateQuantile(mixed, 0.0)).toBe(-50);
      expect(calculateQuantile(mixed, 0.5)).toBe(0);
      expect(calculateQuantile(mixed, 1.0)).toBe(80);

      // 1st percentile (alpha = 0.01): rank = 0.01 * 4 = 0.04 -> -50 + 0.04 * (-20 - (-50)) = -50 + 1.2 = -48.8
      expect(calculateQuantile(mixed, 0.01)).toBeCloseTo(-48.8, 4);
    });

    it("throws error for empty arrays", () => {
      expect(() => calculateQuantile([], 0.5)).toThrow(/empty array/);
    });

    it("throws error for out-of-range quantile values", () => {
      expect(() => calculateQuantile([1, 2], -0.1)).toThrow(/between 0 and 1/);
      expect(() => calculateQuantile([1, 2], 1.1)).toThrow(/between 0 and 1/);
      expect(() => calculateQuantile([1, 2], NaN)).toThrow(/between 0 and 1/);
    });
  });

  describe("Residual Quantiles from Backtests", () => {
    function mockEvaluatedWindow(index: number, residualValues: number[]): EvaluatedWindow {
      const residuals = residualValues.map((v) => Money.fromDecimal(v.toFixed(2)));
      return {
        windowIndex: index,
        asOf: new Date("2026-10-19T00:00:00.000Z"),
        target: [] as HourlyBucket[],
        predictions: [],
        actuals: [],
        residuals,
      };
    }

    it("extracts cumulative horizon residuals across windows", () => {
      const windows: EvaluatedWindow[] = [
        mockEvaluatedWindow(0, [-1000, -2000]), // sum = -$3,000
        mockEvaluatedWindow(1, [500, 1500]),    // sum = +$2,000
        mockEvaluatedWindow(2, [-4000, -1000]), // sum = -$5,000
      ];

      const cumulative = extractCumulativeResiduals(windows);
      expect(cumulative).toHaveLength(3);
      expect(cumulative[0].toDecimal()).toBe(-3000);
      expect(cumulative[1].toDecimal()).toBe(2000);
      expect(cumulative[2].toDecimal()).toBe(-5000);
    });

    it("computes the empirical residual quantile q_H(alpha) as Money", () => {
      const residuals = [
        Money.fromDecimal("-6000000.00"),
        Money.fromDecimal("-4000000.00"),
        Money.fromDecimal("-2000000.00"),
        Money.fromDecimal("0.00"),
        Money.fromDecimal("1000000.00"),
      ];

      // Alpha = 0.0 (worst observed shortfall)
      const qMin = calculateResidualQuantile(residuals, 0.0);
      expect(qMin.toDecimal()).toBe(-6000000);

      // Alpha = 0.5 (median residual)
      const qMed = calculateResidualQuantile(residuals, 0.5);
      expect(qMed.toDecimal()).toBe(-2000000);
    });
  });

  describe("Reserve Computation (FINANCIAL_MODEL.md Formula)", () => {
    it("matches the exact synthetic worked example from FINANCIAL_MODEL.md", () => {
      // From FINANCIAL_MODEL.md lines 47-49:
      // C = 50,000,000
      // H = 4
      // mu_H = -8,000,000
      // q_H(0.01) = -6,000,000 (worst-case extra outflow)
      // F = 2,000,000 (operational floor buffer)
      // Z = 0
      // Expected R = 8,000,000 + 6,000,000 + 2,000,000 = 16,000,000
      const mu_H = Money.fromDecimal("-8000000.00");
      const q_alpha = Money.fromDecimal("-6000000.00");
      const floorF = Money.fromDecimal("2000000.00");
      const stressZ = Money.zero();

      const result = computeRequiredReserve({
        expectedCumulativeFlow: mu_H,
        worstCaseResidualShortfall: q_alpha,
        operationalFloor: floorF,
        stressAddOn: stressZ,
      });

      expect(result.requiredReserve.toDecimal()).toBe(16000000);
      expect(result.expectedOutflowCover.toDecimal()).toBe(14000000); // | -8M + -6M | = 14M
      expect(result.operationalFloor.toDecimal()).toBe(2000000);
      expect(result.stressAddOn.toDecimal()).toBe(0);
    });

    it("requires only buffer floors when cumulative flows remain positive in worst-case", () => {
      // Forecast expects large inflow: +$20M
      // Worst-case shortfall is -$5M
      // Net worst-case flow = +$20M - $5M = +$15M (still positive inflow!)
      // Expected outflow cover = $0
      // R = 0 + F + Z
      const mu_H = Money.fromDecimal("20000000.00");
      const q_alpha = Money.fromDecimal("-5000000.00");
      const floorF = Money.fromDecimal("3000000.00");
      const stressZ = Money.fromDecimal("1000000.00");

      const result = computeRequiredReserve({
        expectedCumulativeFlow: mu_H,
        worstCaseResidualShortfall: q_alpha,
        operationalFloor: floorF,
        stressAddOn: stressZ,
      });

      expect(result.expectedOutflowCover.toDecimal()).toBe(0);
      expect(result.requiredReserve.toDecimal()).toBe(4000000); // 3M + 1M
    });
  });

  describe("Deployable Surplus Calculation", () => {
    it("computes healthy deployable surplus matching the FINANCIAL_MODEL.md worked example", () => {
      // C = 50,000,000; R = 16,000,000 -> Surplus = 34,000,000
      const totalCash = Money.fromDecimal("50000000.00");
      const requiredReserve = Money.fromDecimal("16000000.00");

      const surplusResult = computeDeployableSurplus({
        totalCash,
        requiredReserve,
      });

      expect(surplusResult.deployableSurplus.toDecimal()).toBe(34000000);
      expect(surplusResult.reserveGap.toDecimal()).toBe(0);
      expect(surplusResult.status).toBe("HEALTHY");
      expect(surplusResult.coverageRatio).toBeCloseTo(50 / 16, 4); // 3.125
      expect(surplusResult.explanation).toMatch(/Surplus of \$34,000,000\.00 is safe to deploy/);
    });

    it("identifies UNDER_RESERVED state when available cash is less than required reserve", () => {
      // Total cash = $12M, Required Reserve = $16M
      // Deficit: Surplus = $0, Gap = $4M, status = UNDER_RESERVED
      const totalCash = Money.fromDecimal("12000000.00");
      const requiredReserve = Money.fromDecimal("16000000.00");

      const surplusResult = computeDeployableSurplus({
        totalCash,
        requiredReserve,
      });

      expect(surplusResult.deployableSurplus.toDecimal()).toBe(0);
      expect(surplusResult.reserveGap.toDecimal()).toBe(4000000);
      expect(surplusResult.status).toBe("UNDER_RESERVED");
      expect(surplusResult.coverageRatio).toBe(0.75); // 12 / 16
      expect(surplusResult.explanation).toMatch(/Liquidity shortfall.*Gap is \$4,000,000\.00/);
    });

    it("flags LOW_CONFIDENCE when backtest confidence is low even if surplus is positive", () => {
      const totalCash = Money.fromDecimal("50000000.00");
      const requiredReserve = Money.fromDecimal("20000000.00");

      const surplusResult = computeDeployableSurplus({
        totalCash,
        requiredReserve,
        isLowConfidence: true,
      });

      expect(surplusResult.deployableSurplus.toDecimal()).toBe(30000000);
      expect(surplusResult.status).toBe("LOW_CONFIDENCE");
      expect(surplusResult.explanation).toMatch(/sample confidence is low/);
    });
  });

  describe("ReserveCalculator High-Level Module", () => {
    it("integrates active forecast, backtest windows, and cash balance", () => {
      const calculator = new ReserveCalculator({
        alpha: 0.05,
        operationalFloor: Money.fromDecimal("2000000.00"),
      });

      // Active forecast: 4 hours of net outflows totaling -$8M
      const activeForecast = [
        Money.fromDecimal("-2000000.00"),
        Money.fromDecimal("-2000000.00"),
        Money.fromDecimal("-2000000.00"),
        Money.fromDecimal("-2000000.00"),
      ];

      // 40 mock backtest windows to exceed minSampleSize (30)
      const mockWindows: EvaluatedWindow[] = Array.from({ length: 40 }, (_, i) => ({
        windowIndex: i,
        asOf: new Date("2026-10-19T00:00:00.000Z"),
        target: [],
        predictions: [],
        actuals: [],
        // Residuals ranging from -$5M to +$1M
        residuals: [Money.fromDecimal(`${-5000000 + i * 150000}`)],
      }));

      const totalCash = Money.fromDecimal("62400000.00"); // From sampleBalances
      const calcResult = calculator.calculate(activeForecast, mockWindows, totalCash);

      expect(calcResult.sampleSize).toBe(40);
      expect(calcResult.isLowConfidence).toBe(false);
      expect(calcResult.reserve.requiredReserve.toDecimal()).toBeGreaterThan(0);
      expect(calcResult.surplus.deployableSurplus.toDecimal()).toBeGreaterThan(0);
      expect(calcResult.surplus.status).toBe("HEALTHY");
    });
  });
});
