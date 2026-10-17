import { describe, it, expect } from "vitest";
import {
  NaiveForecaster,
  SeasonalNaiveForecaster,
  evaluateForecaster,
  InsufficientHistoryError,
  InvalidForecastParameterError,
} from "@/engine/forecast";
import { Money } from "@/engine/money";
import { HourlyBucket } from "@/engine/models";
import { createRollingWindows } from "@/engine/timeseries";

describe("Forecasting Engine & Backtest Harness", () => {
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

  describe("Naive Forecaster (Flat Line)", () => {
    const model = new NaiveForecaster();

    it("predicts the last known observation flat across the entire horizon", () => {
      const history = [
        createMockBucket(0, 1000),
        createMockBucket(1, 2500),
        createMockBucket(2, 4200.5), // Last observation: $4,200.50
      ];

      const horizon = 24;
      const predictions = model.predict(history, horizon);

      expect(predictions).toHaveLength(24);
      for (const pred of predictions) {
        expect(pred.toDecimal()).toBe(4200.5);
        expect(pred.amountMinor).toBe(420050n);
      }
    });

    it("correctly propagates negative net flows", () => {
      const history = [
        createMockBucket(0, 5000),
        createMockBucket(1, -3500.25), // Outflow surplus: -$3,500.25
      ];

      const predictions = model.predict(history, 12);
      expect(predictions).toHaveLength(12);
      for (const pred of predictions) {
        expect(pred.toDecimal()).toBe(-3500.25);
        expect(pred.isNegative()).toBe(true);
      }
    });

    it("throws InsufficientHistoryError when history is empty", () => {
      expect(() => model.predict([], 24)).toThrow(InsufficientHistoryError);
    });

    it("throws InvalidForecastParameterError on non-positive or non-integer horizon", () => {
      const history = [createMockBucket(0, 1000)];
      expect(() => model.predict(history, 0)).toThrow(InvalidForecastParameterError);
      expect(() => model.predict(history, -5)).toThrow(InvalidForecastParameterError);
      expect(() => model.predict(history, 2.5)).toThrow(InvalidForecastParameterError);
    });
  });

  describe("Seasonal Naive Forecaster", () => {
    // Generate 168 hours of mock data with distinct identifiable values
    // hour i has net flow = (i + 1) * 10
    const weeklyHistory: HourlyBucket[] = Array.from({ length: 168 }, (_, i) =>
      createMockBucket(i, (i + 1) * 10)
    );

    it("strictly predicts values from the exact same hour in the previous cycle (168h lag)", () => {
      const model = new SeasonalNaiveForecaster({ seasonalLag: 168 });
      const horizon = 24;

      const predictions = model.predict(weeklyHistory, horizon);
      expect(predictions).toHaveLength(24);

      // According to y_{t+h} = y_{t+h-168}:
      // For h = 1: index = 168 - 168 + 0 = 0 (hour 0 of history -> $10.00)
      // For h = 2: index = 168 - 168 + 1 = 1 (hour 1 of history -> $20.00)
      // ...
      // For h = 24: index = 23 (hour 23 of history -> $240.00)
      for (let h = 1; h <= 24; h++) {
        const expectedValue = h * 10;
        expect(predictions[h - 1].toDecimal()).toBe(expectedValue);
        expect(predictions[h - 1].equals(weeklyHistory[h - 1].netFlow)).toBe(true);
      }
    });

    it("repeats seasonal cycles periodically for horizons greater than seasonal lag (H > 168)", () => {
      const model = new SeasonalNaiveForecaster({ seasonalLag: 168 });
      const horizon = 200; // Greater than 168

      const predictions = model.predict(weeklyHistory, horizon);
      expect(predictions).toHaveLength(200);

      // Predictions 1..168 match hours 0..167
      expect(predictions[0].toDecimal()).toBe(10);
      expect(predictions[167].toDecimal()).toBe(1680);

      // Step 169 (h = 169) wraps around to step 1 (hour 0 of history -> $10.00)
      expect(predictions[168].toDecimal()).toBe(10);
      // Step 200 wraps to step 32 (hour 31 of history -> $320.00)
      expect(predictions[199].toDecimal()).toBe(320);
    });

    it("throws InsufficientHistoryError when history is shorter than seasonalLag by default", () => {
      const model = new SeasonalNaiveForecaster({ seasonalLag: 168 });
      const shortHistory = weeklyHistory.slice(0, 100); // 100 < 168

      expect(() => model.predict(shortHistory, 24)).toThrow(InsufficientHistoryError);
      expect(() => model.predict(shortHistory, 24)).toThrow(/168 hours of history/);
    });

    it("falls back gracefully to flat naive when fallbackToNaive is enabled", () => {
      const model = new SeasonalNaiveForecaster({
        seasonalLag: 168,
        fallbackToNaive: true,
      });

      const shortHistory = [
        createMockBucket(0, 500),
        createMockBucket(1, 999), // Last observation: $999.00
      ];

      const predictions = model.predict(shortHistory, 6);
      expect(predictions).toHaveLength(6);
      for (const pred of predictions) {
        expect(pred.toDecimal()).toBe(999);
      }
    });

    it("supports custom seasonal lag periods (e.g. daily seasonality = 24h)", () => {
      const model = new SeasonalNaiveForecaster({ seasonalLag: 24 });
      const dailyHistory = weeklyHistory.slice(0, 48); // 2 days

      const predictions = model.predict(dailyHistory, 12);
      expect(predictions).toHaveLength(12);

      // Last 24 hours start at index 24 (48 - 24 = 24)
      for (let h = 1; h <= 12; h++) {
        expect(predictions[h - 1].equals(dailyHistory[24 + h - 1].netFlow)).toBe(true);
      }
    });
  });

  describe("Backtest Harness (evaluateForecaster)", () => {
    // Build a 240-hour continuous series
    const series: HourlyBucket[] = Array.from({ length: 240 }, (_, i) => {
      // Deterministic synthetic curve: baseline + daily cycle
      const cycle = Math.sin((i % 24) * (Math.PI / 12)) * 1000;
      return createMockBucket(i, 2000 + cycle);
    });

    // Create rolling windows: 168h lookback, 24h horizon, step = 12h
    // Total window = 192h. Slack = 240 - 192 = 48h.
    // Offsets: 0, 12, 24, 36, 48 -> 5 windows
    const windows = createRollingWindows(series, 168, 24, 12);

    it("correctly iterates through all rolling windows and pairs predictions with ground truth", () => {
      const forecaster = new NaiveForecaster();
      const result = evaluateForecaster(forecaster, windows);

      expect(result.forecasterName).toBe(forecaster.name);
      expect(result.windowCount).toBe(5);
      expect(result.horizonHours).toBe(24);
      expect(result.windows).toHaveLength(5);

      for (let w = 0; w < result.windows.length; w++) {
        const evaluated = result.windows[w];
        expect(evaluated.windowIndex).toBe(windows[w].index);
        expect(evaluated.asOf.getTime()).toBe(windows[w].asOf.getTime());

        // Length invariants
        expect(evaluated.target).toHaveLength(24);
        expect(evaluated.predictions).toHaveLength(24);
        expect(evaluated.actuals).toHaveLength(24);
        expect(evaluated.residuals).toHaveLength(24);

        // Ground-truth actuals strictly match window targets
        for (let h = 0; h < 24; h++) {
          expect(evaluated.actuals[h].equals(windows[w].target[h].netFlow)).toBe(true);

          // Residual invariant: residual = actual - prediction
          const expectedResidual = evaluated.actuals[h].subtract(evaluated.predictions[h]);
          expect(evaluated.residuals[h].equals(expectedResidual)).toBe(true);
        }

        // For NaiveForecaster, predictions are flat equal to last observation of history
        const expectedFlatValue = windows[w].history[167].netFlow;
        for (const pred of evaluated.predictions) {
          expect(pred.equals(expectedFlatValue)).toBe(true);
        }
      }
    });

    it("evaluates Seasonal Naive across rolling windows accurately", () => {
      const seasonalModel = new SeasonalNaiveForecaster({ seasonalLag: 168 });
      const result = evaluateForecaster(seasonalModel, windows);

      expect(result.windowCount).toBe(5);

      for (const evaluated of result.windows) {
        expect(evaluated.predictions).toHaveLength(24);
        expect(evaluated.residuals).toHaveLength(24);

        for (let h = 0; h < 24; h++) {
          // Seasonal naive prediction matches hour (168 - 168 + h) = h of window history
          const expectedPred = windows[evaluated.windowIndex].history[h].netFlow;
          expect(evaluated.predictions[h].equals(expectedPred)).toBe(true);
        }
      }
    });

    it("returns clean empty evaluation result for empty windows array", () => {
      const forecaster = new NaiveForecaster();
      const result = evaluateForecaster(forecaster, []);

      expect(result.windowCount).toBe(0);
      expect(result.horizonHours).toBe(0);
      expect(result.windows).toEqual([]);
    });
  });
});
