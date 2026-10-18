import { describe, it, expect, beforeAll } from "vitest";
import type { StreamTick } from "@/engine/live-tick";
import { MemoryClockStore, advanceClock, controlClock, setClockStore } from "@/server/clock-service";
import {
  classifyEvent,
  tickToForecastAnalytics,
  tickToFrame,
  ticksToActuals,
  ticksToDashboardPayload,
  ticksToForecastChart,
  ticksToNotifications,
  ticksToReplayResult,
} from "@/lib/live/adapters";

const ORG = "org_adapters";
const T0 = 1_700_000_000_000;

/** Real ticks from the real dataset, produced by the real clock service (in-memory store). */
async function streamTicks(hours: number): Promise<StreamTick[]> {
  const store = new MemoryClockStore();
  setClockStore(store);
  await controlClock({ orgId: ORG, uid: "a", role: "analyst", action: "start", nowMs: T0 });
  let applied = 0;
  while (applied < hours) {
    const r = await advanceClock({ orgId: ORG, uid: "a", steps: Math.min(24, hours - applied), expectedHourIndex: applied, nowMs: T0 + applied });
    applied += r.applied;
  }
  const map = store.streams.get(ORG)!;
  return [...map.keys()].sort((a, b) => a - b).map((h) => map.get(h)!);
}

let warm: StreamTick[];
let full: StreamTick[];

beforeAll(async () => {
  warm = await streamTicks(30);
  full = await streamTicks(240);
}, 60_000);

describe("classifyEvent", () => {
  it("maps engine event messages to audit types", () => {
    expect(classifyEvent("Surplus swept at 17:00 UTC: Repo=$1")).toBe("SWEEP");
    expect(classifyEvent("Overnight Repo matured at 08:00 UTC: released")).toBe("MATURITY");
    expect(classifyEvent("Liquidation Cascade triggered to cover $1")).toBe("LIQUIDATION");
    expect(classifyEvent("Emergency Overdraft Drawn: $1 at 12% APR penalty")).toBe("OVERDRAFT");
    expect(classifyEvent("anything else")).toBe("INFO");
  });
});

describe("ticksToReplayResult", () => {
  it("returns null for no ticks", () => {
    expect(ticksToReplayResult([])).toBeNull();
  });

  it("builds replay-shaped frames keyed by dataset hour, with bigint money", () => {
    const result = ticksToReplayResult(warm)!;
    expect(result.frames).toHaveLength(30);
    expect(result.frames[0].hour).toBe(0);
    expect(result.frames[29].hour).toBe(29);
    const f = result.frames[10];
    expect(typeof f.portfolio.tier0Cash.amountMinor).toBe("bigint");
    expect(f.requiredReserveMinor).toBe(BigInt(warm[10].reserveMinor));
    expect(f.timestamp).toBe(warm[10].timestamp);
  });

  it("summary only contains values derived from the window", () => {
    const r = ticksToReplayResult(warm)!;
    expect(r.summary.totalHoursSimulated).toBe(30);
    expect(r.summary.startTimestamp).toBe(warm[0].timestamp);
    expect(r.summary.endTimestamp).toBe(warm[29].timestamp);
    expect(r.summary.finalNetAssetsUsd).toBe(Number(BigInt(warm[29].portfolio.totalAssetsMinor)) / 100);
  });

  it("audit logs are the tick events with classified types", () => {
    const r = ticksToReplayResult(full)!;
    const eventCount = full.reduce((n, t) => n + t.events.length, 0);
    expect(r.auditLogs).toHaveLength(eventCount);
    for (const log of r.auditLogs) expect(["SWEEP", "MATURITY", "LIQUIDATION", "OVERDRAFT", "INFO"]).toContain(log.type);
  });

  it("tickToFrame keeps liquidations as Money orders", () => {
    const withLiq = full.find((t) => t.liquidations.length > 0);
    if (withLiq) {
      const frame = tickToFrame(withLiq);
      expect(frame.liquidations[0].grossLiquidated.amountMinor).toBe(BigInt(withLiq.liquidations[0].grossMinor));
    }
  });
});

