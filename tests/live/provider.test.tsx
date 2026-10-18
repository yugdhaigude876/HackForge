// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
vi.mock("@/lib/firebase/auth-context", () => ({
  useAuth: () => ({ user: { uid: "u1" }, isMock: false }),
}));

import { LiveTreasuryProvider, useLiveTreasury } from "@/components/providers/live-treasury-provider";
import type { LiveClock, LiveSource } from "@/lib/live/types";
import type { StreamTick } from "@/engine/live-tick";

function makeSource() {
  const h: {
    clock?: Parameters<LiveSource["subscribeClock"]>[1];
    clockErr?: Parameters<LiveSource["subscribeClock"]>[2];
    stream?: Parameters<LiveSource["subscribeStream"]>[2];
    unsubs: number;
  } = { unsubs: 0 };
  const source: LiveSource = {
    subscribeClock: (_o, next, err) => {
      h.clock = next;
      h.clockErr = err;
      return () => void h.unsubs++;
    },
    subscribeStream: (_o, _l, next) => {
      h.stream = next;
      return () => void h.unsubs++;
    },
  };
  return { source, h };
}

const clock = (status: LiveClock["status"]): LiveClock => ({
  appliedHours: 2,
  status,
  speedHoursPerMinute: 12,
  datasetHash: "x",
  datasetLength: 8760,
  lease: null,
  startedAtMs: 1,
  lastTickAtMs: 1,
  version: 1,
  updatedAtMs: 1,
});

const tick = (hourIndex: number) => ({ hourIndex, timestamp: `2026-01-01T0${hourIndex}:00:00Z` }) as unknown as StreamTick;

function Probe() {
  const v = useLiveTreasury();
  return (
    <div>
      <span data-testid="conn">{v.connection}</span>
      <span data-testid="stale">{String(v.stale)}</span>
      <span data-testid="hours">{v.ticks.map((t) => t.hourIndex).join(",")}</span>
      <span data-testid="latest">{v.latest?.hourIndex ?? "none"}</span>
    </div>
  );
}

const setup = () => {
  const { source, h } = makeSource();
  const utils = render(
    <LiveTreasuryProvider source={source} forceEnabled orgId="org_t">
      <Probe />
    </LiveTreasuryProvider>
  );
  return { h, ...utils };
};

describe("LiveTreasuryProvider", () => {
  it("starts connecting, then reflects running, paused and completed clocks", () => {
    const { h } = setup();
    expect(screen.getByTestId("conn").textContent).toBe("connecting");
    act(() => h.clock!(clock("running"), { fromCache: false }));
    expect(screen.getByTestId("conn").textContent).toBe("live");
    act(() => h.clock!(clock("stopped"), { fromCache: false }));
    expect(screen.getByTestId("conn").textContent).toBe("paused");
    act(() => h.clock!(clock("completed"), { fromCache: false }));
    expect(screen.getByTestId("conn").textContent).toBe("completed");
  });

  it("reports empty when there is no clock and no ticks", () => {
    const { h } = setup();
    act(() => h.clock!(null, { fromCache: false }));
    expect(screen.getByTestId("conn").textContent).toBe("empty");
  });

  it("sorts streamed ticks oldest first and exposes the latest", () => {
    const { h } = setup();
    act(() => h.clock!(clock("running"), { fromCache: false }));
    act(() => h.stream!([tick(3), tick(2), tick(1)], { fromCache: false }));
    expect(screen.getByTestId("hours").textContent).toBe("1,2,3");
    expect(screen.getByTestId("latest").textContent).toBe("3");
  });

  it("maps permission-denied and other errors to distinct connection states", () => {
    const a = setup();
    act(() => a.h.clockErr!({ code: "permission-denied" }));
    expect(screen.getByTestId("conn").textContent).toBe("permission-denied");
    a.unmount();
    const b = setup();
    act(() => b.h.clockErr!({ code: "unavailable" }));
    expect(screen.getByTestId("conn").textContent).toBe("offline");
    expect(screen.getByTestId("stale").textContent).toBe("true");
  });

  it("unsubscribes both listeners on unmount", () => {
    const { h, unmount } = setup();
    unmount();
    expect(h.unsubs).toBe(2);
  });

  it("does not subscribe when disabled", () => {
    const sub = vi.fn(() => () => undefined);
    render(
      <LiveTreasuryProvider source={{ subscribeClock: sub, subscribeStream: sub }} forceEnabled={false}>
        <Probe />
      </LiveTreasuryProvider>
    );
    expect(sub).not.toHaveBeenCalled();
    expect(screen.getByTestId("conn").textContent).toBe("empty");
  });
});
