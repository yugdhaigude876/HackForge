import { describe, it, expect } from "vitest";
import {
  buildForecastBandSeries,
  type HistoryInputPoint,
  type ForecastInputPoint,
  type ResidualQuantilesConfig,
} from "@/components/finance/forecast-band-utils";

describe("Forecast Band Data Pure Function (buildForecastBandSeries)", () => {
  it("returns empty array when history and predictions are both empty", () => {
    const result = buildForecastBandSeries([], []);
    expect(result).toEqual([]);
  });

  it("handles history-only sequence with null forecast fields", () => {
    const history: HistoryInputPoint[] = [
      { hour: "00:00", net: 100_000 },
      { hour: "01:00", net: -50_000 },
    ];
    const result = buildForecastBandSeries(history, []);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      step: "00:00",
      actual: 100_000,
      mean: null,
      bandLower: null,
      bandUpper: null,
      bandRange: null,
    });
    expect(result[1].actual).toBe(-50_000);
  });

  it("calculates expanding uncertainty band for forecast horizon", () => {
    const predictions: ForecastInputPoint[] = [
      { hour: 1, mean: 500_000 },
      { hour: 2, mean: 600_000 },
      { hour: 3, mean: 400_000 },
      { hour: 4, mean: 550_000 },
    ];

    const metrics: ResidualQuantilesConfig = {
      mae: 50_000,
      mase: 0.85,
      worstCaseResidualShortfall: 200_000,
    };

    const result = buildForecastBandSeries([], predictions, metrics);

    expect(result).toHaveLength(4);

    // Each forecast point has valid numbers
    for (let i = 0; i < result.length; i++) {
      const pt = result[i];
      expect(pt.actual).toBeNull();
      expect(typeof pt.mean).toBe("number");
      expect(typeof pt.bandLower).toBe("number");
      expect(typeof pt.bandUpper).toBe("number");
      expect(pt.bandRange).not.toBeNull();
      if (pt.bandLower !== null && pt.bandUpper !== null) {
        expect(pt.bandLower).toBeLessThan(pt.bandUpper);
      }
    }

    // Cone expansion check: width at step 4 should be wider than step 1
    const widthStep1 = (result[0].bandUpper ?? 0) - (result[0].bandLower ?? 0);
    const widthStep4 = (result[3].bandUpper ?? 0) - (result[3].bandLower ?? 0);
    expect(widthStep4).toBeGreaterThan(widthStep1);
  });

  it("combines history and predictions with continuous ordering", () => {
    const history: HistoryInputPoint[] = [
      { hour: 0, net: 1_000_000 },
      { hour: 1, net: 2_000_000 },
    ];
    const predictions: ForecastInputPoint[] = [
      { hour: 2, mean: 1_500_000 },
      { hour: 3, mean: 1_800_000 },
    ];

    const result = buildForecastBandSeries(history, predictions);

    expect(result).toHaveLength(4);
    // History points
    expect(result[0].actual).toBe(1_000_000);
    expect(result[0].mean).toBeNull();
    expect(result[1].actual).toBe(2_000_000);
    expect(result[1].mean).toBeNull();

    // Prediction points
    expect(result[2].actual).toBeNull();
    expect(result[2].mean).toBe(1_500_000);
    expect(result[3].actual).toBeNull();
    expect(result[3].mean).toBe(1_800_000);
  });
});
