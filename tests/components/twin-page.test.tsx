// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import DigitalTwinPage from "@/app/(app)/twin/page";
import { ThemeProvider } from "@/components/providers/theme-provider";
import * as apiClientModule from "@/lib/api-client";
import * as authContextModule from "@/lib/firebase/auth-context";
import type { AuthUser } from "@/lib/firebase/types";

// Mock Recharts ResponsiveContainer to avoid size computation issues in JSDOM
vi.mock("recharts", async () => {
  const actual = await vi.importActual("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 600, height: 300 }}>{children}</div>
    ),
  };
});

describe("Digital Twin Page (/twin)", () => {
  const mockComparisonResult = {
    comparisonId: "cmp_mock_123",
    seed: "twin-seed-123",
    trials: 500,
    horizonHours: 24,
    source: "live",
    scenario: {
      outflowShockPct: 25,
      shockStartHour: 2,
      shockDurationHours: 12,
      settlementDelayHours: 0,
      confidence: 0.99,
    },
    policies: ["reserve-juggler", "hold-all-cash", "fixed-buffer"],
    policyResults: {
      "reserve-juggler": {
        policy: "reserve-juggler",
        seed: "twin-seed-123",
        trials: 500,
        horizonHours: 24,
        shortfallFrequency: 0.012,
        expectedShortfallMinor: "120000",
        p95ShortfallMinor: "450000",
        emergencyBorrowingCostMinor: "1500",
        penaltiesPaidMinor: "25000",
        grossYieldMinor: "350000",
        netYieldMinor: "323500",
        meanIdleCashMinor: "4200000000",
        idleCashHoursMinor: "4200000000",
        cashPath: Array.from({ length: 25 }, (_, i) => ({
          hour: i,
          p5CashMinor: "3800000000",
          medianCashMinor: "4200000000",
          p95CashMinor: "4600000000",
        })),
      },
      "hold-all-cash": {
        policy: "hold-all-cash",
        seed: "twin-seed-123",
        trials: 500,
        horizonHours: 24,
        shortfallFrequency: 0.0,
        expectedShortfallMinor: "0",
        p95ShortfallMinor: "0",
        emergencyBorrowingCostMinor: "0",
        penaltiesPaidMinor: "0",
        grossYieldMinor: "0",
        netYieldMinor: "0",
        meanIdleCashMinor: "5000000000",
        idleCashHoursMinor: "5000000000",
        cashPath: Array.from({ length: 25 }, (_, i) => ({
          hour: i,
          p5CashMinor: "4500000000",
          medianCashMinor: "5000000000",
          p95CashMinor: "5500000000",
        })),
      },
      "fixed-buffer": {
        policy: "fixed-buffer",
        seed: "twin-seed-123",
        trials: 500,
        horizonHours: 24,
        shortfallFrequency: 0.035,
        expectedShortfallMinor: "340000",
        p95ShortfallMinor: "890000",
        emergencyBorrowingCostMinor: "4200",
        penaltiesPaidMinor: "45000",
        grossYieldMinor: "280000",
        netYieldMinor: "230800",
        meanIdleCashMinor: "1000000000",
        idleCashHoursMinor: "1000000000",
        cashPath: Array.from({ length: 25 }, (_, i) => ({
          hour: i,
          p5CashMinor: "800000000",
          medianCashMinor: "1000000000",
          p95CashMinor: "1200000000",
        })),
      },
    },
    deltas: {
      "reserve-juggler": {
        vsHoldAllCash: {
          netYieldMinor: "323500",
          shortfallFrequency: 0.012,
          expectedShortfallMinor: "120000",
          p95ShortfallMinor: "450000",
          penaltiesPaidMinor: "25000",
          emergencyBorrowingCostMinor: "1500",
        },
      },
      "fixed-buffer": {
        vsHoldAllCash: {
          netYieldMinor: "230800",
          shortfallFrequency: 0.035,
          expectedShortfallMinor: "340000",
          p95ShortfallMinor: "890000",
          penaltiesPaidMinor: "45000",
          emergencyBorrowingCostMinor: "4200",
        },
      },
      "hold-all-cash": {},
    },
    winners: {
      netYield: "reserve-juggler",
      shortfallFrequency: "hold-all-cash",
      expectedShortfall: "hold-all-cash",
      p95Shortfall: "hold-all-cash",
      penaltiesPaid: "hold-all-cash",
      emergencyBorrowingCost: "hold-all-cash",
    },
    disclaimer: "Stress simulation disclaimer test text.",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(authContextModule, "useAuth").mockReturnValue({
      user: {
        uid: "user-1",
        email: "analyst@bank.internal",
        displayName: "Analyst",
        isAnonymous: false,
      },
      loading: false,
      isMock: false,
      isUnconfigured: false,
      error: null,
      getIdToken: vi.fn().mockResolvedValue("mock-token"),
      signInWithEmail: vi.fn(),
      signUpWithEmail: vi.fn(),
      signInWithGoogle: vi.fn(),
      signInAsDemoUser: vi.fn(),
      signOut: vi.fn(),
      clearError: vi.fn(),
    });

    vi.spyOn(apiClientModule, "apiFetch").mockImplementation(async (endpoint) => {
      if (endpoint === "/api/dashboard/summary") {
        return {
          ok: true,
          status: 200,
          data: { userRole: "analyst" } as any,
        };
      }
      if (endpoint === "/api/instruments") {
        return {
          ok: true,
          status: 200,
          data: {
            instruments: [
              { id: "inst-1", name: "30-Day T-Bill MMF", annualRateBps: 520 },
              { id: "inst-2", name: "7-Day Term Deposit", annualRateBps: 485 },
            ],
          },
        };
      }
      if (endpoint === "/api/simulations/compare") {
        return {
          ok: true,
          status: 200,
          data: { comparisons: [] },
        };
      }
      return { ok: false, status: 404, error: { code: "NOT_FOUND", message: "Not found" } };
    });
  });

  it("renders scenario presets and clicking a preset updates controls", async () => {
    render(
      <ThemeProvider>
        <DigitalTwinPage />
      </ThemeProvider>
    );

    expect(screen.getByText("Scenario Presets")).toBeDefined();
    const bankRunBtn = screen.getByText("Bank-run tail");
    expect(bankRunBtn).toBeDefined();

    // Click bank-run preset
    fireEvent.click(bankRunBtn);

    // Verify Correlated Bank-Run Tail badge appears
    await waitFor(() => {
      expect(screen.getByText("Correlated Bank-Run Tail")).toBeDefined();
      expect(screen.getByText("Active")).toBeDefined();
    });
  });

  it("executes comparison run, displays results banner, comparison table, chart, and winners", async () => {
    vi.spyOn(apiClientModule, "apiFetch").mockImplementation(async (endpoint, options) => {
      if (endpoint === "/api/dashboard/summary") {
        return {
          ok: true,
          status: 200,
          data: { userRole: "analyst" } as any,
        };
      }
      if (endpoint === "/api/simulations/compare" && options?.method === "POST") {
        return {
          ok: true,
          status: 200,
          data: mockComparisonResult,
        };
      }
      if (endpoint === "/api/instruments") {
        return {
          ok: true,
          status: 200,
          data: { instruments: [] },
        };
      }
      if (endpoint === "/api/simulations/compare") {
        return {
          ok: true,
          status: 200,
          data: { comparisons: [] },
        };
      }
      return { ok: false, status: 404, error: { code: "NOT_FOUND", message: "Not found" } };
    });

    render(
      <ThemeProvider>
        <DigitalTwinPage />
      </ThemeProvider>
    );

    const runBtn = await screen.findByTestId("run-comparison-btn");
    expect(runBtn).toBeDefined();

    fireEvent.click(runBtn);

    await waitFor(() => {
      // Status badge updates
      expect(screen.getByTestId("twin-status-badge")).toBeDefined();
      // Labels show execution parameters
      const paramsLabel = screen.getByTestId("execution-params-label");
      expect(paramsLabel.textContent).toContain("Simulated on live data, seed");
      expect(paramsLabel.textContent).toContain("twin-seed-123");
      expect(paramsLabel.textContent).toContain("500 trials per policy");
      // Comparison table renders
      expect(screen.getByTestId("twin-comparison-table")).toBeDefined();
      expect(screen.getAllByText("Reserve Juggler").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Hold All Cash").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Fixed Buffer").length).toBeGreaterThan(0);
      // Scrubber renders
      expect(screen.getByTestId("twin-replay-scrubber")).toBeDefined();
    });
  });

  it("replay scrubber steps forward, backward, and responds to keyboard navigation", async () => {
    vi.spyOn(apiClientModule, "apiFetch").mockImplementation(async (endpoint, options) => {
      if (endpoint === "/api/dashboard/summary") {
        return {
          ok: true,
          status: 200,
          data: { userRole: "analyst" } as any,
        };
      }
      if (endpoint === "/api/simulations/compare" && options?.method === "POST") {
        return {
          ok: true,
          status: 200,
          data: mockComparisonResult,
        };
      }
      return { ok: true, status: 200, data: { instruments: [], comparisons: [] } };
    });

    render(
      <ThemeProvider>
        <DigitalTwinPage />
      </ThemeProvider>
    );

    // Run comparison
    const runComparisonBtn = await screen.findByTestId("run-comparison-btn");
    fireEvent.click(runComparisonBtn);

    await waitFor(() => {
      expect(screen.getByTestId("twin-replay-scrubber")).toBeDefined();
    });

    const scrubber = screen.getByTestId("twin-replay-scrubber");
    expect(screen.getByText(/Hour t = 0h \/ 24h/i)).toBeDefined();

    // Step forward button
    const stepForwardBtn = screen.getByLabelText("Step Forward 1 Hour");
    fireEvent.click(stepForwardBtn);
    expect(screen.getByText(/Hour t = 1h \/ 24h/i)).toBeDefined();

    // Keyboard ArrowRight
    fireEvent.keyDown(scrubber, { key: "ArrowRight" });
    expect(screen.getByText(/Hour t = 2h \/ 24h/i)).toBeDefined();

    // Keyboard ArrowLeft
    fireEvent.keyDown(scrubber, { key: "ArrowLeft" });
    expect(screen.getByText(/Hour t = 1h \/ 24h/i)).toBeDefined();

    // Keyboard Space toggles play/pause
    const playPauseBtn = screen.getByTestId("replay-play-pause-btn");
    expect(playPauseBtn.textContent).toContain("Play");
    fireEvent.keyDown(scrubber, { key: " " });
    expect(playPauseBtn.textContent).toContain("Pause");
  });

  it("disables controls and displays notice in mock or unauthenticated mode without making API calls", async () => {
    vi.spyOn(authContextModule, "useAuth").mockReturnValue({
      user: null,
      loading: false,
      isMock: true,
      isUnconfigured: false,
      error: null,
      getIdToken: vi.fn().mockResolvedValue(null),
      signInWithEmail: vi.fn(),
      signUpWithEmail: vi.fn(),
      signInWithGoogle: vi.fn(),
      signInAsDemoUser: vi.fn(),
      signOut: vi.fn(),
      clearError: vi.fn(),
    });

    const apiSpy = vi.spyOn(apiClientModule, "apiFetch");

    render(
      <ThemeProvider>
        <DigitalTwinPage />
      </ThemeProvider>
    );

    // Mock warning banner is visible
    expect(screen.getByText("Simulation Disabled in Mock Mode")).toBeDefined();
    expect(
      screen.getByText(/Sign in with a real account to run simulations/i)
    ).toBeDefined();

    // Run comparison button is not rendered
    expect(screen.queryByTestId("run-comparison-btn")).toBeNull();

    // No simulation calls made
    expect(apiSpy).not.toHaveBeenCalledWith(
      "/api/simulations/compare",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("hides run comparison action for viewer role and displays viewer notice", async () => {
    vi.spyOn(authContextModule, "useAuth").mockReturnValue({
      user: { uid: "test-viewer", email: "viewer@bank.com", displayName: "Viewer", isAnonymous: false } as AuthUser,
      loading: false,
      isMock: false,
      isUnconfigured: false,
      error: null,
      getIdToken: vi.fn().mockResolvedValue("mock-viewer-token"),
      signInWithEmail: vi.fn(),
      signUpWithEmail: vi.fn(),
      signInWithGoogle: vi.fn(),
      signInAsDemoUser: vi.fn(),
      signOut: vi.fn(),
      clearError: vi.fn(),
    });

    vi.spyOn(apiClientModule, "apiFetch").mockImplementation(async (endpoint) => {
      if (endpoint === "/api/dashboard/summary") {
        return {
          ok: true,
          status: 200,
          data: { userRole: "viewer", decision: null, forecast: null, actuals: [] },
        };
      }
      return { ok: true, status: 200, data: { instruments: [], comparisons: [] } };
    });

    render(
      <ThemeProvider>
        <DigitalTwinPage />
      </ThemeProvider>
    );

    // Wait for role resolution
    await waitFor(() => {
      expect(screen.queryByTestId("run-comparison-btn")).toBeNull();
      expect(
        screen.getByText(/You have Viewer permissions/i)
      ).toBeDefined();
    });
  });

  it("hides run action while server role is loading (fail-closed)", async () => {
    // Delay resolution of dashboard summary to simulate loading state
    vi.spyOn(apiClientModule, "apiFetch").mockImplementation(async (endpoint) => {
      if (endpoint === "/api/dashboard/summary") {
        return new Promise(() => {}); // never resolves during test
      }
      return { ok: true, status: 200, data: { instruments: [], comparisons: [] } };
    });

    render(
      <ThemeProvider>
        <DigitalTwinPage />
      </ThemeProvider>
    );

    // Run comparison button must not be visible while loading
    expect(screen.queryByTestId("run-comparison-btn")).toBeNull();
  });

  it("hides run action and defaults to viewer if role fetch fails (fail-closed)", async () => {
    vi.spyOn(apiClientModule, "apiFetch").mockImplementation(async (endpoint) => {
      if (endpoint === "/api/dashboard/summary") {
        return {
          ok: false,
          status: 500,
          error: { code: "INTERNAL", message: "Failed to fetch summary" },
        };
      }
      return { ok: true, status: 200, data: { instruments: [], comparisons: [] } };
    });

    render(
      <ThemeProvider>
        <DigitalTwinPage />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.queryByTestId("run-comparison-btn")).toBeNull();
    });
  });

  it("displays run comparison action for real analyst role", async () => {
    vi.spyOn(apiClientModule, "apiFetch").mockImplementation(async (endpoint) => {
      if (endpoint === "/api/dashboard/summary") {
        return {
          ok: true,
          status: 200,
          data: { userRole: "analyst", decision: null, forecast: null, actuals: [] },
        };
      }
      return { ok: true, status: 200, data: { instruments: [], comparisons: [] } };
    });

    render(
      <ThemeProvider>
        <DigitalTwinPage />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("run-comparison-btn")).toBeDefined();
    });
  });
});
