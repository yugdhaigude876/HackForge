import { describe, it, expect, beforeEach, vi } from "vitest";
import { Money } from "@/engine/money";
import { runTimelineSimulation } from "@/engine/simulator";

// Shrink the dataset length so completion is reachable quickly; rows themselves are the real data.
vi.mock("@/server/dataset", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/dataset")>();
  return { ...actual, getDatasetLength: () => 30 };
});

import {
  MemoryClockStore,
  advanceClock,
  controlClock,
  hoursDue,
  initialClock,
  readClock,
  setClockStore,
  LEASE_MS,
  type ClockStore,
  type ClockTx,
} from "@/server/clock-service";

const ORG = "org_clock";
const T0 = 1_700_000_000_000;

let store: MemoryClockStore;

async function start(uid = "analyst-1", now = T0) {
  return controlClock({ orgId: ORG, uid, role: "analyst", action: "start", nowMs: now });
}

async function expectClockError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ name: "ClockError", code });
}

beforeEach(() => {
  store = new MemoryClockStore();
  setClockStore(store);
});

describe("clock service: control", () => {
  it("starts stopped at hour 0 and returns the initial clock", async () => {
    const clock = await readClock(ORG, T0);
    expect(clock.status).toBe("stopped");
    expect(clock.appliedHours).toBe(0);
    expect(clock.datasetLength).toBe(30);
  });

  it("start acquires the lease and sets running", async () => {
    const { clock } = await start();
    expect(clock.status).toBe("running");
    expect(clock.lease).toEqual({ ownerUid: "analyst-1", untilMs: T0 + LEASE_MS });
    expect(clock.startedAtMs).toBe(T0);
  });

  it("another analyst cannot take over an active lease, but an admin can", async () => {
    await start("analyst-1");
    await expectClockError(start("analyst-2", T0 + 1000), "LEASE_HELD");
    const { clock } = await controlClock({ orgId: ORG, uid: "admin-1", role: "admin", action: "start", nowMs: T0 + 1000 });
    expect(clock.lease?.ownerUid).toBe("admin-1");
  });

  it("an expired lease can be taken over by any analyst", async () => {
    await start("analyst-1");
    const { clock } = await start("analyst-2", T0 + LEASE_MS + 1);
    expect(clock.lease?.ownerUid).toBe("analyst-2");
  });

  it("viewers cannot control the clock", async () => {
    await expectClockError(
      controlClock({ orgId: ORG, uid: "v", role: "viewer", action: "start", nowMs: T0 }),
      "FORBIDDEN"
    );
  });

  it("pause stops the clock and releases the lease; only the driver or an admin may pause a held lease", async () => {
    await start("analyst-1");
    await expectClockError(
      controlClock({ orgId: ORG, uid: "analyst-2", role: "analyst", action: "pause", nowMs: T0 + 1 }),
      "LEASE_HELD"
    );
    const { clock } = await controlClock({ orgId: ORG, uid: "analyst-1", role: "analyst", action: "pause", nowMs: T0 + 2 });
    expect(clock.status).toBe("stopped");
    expect(clock.lease).toBeNull();
  });

  it("setSpeed validates the range", async () => {
    const ok = await controlClock({ orgId: ORG, uid: "a", role: "analyst", action: "setSpeed", speedHoursPerMinute: 60, nowMs: T0 });
    expect(ok.clock.speedHoursPerMinute).toBe(60);
    for (const bad of [0, -5, 1441, 2.5, undefined]) {
      await expectClockError(
        controlClock({ orgId: ORG, uid: "a", role: "analyst", action: "setSpeed", speedHoursPerMinute: bad as number, nowMs: T0 }),
        "INVALID"
      );
    }
  });

  it("step applies exactly one hour while stopped, and is rejected while running", async () => {
    const stepped = await controlClock({ orgId: ORG, uid: "a", role: "analyst", action: "step", nowMs: T0 });
    expect(stepped.clock.appliedHours).toBe(1);
    expect(stepped.clock.status).toBe("stopped");
    expect(store.streams.get(ORG)?.size).toBe(1);

    await start("a", T0 + 10);
    await expectClockError(
      controlClock({ orgId: ORG, uid: "a", role: "analyst", action: "step", nowMs: T0 + 20 }),
      "INVALID"
    );
  });

  it("reset needs admin and confirm, and removes all streamed data", async () => {
    await start("a");
    await advanceClock({ orgId: ORG, uid: "a", steps: 3, nowMs: T0 + 1 });
    expect(store.streams.get(ORG)?.size).toBe(3);

    await expectClockError(
      controlClock({ orgId: ORG, uid: "a", role: "analyst", action: "reset", confirm: true, nowMs: T0 + 2 }),
      "FORBIDDEN"
    );
    await expectClockError(
      controlClock({ orgId: ORG, uid: "admin", role: "admin", action: "reset", nowMs: T0 + 2 }),
      "CONFIRM_REQUIRED"
    );
    const res = await controlClock({ orgId: ORG, uid: "admin", role: "admin", action: "reset", confirm: true, nowMs: T0 + 3 });
    expect(res.deletedStream).toBe(3);
    expect(res.clock.appliedHours).toBe(0);
    expect(res.clock.status).toBe("stopped");
    expect(store.streams.get(ORG)).toBeUndefined();
    expect(store.engines.get(ORG)).toBeUndefined();
  });
});

