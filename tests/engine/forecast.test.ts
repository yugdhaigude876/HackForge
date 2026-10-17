import { describe, it, expect } from "vitest";
import {
  NaiveForecaster,
  SeasonalNaiveForecaster,
  HourOfWeekSmoothingForecaster,
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

      expect(predictions[0].toDecimal()).toBe(10);
      expect(predictions[167].toDecimal()).toBe(1680);
      expect(predictions[168].toDecimal()).toBe(10);
      expect(predictions[199].toDecimal()).toBe(320);
    });

    it("throws InsufficientHistoryError when history is shorter than seasonalLag by default", () => {
      const model = new SeasonalNaiveForecaster({ seasonalLag: 168 });
      const shortHistory = weeklyHistory.slice(0, 100);

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
        createMockBucket(1, 999),
      ];

      const predictions = model.predict(shortHistory, 6);
      expect(predictions).toHaveLength(6);
      for (const pred of predictions) {
        expect(pred.toDecimal()).toBe(999);
      }
    });

    it("supports custom seasonal lag periods (e.g. daily seasonality = 24h)", () => {
      const model = new SeasonalNaiveForecaster({ seasonalLag: 24 });
      const dailyHistory = weeklyHistory.slice(0, 48);

      const predictions = model.predict(dailyHistory, 12);
      expect(predictions).toHaveLength(12);

      for (let h = 1; h <= 12; h++) {
        expect(predictions[h - 1].equals(dailyHistory[24 + h - 1].netFlow)).toBe(true);
      }
    });
  });

  describe("Hour-of-Week Smoothing Forecaster", () => {
    it("correctly maps timestamps to hour-of-week indices (0 to 167)", () => {
      // Sunday 00:00 UTC -> slot 0
      const sun00 = new Date("2026-10-18T00:00:00.000Z"); // Sunday
      expect(HourOfWeekSmoothingForecaster.getHourOfWeekIndex(sun00)).toBe(0);

      // Sunday 23:00 UTC -> slot 23
      const sun23 = new Date("2026-10-18T23:00:00.000Z");
      expect(HourOfWeekSmoothingForecaster.getHourOfWeekIndex(sun23)).toBe(23);

      // Monday 09:00 UTC -> slot 1 * 24 + 9 = 33
      const mon09 = new Date("2026-10-19T09:00:00.000Z");
      expect(HourOfWeekSmoothingForecaster.getHourOfWeekIndex(mon09)).toBe(33);

      // Saturday 23:00 UTC -> slot 6 * 24 + 23 = 167
      const sat23 = new Date("2026-10-24T23:00:00.000Z");
      expect(HourOfWeekSmoothingForecaster.getHourOfWeekIndex(sat23)).toBe(167);
    });

    it("applies arithmetic mean across multiple weeks for each hour-of-week slot in mean mode", () => {
      const model = new HourOfWeekSmoothingForecaster({ mode: "mean" });

      // Generate 2 full weeks of data (336 hours) starting Sunday 00:00 UTC
      // 2026-10-18 is Sunday 00:00:00.000Z
      const startMs = new Date("2026-10-18T00:00:00.000Z").getTime();
      const twoWeeksHistory: HourlyBucket[] = [];

      for (let i = 0; i < 336; i++) {
        const hourStart = new Date(startMs + i * ONE_HOUR_MS);
        // Week 1 has value 1000, Week 2 has value 3000 -> mean should be 2000
        const isWeek1 = i < 168;
        const val = isWeek1 ? 1000 : 3000;
        const netFlow = Money.fromDecimal(val.toFixed(2));
        twoWeeksHistory.push({
          bucketId: hourStart.toISOString(),
          hourStart,
          inbound: netFlow,
          outbound: Money.zero(),
          netFlow,
          grossVolume: netFlow,
          transactionCount: 2,
        });
      }

      const predictions = model.predict(twoWeeksHistory, 24);
      expect(predictions).toHaveLength(24);

      // Mean of 1000 and 3000 is 2000
      for (const pred of predictions) {
        expect(pred.toDecimal()).toBe(2000);
      }
    });

    it("applies EWMA smoothing giving more weight to recent observations in ewma mode", () => {
      // lambda = 0.5: s_k = 0.5 * new + 0.5 * old
      // Week 1: 1000
      // Week 2: 3000 -> updated: 0.5 * 3000 + 0.5 * 1000 = 2000
      // Week 3: 4000 -> updated: 0.5 * 4000 + 0.5 * 2000 = 3000
      const model = new HourOfWeekSmoothingForecaster({ mode: "ewma", lambda: 0.5 });

      const startMs = new Date("2026-10-18T00:00:00.000Z").getTime();
      const threeWeeksHistory: HourlyBucket[] = [];

      for (let i = 0; i < 504; i++) {
        const hourStart = new Date(startMs + i * ONE_HOUR_MS);
        const week = Math.floor(i / 168);
        const val = week === 0 ? 1000 : week === 1 ? 3000 : 4000;
        const netFlow = Money.fromDecimal(val.toFixed(2));
        threeWeeksHistory.push({
          bucketId: hourStart.toISOString(),
          hourStart,
          inbound: netFlow,
          outbound: Money.zero(),
          netFlow,
          grossVolume: netFlow,
          transactionCount: 2,
        });
      }

      const predictions = model.predict(threeWeeksHistory, 24);
      expect(predictions).toHaveLength(24);

      // With lambda 0.5, expected EWMA profile is 3000
      for (const pred of predictions) {
        expect(pred.toDecimal()).toBe(3000);
      }
    });

    it("falls back to global mean or fallbackValue for unobserved hour-of-week slots", () => {
      const fallback = Money.fromDecimal("777.00");
      const model = new HourOfWeekSmoothingForecaster({ fallbackValue: fallback });

      // Only 3 hours of history
      const history = [
        createMockBucket(0, 500),
        createMockBucket(1, 600),
        createMockBucket(2, 700),
      ];

      // Predict 48 hours ahead (most slots will be unobserved)
      const predictions = model.predict(history, 48);
      expect(predictions).toHaveLength(48);

      // Later steps that weren't seen in the 3-hour history fall back to 777.00
      expect(predictions[10].toDecimal()).toBe(777);
    });
  });

  describe("Backtest Harness Integration with Metrics", () => {
    // Build a 240-hour continuous series with realistic diurnal cycle
    const series: HourlyBucket[] = Array.from({ length: 240 }, (_, i) => {
      const cycle = Math.sin((i % 24) * (Math.PI / 12)) * 1000;
      return createMockBucket(i, 2000 + cycle);
    });

    // Create rolling windows: 168h lookback, 24h horizon, step = 12h -> 5 windows
    const windows = createRollingWindows(series, 168, 24, 12);

    it("automatically computes aggregate MAE, MASE, and Pinball loss metrics", () => {
      const forecaster = new NaiveForecaster();
      const result = evaluateForecaster(forecaster, windows);

      expect(result.metrics).toBeDefined();
      expect(result.metrics.maeMinor).toBeGreaterThan(0);
      expect(result.metrics.maeDollars).toBeGreaterThan(0);
      expect(result.metrics.maeDollars).toBeCloseTo(result.metrics.maeMinor / 100, 4);

      // MASE is computed and non-negative
      expect(result.metrics.mase).toBeGreaterThan(0);

      // Pinball loss at 95% and 99%
      expect(result.metrics.pinballLoss95).toBeGreaterThan(0);
      expect(result.metrics.pinballLoss99).toBeGreaterThan(0);
    });

    it("demonstrates that seasonal/smoothing models achieve lower MASE on cyclical data than flat naive", () => {
      const naive = new NaiveForecaster();
      const seasonalNaive = new SeasonalNaiveForecaster({ seasonalLag: 168 });
      const smoothing = new HourOfWeekSmoothingForecaster({ mode: "ewma", lambda: 0.4 });

      const naiveResult = evaluateForecaster(naive, windows);
      const seasonalResult = evaluateForecaster(seasonalNaive, windows);
      const smoothingResult = evaluateForecaster(smoothing, windows);

      // On a cyclical daily curve, seasonal models capture the recurring pattern much better than flat naive
      expect(seasonalResult.metrics.maeDollars).toBeLessThan(naiveResult.metrics.maeDollars);
      expect(smoothingResult.metrics.maeDollars).toBeLessThan(naiveResult.metrics.maeDollars);

      // Seasonal model MASE should be close to 0 on smooth identical weekly cycles
      expect(seasonalResult.metrics.mase).toBeLessThan(naiveResult.metrics.mase);
    });
  });
});
