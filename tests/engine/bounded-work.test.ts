import { describe, it, expect } from "vitest";
import { compareScenarioAcrossPolicies } from "@/engine/simulate";
import { generateTransactions } from "@/engine/generator";
import { buildContinuousTimeSeries } from "@/engine/timeseries";
import { Money } from "@/engine/money";
import { Instrument } from "@/engine/models";

describe("Bounded Work and Execution Timing Measurements", () => {
  it("measures worst-case simulation work (3 policies x 1000 trials x 24h horizon)", () => {
    // 1. Generate 1 week baseline history
    const endDate = new Date("2026-03-01T00:00:00.000Z");
    const startDate = new Date(endDate.getTime() - 168 * 3600 * 1000);

    const txs = generateTransactions({
      seed: "timing-seed-1",
      startDate,
      endDate,
      baseVolumePerHour: Money.fromMinor(20_000_000_00n, "USD"),
    });

    const history = buildContinuousTimeSeries(txs, {
      startDate,
      endDate,
      currency: "USD",
    });

    const instruments: Instrument[] = [
      {
        id: "inst_t_bills",
        name: "Treasury Bills",
        apy: 0.045,
        capacity: Money.fromMinor(50_000_000_00n, "USD"),
        withdrawalPenalty: 0.001,
        settlementLagHours: 1,
      },
      {
        id: "inst_fed_repo",
        name: "Overnight Repo",
        apy: 0.052,
        capacity: Money.fromMinor(25_000_000_00n, "USD"),
        withdrawalPenalty: 0.0005,
        settlementLagHours: 0,
      },
    ];

    const startingCash = Money.fromMinor(50_000_000_00n, "USD");
    const operationalFloor = Money.fromMinor(10_000_000_00n, "USD");

    const scenario = {
      outflowShockPct: 25,
      settlementDelayHours: 12,
      shockStartHour: 0,
      shockDurationHours: 24,
      confidence: 0.99,
      yieldRateShockBps: 150,
      instrumentOutageIds: [],
    };

    // 2. Measure execution time under hard cap workload: 3 policies x 1,000 trials = 3,000 policy-runs
    const startTime = performance.now();
    const result = compareScenarioAcrossPolicies({
      seed: "bench-test-seed",
      history,
      startingCash,
      instruments,
      scenario,
      policies: ["reserve-juggler", "hold-all-cash", "fixed-buffer"],
      horizonHours: 24,
      trials: 1000,
      operationalFloor,
      emergencyBorrowingRateBps: 1000,
    });
    const durationMs = performance.now() - startTime;

    console.info(
      `[Bounded Work Measurement] 3 policies x 1000 trials x 24h = ${durationMs.toFixed(2)}ms (engine reported: ${result.executionDurationMs}ms)`
    );

    expect(result.policies).toHaveLength(3);
    expect(result.trials).toBe(1000);
    // Even on slower hardware, 3000 trials finishes well under 5 seconds (Vercel maxDuration is 60s)
    expect(durationMs).toBeLessThan(10000);
  });
});