describe("clock service: advance", () => {
  it("is rejected while the clock is not running", async () => {
    await expectClockError(advanceClock({ orgId: ORG, uid: "a", nowMs: T0 }), "NOT_RUNNING");
  });

  it("requires the caller to hold the lease", async () => {
    await start("a");
    await expectClockError(advanceClock({ orgId: ORG, uid: "b", nowMs: T0 + 1 }), "LEASE_HELD");
    await expectClockError(advanceClock({ orgId: ORG, uid: "a", nowMs: T0 + LEASE_MS + 5 }), "LEASE_REQUIRED");
  });

  it("applies one hour: writes the stream tick, engine state and clock together, and renews the lease", async () => {
    await start("a");
    const res = await advanceClock({ orgId: ORG, uid: "a", nowMs: T0 + 5000 });
    expect(res.applied).toBe(1);
    expect(res.clock.appliedHours).toBe(1);
    expect(res.clock.lease?.untilMs).toBe(T0 + 5000 + LEASE_MS);
    expect(store.streams.get(ORG)?.get(0)?.hourIndex).toBe(0);
    expect(store.engines.get(ORG)?.appliedHours).toBe(1);
    expect(store.clocks.get(ORG)?.version).toBeGreaterThan(0);
  });

  it("validates the steps range", async () => {
    await start("a");
    for (const bad of [0, 25, -1, 1.5]) {
      await expectClockError(advanceClock({ orgId: ORG, uid: "a", steps: bad, nowMs: T0 + 1 }), "INVALID");
    }
  });

  it("returns STALE_INDEX and changes nothing when expectedHourIndex is old (idempotent replay)", async () => {
    await start("a");
    await advanceClock({ orgId: ORG, uid: "a", steps: 2, expectedHourIndex: 0, nowMs: T0 + 1 });
    const before = JSON.stringify([...store.streams.get(ORG)!.keys()]);
    await expectClockError(
      advanceClock({ orgId: ORG, uid: "a", steps: 2, expectedHourIndex: 0, nowMs: T0 + 2 }),
      "STALE_INDEX"
    );
    expect(JSON.stringify([...store.streams.get(ORG)!.keys()])).toBe(before);
    expect(store.clocks.get(ORG)?.appliedHours).toBe(2);
  });

  it("catches up several hours in one call, and completes at the end of the dataset", async () => {
    await start("a");
    const first = await advanceClock({ orgId: ORG, uid: "a", steps: 24, nowMs: T0 + 1 });
    expect(first.applied).toBe(24);
    const second = await advanceClock({ orgId: ORG, uid: "a", steps: 24, nowMs: T0 + 2 });
    expect(second.applied).toBe(6); // 30 total rows in this test
    expect(second.clock.status).toBe("completed");
    expect(second.clock.lease).toBeNull();
    await expectClockError(advanceClock({ orgId: ORG, uid: "a", nowMs: T0 + 3 }), "COMPLETED");
    await expectClockError(start("a", T0 + 4), "COMPLETED");
  });

  it("is atomic: a failure part-way through a multi-hour advance leaves nothing written", async () => {
    await start("a");
    let writes = 0;
    const failing: ClockStore = {
      runTransaction: <T,>(orgId: string, fn: (tx: ClockTx) => Promise<T>) =>
        store.runTransaction(orgId, (tx) =>
          fn({
            ...tx,
            getClock: () => tx.getClock(),
            getEngine: () => tx.getEngine(),
            setClock: (d) => tx.setClock(d),
            setEngine: (d) => tx.setEngine(d),
            setStream: (h, t) => {
              if (++writes === 3) throw new Error("simulated write failure");
              tx.setStream(h, t);
            },
          })
        ),
      resetOrg: (o) => store.resetOrg(o),
      listRunningOrgIds: (n) => store.listRunningOrgIds(n),
    };
    setClockStore(failing);
    await expect(advanceClock({ orgId: ORG, uid: "a", steps: 5, nowMs: T0 + 1 })).rejects.toThrow("simulated write failure");
    expect(store.streams.get(ORG)).toBeUndefined();
    expect(store.engines.get(ORG)).toBeUndefined();
    expect(store.clocks.get(ORG)?.appliedHours).toBe(0);
  });

  it("a streamed run matches the batch simulator hour by hour", async () => {
    await start("a");
    await advanceClock({ orgId: ORG, uid: "a", steps: 24, nowMs: T0 + 1 });
    await advanceClock({ orgId: ORG, uid: "a", steps: 6, nowMs: T0 + 2 });
    const batch = runTimelineSimulation({
      policy: "reserve-juggler",
      maxHours: 30,
      initialCash: Money.fromDecimal(50_000_000, "USD"),
      operationalFloor: Money.fromDecimal(5_000_000, "USD"),
    });
    const stream = store.streams.get(ORG)!;
    expect(stream.size).toBe(30);
    for (let h = 0; h < 30; h++) {
      const tick = stream.get(h)!;
      const frame = batch.frames[h];
      expect(tick.timestamp).toBe(frame.timestamp);
      expect(tick.status).toBe(frame.liquidityStatus);
      expect(tick.reserveMinor).toBe(frame.requiredReserveMinor);
      expect(tick.surplusMinor).toBe(frame.deployableSurplusMinor);
      expect(tick.portfolio.tier0CashMinor).toBe(frame.portfolio.tier0Cash.amountMinor.toString());
      expect(tick.portfolio.totalAssetsMinor).toBe(frame.portfolio.totalAssets.amountMinor.toString());
      expect(tick.events).toEqual(frame.events);
    }
  });

  it("ticks are labelled as dataset data and carry money as integer strings", async () => {
    await start("a");
    await advanceClock({ orgId: ORG, uid: "a", steps: 2, nowMs: T0 + 1 });
    const tick = store.streams.get(ORG)!.get(1)!;
    expect(tick.source).toBe("dataset");
    for (const v of [tick.reserveMinor, tick.surplusMinor, tick.availableCashMinor, tick.portfolio.totalAssetsMinor]) {
      expect(v).toMatch(/^-?\d+$/);
    }
  });

  it("cron mode advances without the client lease", async () => {
    await start("a", T0);
    await advanceClock({ orgId: ORG, uid: "system:cron", asCron: true, steps: 2, nowMs: T0 + LEASE_MS * 10 });
    expect(store.clocks.get(ORG)?.appliedHours).toBe(2);
  });
});

describe("clock service: hoursDue", () => {
  const running = { ...initialClock(T0), status: "running" as const, speedHoursPerMinute: 60, lastTickAtMs: T0 };
  it("is zero when not running", () => {
    expect(hoursDue({ ...running, status: "stopped" }, T0 + 60_000)).toBe(0);
  });
  it("scales with elapsed time and speed, floored", () => {
    expect(hoursDue(running, T0 + 20_000)).toBe(20);
    expect(hoursDue({ ...running, speedHoursPerMinute: 12 }, T0 + 5_000)).toBe(1);
    expect(hoursDue({ ...running, speedHoursPerMinute: 12 }, T0 + 4_000)).toBe(0);
  });
  it("is capped at 24 per call", () => {
    expect(hoursDue(running, T0 + 3_600_000)).toBe(24);
  });
});
