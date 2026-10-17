// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { StressSimulatorPanel } from "@/components/finance/stress-simulator-panel";
import { ThemeProvider } from "@/components/providers/theme-provider";
import * as apiClientModule from "@/lib/api-client";
import * as authContextModule from "@/lib/firebase/auth-context";

// Mock Recharts ResponsiveContainer to avoid size computation issues in JSDOM
vi.mock("recharts", async () => {
  const actual = await vi.importActual("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 400, height: 200 }}>{children}</div>
    ),
  };
});

describe("StressSimulatorPanel (Phase 18)", () => {
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
  });

  const mockSimulationSuccess = {
    id: "sim_123",
    seed: "test-seed-456",
    trials: 500,
    horizonHours: 24,
    source: "synthetic",
    scenario: {
      outflowShockPct: 20,
      settlementDelayHours: 0,
      confidence: 0.99,
    },
    policy: "reserve-juggler",
    shortfallFrequency: 0.024,
    expectedShortfallMinor: "4500000",
    p95ShortfallMinor: "12000000",
    emergencyBorrowingCostMinor: "50000",
    penaltiesPaidMinor: "150000",
    grossYieldMinor: "3200000",
    netYieldMinor: "3000000",
    minCash: {
      p5Minor: "10000000",
      p50Minor: "45000000",
      p95Minor: "85000000",
    },
    idleCashHoursMinor: "50000000",
    cashPath: [
      { hour: 0, p5CashMinor: "50000000", medianCashMinor: "50000000", p95CashMinor: "50000000" },
      { hour: 12, p5CashMinor: "35000000", medianCashMinor: "48000000", p95CashMinor: "60000000" },
      { hour: 24, p5CashMinor: "20000000", medianCashMinor: "45000000", p95CashMinor: "70000000" },
    ],
    disclaimer: "Stress simulation results are probabilistic model outputs derived from historical resampling.",
  };

  it("renders disabled controls and demonstration notice in mock/signed-out mode", () => {
    render(
      <ThemeProvider>
        <StressSimulatorPanel isLive={false} userRole="viewer" />
      </ThemeProvider>
    );

    // Demonstration mode banner is present
    expect(screen.getByText(/Demonstration Mode:/i)).toBeDefined();
    expect(screen.getByText(/Sign in with a real account to run simulations/i)).toBeDefined();

    // Sliders are disabled
    const outflowSlider = screen.getByLabelText(/Outflow Shock/i);
    expect(outflowSlider.hasAttribute("disabled")).toBe(true);

    const delaySlider = screen.getByLabelText(/Settlement Delay/i);
    expect(delaySlider.hasAttribute("disabled")).toBe(true);

    const confidenceSlider = screen.getByLabelText(/Reserve Confidence/i);
    expect(confidenceSlider.hasAttribute("disabled")).toBe(true);

    // No run button rendered for signed-out / mock mode
    expect(screen.queryByTestId("run-simulation-button")).toBeNull();

    // No fake results rendered
    expect(screen.queryByTestId("simulation-results")).toBeNull();
  });

  it("hides run simulation button for viewer role in live mode", () => {
    render(
      <ThemeProvider>
        <StressSimulatorPanel isLive={true} userRole="viewer" />
      </ThemeProvider>
    );

    // Sliders are enabled in live mode
    const outflowSlider = screen.getByLabelText(/Outflow Shock/i);
    expect(outflowSlider.hasAttribute("disabled")).toBe(false);

    // Run button is hidden for viewer
    expect(screen.queryByTestId("run-simulation-button")).toBeNull();
  });

  it("allows analyst to adjust sliders and displays live readouts", () => {
    render(
      <ThemeProvider>
        <StressSimulatorPanel isLive={true} userRole="analyst" />
      </ThemeProvider>
    );

    const outflowSlider = screen.getByLabelText(/Outflow Shock/i);
    fireEvent.change(outflowSlider, { target: { value: "35" } });
    expect(screen.getByTestId("outflow-shock-value").textContent).toBe("35%");

    const delaySlider = screen.getByLabelText(/Settlement Delay/i);
    fireEvent.change(delaySlider, { target: { value: "24" } });
    expect(screen.getByTestId("settlement-delay-value").textContent).toContain("24h");
  });

  it("executes simulation when Run button is clicked and renders results", async () => {
    const apiFetchSpy = vi.spyOn(apiClientModule, "apiFetch").mockResolvedValue({
      ok: true,
      data: mockSimulationSuccess,
      status: 200,
    });

    render(
      <ThemeProvider>
        <StressSimulatorPanel isLive={true} userRole="analyst" />
      </ThemeProvider>
    );

    const runBtn = screen.getByTestId("run-simulation-button");
    expect(runBtn).toBeDefined();

    fireEvent.click(runBtn);

    await waitFor(() => {
      expect(apiFetchSpy).toHaveBeenCalledTimes(1);
    });

    // Check that results rendered
    await waitFor(() => {
      expect(screen.getByTestId("simulation-results")).toBeDefined();
    });

    // Check specific metric values
    expect(screen.getByTestId("sim-shortfall-freq").textContent).toBe("2.4%");
    expect(screen.getByTestId("sim-exp-shortfall").textContent).toBeDefined();
    expect(screen.getByTestId("sim-net-yield").textContent).toBeDefined();

    // Header label
    expect(screen.getByText(/Simulated on synthetic data, seed test-seed-456, 500 trials/i)).toBeDefined();

    // Disclaimer
    expect(screen.getByText(/Stress simulation results are probabilistic model outputs/i)).toBeDefined();
  });

  it("handles 429 rate limiting with countdown hint", async () => {
    vi.spyOn(apiClientModule, "apiFetch").mockResolvedValue({
      ok: false,
      error: {
        code: "RATE_LIMITED",
        message: "Simulation runs are debounced. Please wait 10s.",
        details: { retryAfterSeconds: 10 },
      },
      status: 429,
    });

    render(
      <ThemeProvider>
        <StressSimulatorPanel isLive={true} userRole="analyst" />
      </ThemeProvider>
    );

    const runBtn = screen.getByTestId("run-simulation-button");
    fireEvent.click(runBtn);

    await waitFor(() => {
      expect(screen.getByTestId("simulation-error")).toBeDefined();
    });

    expect(screen.getByTestId("simulation-error").textContent).toContain("Please wait 10s");
  });
});
