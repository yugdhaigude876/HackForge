// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";

vi.mock("recharts", async () => {
  const actual = await vi.importActual("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div style={{ width: 800, height: 400 }}>{children}</div>,
  };
});
vi.mock("@/lib/firebase/auth-context", () => ({
  useAuth: () => ({ user: { uid: "analyst-1", email: "a@bank.internal" }, isMock: false, loading: false }),
}));
vi.mock("@/lib/api-client", () => ({
  DEFAULT_ORG_ID: "org_live",
  apiFetch: vi.fn(async (path: string) => {
    if (path === "/api/dashboard/summary") {
      return { ok: true, status: 200, data: { decision: null, forecast: null, actuals: [], userRole: "analyst" } };
    }
    return { ok: false, status: 404, error: { code: "NOT_FOUND", message: "nope" } };
  }),
}));

import DashboardPage from "@/app/(app)/dashboard/page";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { DataSourceProvider } from "@/components/providers/data-source-provider";
import { LiveTreasuryProvider } from "@/components/providers/live-treasury-provider";
import type { LiveClock, LiveSource } from "@/lib/live/types";
import type { StreamTick } from "@/engine/live-tick";
import { MemoryClockStore, advanceClock, controlClock, setClockStore } from "@/server/clock-service";

let ticks: StreamTick[] = [];

beforeAll(async () => {
  const store = new MemoryClockStore();
  setClockStore(store);
  await controlClock({ orgId: "org_live", uid: "analyst-1", role: "analyst", action: "start", nowMs: 1 });
  let applied = 0;
  while (applied < 60) {
    const r = await advanceClock({ orgId: "org_live", uid: "analyst-1", steps: 24, expectedHourIndex: applied, nowMs: 2 + applied });
    applied += r.applied;
  }
  const m = store.streams.get("org_live")!;
  ticks = [...m.keys()].sort((a, b) => a - b).map((h) => m.get(h)!);
}, 60_000);

const clock = (applied: number, status: LiveClock["status"] = "running"): LiveClock => ({
  appliedHours: applied,
  status,
  speedHoursPerMinute: 12,
  datasetHash: "h",
  datasetLength: 8760,
  lease: { ownerUid: "analyst-1", untilMs: Date.now() + 30_000 },
  startedAtMs: 1,
  lastTickAtMs: 1,
  version: 1,
  updatedAtMs: 1,
});

function renderDashboard(source: LiveSource) {
  return render(
    <ThemeProvider>
      <DataSourceProvider>
        <LiveTreasuryProvider source={source} forceEnabled orgId="org_live">
          <DashboardPage />
        </LiveTreasuryProvider>
      </DataSourceProvider>
    </ThemeProvider>
  );
}

describe("Dashboard on the live dataset stream", () => {
  it("renders the streamed hour, the dataset badge and clock controls, and follows new ticks", async () => {
    const h: { clock?: (c: LiveClock | null, m: { fromCache: boolean }) => void; stream?: (t: StreamTick[], m: { fromCache: boolean }) => void } = {};
    const source: LiveSource = {
      subscribeClock: (_o, next) => {
        h.clock = next;
        return () => undefined;
      },
      subscribeStream: (_o, _l, next) => {
        h.stream = next;
        return () => undefined;
      },
    };
    renderDashboard(source);

    act(() => h.clock!(clock(40), { fromCache: false }));
    act(() => h.stream!(ticks.slice(0, 40).reverse(), { fromCache: false }));

    await waitFor(() => expect(screen.getByTestId("dataset-stream-badge").textContent).toContain("Official dataset (streamed)"));
    expect(screen.getByTestId("clock-controls")).toBeDefined();
    expect(screen.getByTestId("clock-position").textContent).toContain("hour 40");
    expect(screen.getByTestId("connection-pill").getAttribute("data-connection")).toBe("live");
    expect(screen.getAllByText(/Live Dataset Telemetry/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Streamed Frame H39/).length).toBeGreaterThan(0);
    // The fake "No runs yet" banner must not replace the workstation while streaming
    expect(screen.queryByTestId("dashboard-empty")).toBeNull();
    // Replay-only quick actions are hidden while streaming
    expect(screen.queryByText("Sweep 17:00")).toBeNull();

    // A new hour arrives: the active frame follows live
    act(() => h.clock!(clock(41), { fromCache: false }));
    act(() => h.stream!(ticks.slice(0, 41).reverse(), { fromCache: false }));
    await waitFor(() => expect(screen.getAllByText(/Streamed Frame H40/).length).toBeGreaterThan(0));
    expect(screen.getByTestId("clock-position").textContent).toContain("hour 41");
  });

  it("shows an offline state and keeps the last known data when the connection drops", async () => {
    const h: { clockErr?: (e: { code?: string }) => void; clock?: (c: LiveClock | null, m: { fromCache: boolean }) => void; stream?: (t: StreamTick[], m: { fromCache: boolean }) => void } = {};
    const source: LiveSource = {
      subscribeClock: (_o, next, err) => {
        h.clock = next;
        h.clockErr = err;
        return () => undefined;
      },
      subscribeStream: (_o, _l, next) => {
        h.stream = next;
        return () => undefined;
      },
    };
    renderDashboard(source);
    act(() => h.clock!(clock(30), { fromCache: false }));
    act(() => h.stream!(ticks.slice(0, 30).reverse(), { fromCache: false }));
    await waitFor(() => expect(screen.getByTestId("dataset-stream-badge")).toBeDefined());

    act(() => h.clockErr!({ code: "unavailable" }));
    await waitFor(() => expect(screen.getByTestId("connection-pill").getAttribute("data-connection")).toBe("offline"));
    expect(screen.getByTestId("clock-stale")).toBeDefined();
    expect(screen.getByTestId("dataset-stream-badge")).toBeDefined(); // last known frames still shown
  });

  it("with a stopped, empty stream it still shows the workstation sample plus a Start button for analysts", async () => {
    const h: { clock?: (c: LiveClock | null, m: { fromCache: boolean }) => void } = {};
    const source: LiveSource = {
      subscribeClock: (_o, next) => {
        h.clock = next;
        return () => undefined;
      },
      subscribeStream: () => () => undefined,
    };
    renderDashboard(source);
    act(() => h.clock!(null, { fromCache: false }));
    await waitFor(() => expect(screen.getByTestId("clock-waiting")).toBeDefined());
    await waitFor(() => expect(screen.getByTestId("clock-start")).toBeDefined());
  });
});
