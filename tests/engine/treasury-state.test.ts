import { describe, it, expect } from "vitest";
import { Money } from "@/engine/money";
import { loadTreasuryDataset } from "@/engine/dataset";
import { runTimelineSimulation, type TimelinePolicy } from "@/engine/simulator";
import {
  DEFAULT_ALLOCATION_WEIGHTS,
  applyStressShocks,
  TREASURY_STATE_SCHEMA_VERSION,
  createTreasuryState,
  deserializeTreasuryState,
  serializeTreasuryState,
  stepTreasury,
  type StepContext,
  type TimelineFrame,
} from "@/engine/treasury-step";
import { sha256Of } from "../helpers/canonical";

const records = loadTreasuryDataset();

function ctxFor(policy: TimelinePolicy): StepContext {
  return {
    policy,
    operationalFloor: Money.fromDecimal(5_000_000, "USD"),
    horizonHours: 24,
    alpha: 0.01,
    weights: DEFAULT_ALLOCATION_WEIGHTS,
  };
}

describe("TreasuryState serialisation", () => {
  it("streaming with a JSON round trip every hour equals the batch run", () => {
    for (const policy of ["reserve-juggler", "hold-all-cash", "fixed-buffer"] as TimelinePolicy[]) {
      const hours = 200;
      const batch = runTimelineSimulation({ policy, maxHours: hours });

      let stored = JSON.stringify(serializeTreasuryState(createTreasuryState(Money.fromDecimal(50_000_000, "USD"))));
      const frames: TimelineFrame[] = [];
      for (let h = 0; h < hours; h++) {
        const state = deserializeTreasuryState(JSON.parse(stored));
        const { frame } = stepTreasury(state, applyStressShocks(records[h]), h, ctxFor(policy));
        frames.push(frame);
        stored = JSON.stringify(serializeTreasuryState(state));
      }

      expect(sha256Of(frames)).toBe(sha256Of(batch.frames));
    }
  });

  it("serialised state is plain JSON and stays under 200 KB after 720 hours", () => {
    const state = createTreasuryState(Money.fromDecimal(50_000_000, "USD"));
    for (let h = 0; h < 720; h++) stepTreasury(state, applyStressShocks(records[h]), h, ctxFor("reserve-juggler"));
    const json = JSON.stringify(serializeTreasuryState(state));
    expect(json.length).toBeLessThan(200_000);
    expect(JSON.parse(json).schemaVersion).toBe(TREASURY_STATE_SCHEMA_VERSION);
  });

  it("round-trips balances above 2^53 minor units exactly", () => {
    const huge = Money.fromMinor(10n ** 20n + 12345n, "USD");
    const state = createTreasuryState(huge);
    state.portfolio.tier1RepoPrincipal = Money.fromMinor(9_007_199_254_740_993n, "USD");
    state.maxOverdraftDrawn = Money.fromMinor(10n ** 19n + 7n, "USD");

    const back = deserializeTreasuryState(JSON.parse(JSON.stringify(serializeTreasuryState(state))));
    expect(back.portfolio.tier0Cash.amountMinor).toBe(10n ** 20n + 12345n);
    expect(back.portfolio.tier1RepoPrincipal.amountMinor).toBe(9_007_199_254_740_993n);
    expect(back.maxOverdraftDrawn.amountMinor).toBe(10n ** 19n + 7n);
  });

  it("rejects an unsupported schema version", () => {
    const raw = serializeTreasuryState(createTreasuryState(Money.fromDecimal(1, "USD")));
    expect(() => deserializeTreasuryState({ ...raw, schemaVersion: 99 })).toThrow(/schemaVersion/);
  });
});
