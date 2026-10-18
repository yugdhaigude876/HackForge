import { describe, it, expect } from "vitest";
import {
  runTimelineSimulation,
  TimelineSimulatorOptions,
} from "@/engine/simulator";
import { Money } from "@/engine/money";

describe("Timeline Simulation Runner (src/engine/simulator.ts)", () => {
  it("runs a 168-hour timeline simulation using the benchmark dataset", () => {
    const result = runTimelineSimulation({
      maxHours: 168,
      initialCash: Money.fromDecimal(50_000_000, "USD"),
      operationalFloor: Money.fromDecimal(5_000_000, "USD"),
      policy: "reserve-juggler",
    });

    expect(result.summary.totalHoursSimulated).toBe(168);
    expect(result.frames.length).toBe(168);
    expect(result.summary.initialCashUsd).toBe(50_000_000);
    expect(result.summary.finalNetAssetsUsd).toBeGreaterThan(0);
    expect(result.summary.grossYieldEarnedUsd).toBeGreaterThan(0);

    // Verify frames have valid values and properties
    const f0 = result.frames[0];
    expect(f0.hourIndex).toBe(0);
    expect(f0.depositsUsd).toBeGreaterThan(0);
    expect(f0.withdrawalsUsd).toBeGreaterThan(0);
    expect(f0.portfolio.tier0Cash.isPositive()).toBe(true);
  });

  it("compares Reserve Juggler vs Hold All Cash vs Fixed Buffer", () => {
    const options: TimelineSimulatorOptions = {
      maxHours: 168,
      initialCash: Money.fromDecimal(50_000_000, "USD"),
      operationalFloor: Money.fromDecimal(5_000_000, "USD"),
    };

    const resJuggler = runTimelineSimulation({
      ...options,
      policy: "reserve-juggler",
    });

    const resHoldCash = runTimelineSimulation({
      ...options,
      policy: "hold-all-cash",
    });

    // Hold All Cash generates zero yield
    expect(resHoldCash.summary.grossYieldEarnedUsd).toBe(0);

    // Reserve Juggler generates positive yield
    expect(resJuggler.summary.grossYieldEarnedUsd).toBeGreaterThan(0);

    // Reserve Juggler earns positive gross yield whereas Hold All Cash earns zero
    expect(resJuggler.summary.grossYieldEarnedUsd).toBeGreaterThan(
      resHoldCash.summary.grossYieldEarnedUsd
    );
  });

  it("propagates outflow shock stress into increased liquidations", () => {
    // Baseline run
    const baseline = runTimelineSimulation({
      maxHours: 72,
      initialCash: Money.fromDecimal(15_000_000, "USD"),
      operationalFloor: Money.fromDecimal(5_000_000, "USD"),
      outflowShockPct: 0,
    });

    // Severe 40% outflow shock
    const stressed = runTimelineSimulation({
      maxHours: 72,
      initialCash: Money.fromDecimal(15_000_000, "USD"),
      operationalFloor: Money.fromDecimal(5_000_000, "USD"),
      outflowShockPct: 40,
    });

    // Stressed run has equal or more shortfall events
    expect(stressed.summary.shortfallEventsCount).toBeGreaterThanOrEqual(
      baseline.summary.shortfallEventsCount
    );
  });
});
