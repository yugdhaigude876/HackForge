import { describe, it, expect, beforeEach } from "vitest";
import {
  MemoryClockStore,
  advanceClock,
  controlClock,
  setClockStore,
} from "@/server/clock-service";

// Uses the real dataset length (8,760 rows): no mocking.
const ORG = "org_accuracy";
const T0 = 1_700_000_000_000;

describe("live tick accuracy (out of sample, vs seasonal naive)", () => {
  let store: MemoryClockStore;
  beforeEach(() => {
    store = new MemoryClockStore();
    setClockStore(store);
  });

  it("is null with a reason during warm-up, then reports MASE and skill after enough scored hours", async () => {
    await controlClock({ orgId: ORG, uid: "a", role: "analyst", action: "start", nowMs: T0 });
    let applied = 0;
    while (applied < 240) {
      const r = await advanceClock({ orgId: ORG, uid: "a", steps: 24, expectedHourIndex: applied, nowMs: T0 + applied });
      applied += r.applied;
    }
    const stream = store.streams.get(ORG)!;

    const warm = stream.get(10)!;
    expect(warm.accuracy.mase).toBeNull();
    expect(warm.accuracy.reason).toMatch(/Needs/);

    const later = stream.get(239)!;
    expect(later.accuracy.sampleSize).toBeGreaterThanOrEqual(24);
    expect(later.accuracy.mase).not.toBeNull();
    expect(later.accuracy.mase!).toBeGreaterThan(0);
    // skill is exactly 1 - MASE: positive means the model beat the seasonal-naive baseline
    expect(later.accuracy.skillVsSeasonalNaive).toBeCloseTo(1 - later.accuracy.mase!, 10);
    expect(later.accuracy.method).toMatch(/out of sample/);
    expect(later.forecast.points).toHaveLength(24);
    expect(later.forecast.points[0].bandLowerMinor).toBeDefined();
  }, 60_000);
});