describe("ticksToNotifications", () => {
  it("is newest first, capped, and includes only real events and status changes", () => {
    const list = ticksToNotifications(full, 10);
    expect(list.length).toBeLessThanOrEqual(10);
    for (let i = 1; i < list.length; i++) expect(list[i - 1].hourIndex).toBeGreaterThanOrEqual(list[i].hourIndex);
    for (const n of list) {
      if (n.type === "STATUS") expect(n.message).toMatch(/Solvency status changed from \w+ to \w+/);
      else expect(full.some((t) => t.events.includes(n.message))).toBe(true);
    }
  });

  it("emits a status-change entry exactly when the status differs from the previous hour", () => {
    const changes = full.filter((t, i) => i > 0 && full[i - 1].status !== t.status).length;
    const statusNotes = ticksToNotifications(full, 10_000).filter((n) => n.type === "STATUS");
    expect(statusNotes).toHaveLength(changes);
  });
});

describe("ticksToDashboardPayload", () => {
  it("returns null without ticks", () => {
    expect(ticksToDashboardPayload([], "org", "viewer")).toBeNull();
  });

  it("labels the data as dataset and keeps money as integer strings", () => {
    const p = ticksToDashboardPayload(full, "org_x", "analyst")!;
    expect(p.decision?.source).toBe("dataset");
    expect(p.forecast?.source).toBe("dataset");
    expect(p.userRole).toBe("analyst");
    const latest = full[full.length - 1];
    expect(p.decision?.reserveMinor).toBe(latest.reserveMinor);
    expect(p.decision?.availableCashMinor).toBe(latest.availableCashMinor);
    for (const a of p.decision!.allocations) expect(a.amountMinor).toMatch(/^-?\d+$/);
    expect(p.actuals).toHaveLength(24);
  });

  it("does not invent accuracy: backtest is null during warm-up", () => {
    const p = ticksToDashboardPayload(warm, "org", "viewer")!;
    expect(p.decision?.backtest).toBeNull();
    expect(p.forecast?.backtest.mase).toBeNull();
  });

  it("reports measured MASE once enough hours are scored", () => {
    const p = ticksToDashboardPayload(full, "org", "viewer")!;
    expect(p.decision?.backtest?.mase).toBe(full[full.length - 1].accuracy.mase);
    expect(p.forecast?.backtest.sampleSize).toBe(full[full.length - 1].accuracy.sampleSize);
  });
});

describe("forecast adapters", () => {
  it("has no evaluation, with a reason, during warm-up", () => {
    const a = tickToForecastAnalytics(warm[warm.length - 1]);
    expect(a.evaluation).toBeNull();
    expect(a.reason).toMatch(/Needs/);
  });

  it("derives skill versus seasonal naive exactly from MASE", () => {
    const tick = full[full.length - 1];
    const a = tickToForecastAnalytics(tick);
    expect(a.evaluation).not.toBeNull();
    const e = a.evaluation!;
    expect(e.model.mase).toBe(tick.accuracy.mase);
    expect(e.skillScores.vsSeasonalNaive.mase.skill).toBeCloseTo(1 - tick.accuracy.mase!, 10);
    expect(e.skillScores.vsSeasonalNaive.mase.isBetter).toBe(tick.accuracy.mase! < 1);
    // Things the stream does not measure are null with a reason, never estimated
    expect(e.naive.mase).toBeNull();
    expect(e.naive.reason).toMatch(/not scored/i);
    expect(e.model.pinballLoss).toBeNull();
  });

  it("chart is the last 24 actual hours followed by the 24 h forecast", () => {
    const chart = ticksToForecastChart(full);
    expect(chart).toHaveLength(48);
    expect(chart.slice(0, 24).every((p) => p.actual !== null && p.mean === null)).toBe(true);
    expect(chart.slice(24).every((p) => p.mean !== null && p.actual === null)).toBe(true);
    expect(ticksToActuals(full, 24)).toHaveLength(24);
  });

  it("band brackets the mean when present", () => {
    const chart = ticksToForecastChart(full).slice(24);
    for (const p of chart) {
      if (p.bandLower !== null && p.bandUpper !== null) {
        expect(p.bandLower).toBeLessThanOrEqual(p.mean!);
        expect(p.bandUpper).toBeGreaterThanOrEqual(p.mean!);
      }
    }
  });
});
