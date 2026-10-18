import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { runTimelineSimulation, type TimelinePolicy } from "@/engine/simulator";
import { sha256Of } from "../helpers/canonical";

const golden = JSON.parse(readFileSync("tests/fixtures/simulator-golden.json", "utf8")) as Record<
  string,
  { frames: string; summary: string; auditLogs: string }
>;

describe("stepTreasury refactor keeps runTimelineSimulation output identical", () => {
  const policies: TimelinePolicy[] = ["reserve-juggler", "hold-all-cash", "fixed-buffer"];
  for (const policy of policies) {
    for (const hours of [168, 720]) {
      it(`${policy} over ${hours}h matches the pre-refactor golden hashes`, () => {
        const r = runTimelineSimulation({ policy, maxHours: hours });
        const g = golden[`${policy}:${hours}`];
        expect(sha256Of(r.frames)).toBe(g.frames);
        expect(sha256Of(r.summary)).toBe(g.summary);
        expect(sha256Of(r.auditLogs)).toBe(g.auditLogs);
      });
    }
  }

  it("shocked reserve-juggler run matches golden hashes", () => {
    const r = runTimelineSimulation({
      policy: "reserve-juggler",
      maxHours: 168,
      outflowShockPct: 25,
      rateShiftBps: 150,
      equityDrawdownShockPct: 20,
    });
    const g = golden["reserve-juggler:168:shocked"];
    expect(sha256Of(r.frames)).toBe(g.frames);
    expect(sha256Of(r.summary)).toBe(g.summary);
    expect(sha256Of(r.auditLogs)).toBe(g.auditLogs);
  });
});
