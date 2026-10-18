// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/lib/firebase/auth-context", () => ({
  useAuth: () => ({ user: { uid: "u1", displayName: "Sylborn Furtado", email: "s@bank.internal" }, isMock: false, signOut: vi.fn() }),
}));
vi.mock("@/hooks/use-org-role", () => ({ useOrgRole: () => ({ role: "analyst", loading: false, isLive: true }) }));
vi.mock("@/lib/api-client", () => ({ DEFAULT_ORG_ID: "org_t", apiFetch: vi.fn(async () => ({ ok: true, status: 200, data: {} })) }));
vi.mock("@/components/layout/command-palette", () => ({ CommandPalette: () => null }));

import { AppShell } from "@/components/layout/app-shell";
import { TopBar } from "@/components/layout/top-bar";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { LiveTreasuryProvider } from "@/components/providers/live-treasury-provider";
import type { LiveSource } from "@/lib/live/types";

const idleSource: LiveSource = { subscribeClock: () => () => undefined, subscribeStream: () => () => undefined };

function renderShell() {
  return render(
    <ThemeProvider>
      <LiveTreasuryProvider source={idleSource} forceEnabled orgId="org_t">
        <AppShell>
          <TopBar clockTimestamp="2026-01-01 00:00:00 UTC" onTriggerSweep={vi.fn()} onRunStressTest={vi.fn()} onExportAuditCsv={vi.fn()} />
        </AppShell>
      </LiveTreasuryProvider>
    </ThemeProvider>
  );
}

const sidebar = () => screen.getAllByTestId("sidebar")[0];

describe("collapsible sidebar", () => {
  beforeEach(() => window.localStorage.clear());

  it("starts expanded, collapses to an icon rail and expands again from the sidebar button", async () => {
    renderShell();
    expect(sidebar().getAttribute("data-collapsed")).toBe("false");
    expect(screen.getAllByText("Overview").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId("sidebar-collapse"));
    expect(sidebar().getAttribute("data-collapsed")).toBe("true");
    expect(screen.getByTestId("app-shell").getAttribute("data-sidebar-collapsed")).toBe("true");
    // Labels are hidden but links stay reachable by accessible name
    expect(screen.getAllByLabelText("Overview").length).toBeGreaterThan(0);
    expect(screen.queryByText("Cash Flow Forecasting")).toBeNull();

    fireEvent.click(screen.getByTestId("sidebar-expand"));
    expect(sidebar().getAttribute("data-collapsed")).toBe("false");
    expect(screen.getAllByText("Cash Flow Forecasting").length).toBeGreaterThan(0);
  });

  it("can be toggled from the top bar and with Ctrl+B", () => {
    renderShell();
    fireEvent.click(screen.getByTestId("topbar-sidebar-toggle"));
    expect(sidebar().getAttribute("data-collapsed")).toBe("true");
    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(sidebar().getAttribute("data-collapsed")).toBe("false");
    fireEvent.keyDown(window, { key: "b", metaKey: true });
    expect(sidebar().getAttribute("data-collapsed")).toBe("true");
  });

  it("ignores Ctrl+B while typing in an input", () => {
    renderShell();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: "b", ctrlKey: true });
    expect(sidebar().getAttribute("data-collapsed")).toBe("false");
    input.remove();
  });

  it("remembers the choice and restores it on the next load", async () => {
    const first = renderShell();
    fireEvent.click(screen.getByTestId("sidebar-collapse"));
    expect(window.localStorage.getItem("rj.sidebar.collapsed")).toBe("1");
    first.unmount();

    renderShell();
    await waitFor(() => expect(sidebar().getAttribute("data-collapsed")).toBe("true"));
  });

  it("still works when localStorage is blocked", () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("blocked");
    };
    try {
      renderShell();
      expect(() => fireEvent.click(screen.getByTestId("sidebar-collapse"))).not.toThrow();
      expect(sidebar().getAttribute("data-collapsed")).toBe("true");
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  it("shows real stream status in the sidebar, never a fixed compliance figure", () => {
    renderShell();
    const status = screen.getByTestId("sidebar-status");
    expect(status.textContent).toContain("DATA STREAM");
    expect(status.textContent).toContain("RESERVE COVERAGE");
    expect(status.textContent).not.toMatch(/134%/);
  });
});

describe("top bar", () => {
  it("shows the clock on one compact line and tucks quick actions into a menu", () => {
    renderShell();
    expect(screen.getByText("2026-01-01 00:00 UTC")).toBeDefined();
    expect(screen.queryByText("Sweep 17:00")).toBeNull();
    fireEvent.click(screen.getByTestId("topbar-actions"));
    expect(screen.getByText("Sweep 17:00")).toBeDefined();
    expect(screen.getByText("Stress Test")).toBeDefined();
    expect(screen.getByText("Export Audit CSV")).toBeDefined();
  });

  it("menu actions call their handlers and close the menu", () => {
    const sweep = vi.fn();
    render(
      <ThemeProvider>
        <LiveTreasuryProvider source={idleSource} forceEnabled={false}>
          <TopBar onTriggerSweep={sweep} />
        </LiveTreasuryProvider>
      </ThemeProvider>
    );
    fireEvent.click(screen.getByTestId("topbar-actions"));
    act(() => fireEvent.click(screen.getByText("Sweep 17:00")));
    expect(sweep).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Sweep 17:00")).toBeNull();
  });

  it("hides the actions menu when no actions are provided (for example while streaming)", () => {
    render(
      <ThemeProvider>
        <LiveTreasuryProvider source={idleSource} forceEnabled={false}>
          <TopBar />
        </LiveTreasuryProvider>
      </ThemeProvider>
    );
    expect(screen.queryByTestId("topbar-actions")).toBeNull();
  });
});
