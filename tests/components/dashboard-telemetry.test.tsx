// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import DashboardPage from "@/app/(app)/dashboard/page";
import { AuthProvider } from "@/lib/firebase/auth-context";
import { ThemeProvider } from "@/components/providers/theme-provider";
import * as dashboardHookModule from "@/hooks/use-dashboard-data";
import * as replayHookModule from "@/hooks/use-replay-simulation";

// Mock Recharts ResponsiveContainer to avoid size computation issues in JSDOM
vi.mock("recharts", async () => {
  const actual = await vi.importActual("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 800, height: 400 }}>{children}</div>
    ),
  };
});

describe("Dashboard Telemetry & Replay Workstation", () => {
  const mockReplayResult: replayHookModule.ReplaySimulationResult = {
    frames: [
      {
        hour: 0,
        hourIndex: 0,
        timestamp: "2026-10-18T00:00:00.000Z",
        depositsUsd: 10_000,
        withdrawalsUsd: 8_000,
        netFlowUsd: 2_000,
        portfolio: {
          hourIndex: 0,
          timestamp: "2026-10-18T00:00:00.000Z",
          tier0Cash: { currency: "USD", amountMinor: 50_000_000_00n },
          tier1RepoPrincipal: { currency: "USD", amountMinor: 0n },
          tier1RepoAccruedYield: { currency: "USD", amountMinor: 0n },
          tier1IsActive: false,
          tier2BondsMarketValue: { currency: "USD", amountMinor: 0n },
          tier2BondsParValue: { currency: "USD", amountMinor: 0n },
          tier2BondsPriceIndex: 100,
          tier2BondsAccruedYield: { currency: "USD", amountMinor: 0n },
          tier3EquitiesMarketValue: { currency: "USD", amountMinor: 0n },
          tier3EquitiesCostBasis: { currency: "USD", amountMinor: 0n },
          tier3EquitiesIndexPrice: 100,
          tier3PeakMarketValue: { currency: "USD", amountMinor: 0n },
          tier3DrawdownPct: 0,
          emergencyOverdraftBalance: { currency: "USD", amountMinor: 0n },
          totalAssets: { currency: "USD", amountMinor: 50_000_000_00n },
          cumulativeGrossYieldEarned: { currency: "USD", amountMinor: 0n },
          cumulativePenaltiesPaid: { currency: "USD", amountMinor: 0n },
          cumulativeOverdraftInterestPaid: { currency: "USD", amountMinor: 0n },
        },
        requiredReserveMinor: 5_000_000_00n,
        deployableSurplusMinor: 45_000_000_00n,
        liquidityStatus: "HEALTHY",
        events: [],
        liquidations: [],
      },
      {
        hour: 17,
        hourIndex: 17,
        timestamp: "2026-10-18T17:00:00.000Z",
        depositsUsd: 10_000,
        withdrawalsUsd: 8_000,
        netFlowUsd: 2_000,
        portfolio: {
          hourIndex: 17,
          timestamp: "2026-10-18T17:00:00.000Z",
          tier0Cash: { currency: "USD", amountMinor: 5_000_000_00n },
          tier1RepoPrincipal: { currency: "USD", amountMinor: 45_000_000_00n },
          tier1RepoAccruedYield: { currency: "USD", amountMinor: 0n },
          tier1IsActive: true,
          tier2BondsMarketValue: { currency: "USD", amountMinor: 0n },
          tier2BondsParValue: { currency: "USD", amountMinor: 0n },
          tier2BondsPriceIndex: 100,
          tier2BondsAccruedYield: { currency: "USD", amountMinor: 0n },
          tier3EquitiesMarketValue: { currency: "USD", amountMinor: 0n },
          tier3EquitiesCostBasis: { currency: "USD", amountMinor: 0n },
          tier3EquitiesIndexPrice: 100,
          tier3PeakMarketValue: { currency: "USD", amountMinor: 0n },
          tier3DrawdownPct: 0,
          emergencyOverdraftBalance: { currency: "USD", amountMinor: 0n },
          totalAssets: { currency: "USD", amountMinor: 50_000_000_00n },
          cumulativeGrossYieldEarned: { currency: "USD", amountMinor: 10_000_00n },
          cumulativePenaltiesPaid: { currency: "USD", amountMinor: 0n },
          cumulativeOverdraftInterestPaid: { currency: "USD", amountMinor: 0n },
        },
        requiredReserveMinor: 5_000_000_00n,
        deployableSurplusMinor: 0n,
        liquidityStatus: "HEALTHY",
        events: ["SWEEP_EXECUTED"],
        liquidations: [],
      },
      {
        hour: 24,
        hourIndex: 24,
        timestamp: "2026-10-19T00:00:00.000Z",
        depositsUsd: 10_000,
        withdrawalsUsd: 30_000,
        netFlowUsd: -20_000,
        portfolio: {
          hourIndex: 24,
          timestamp: "2026-10-19T00:00:00.000Z",
          tier0Cash: { currency: "USD", amountMinor: 2_000_000_00n },
          tier1RepoPrincipal: { currency: "USD", amountMinor: 40_000_000_00n },
          tier1RepoAccruedYield: { currency: "USD", amountMinor: 0n },
          tier1IsActive: true,
          tier2BondsMarketValue: { currency: "USD", amountMinor: 0n },
          tier2BondsParValue: { currency: "USD", amountMinor: 0n },
          tier2BondsPriceIndex: 100,
          tier2BondsAccruedYield: { currency: "USD", amountMinor: 0n },
          tier3EquitiesMarketValue: { currency: "USD", amountMinor: 0n },
          tier3EquitiesCostBasis: { currency: "USD", amountMinor: 0n },
          tier3EquitiesIndexPrice: 100,
          tier3PeakMarketValue: { currency: "USD", amountMinor: 0n },
          tier3DrawdownPct: 0,
          emergencyOverdraftBalance: { currency: "USD", amountMinor: 0n },
          totalAssets: { currency: "USD", amountMinor: 42_000_000_00n },
          cumulativeGrossYieldEarned: { currency: "USD", amountMinor: 15_000_00n },
          cumulativePenaltiesPaid: { currency: "USD", amountMinor: 500_00n },
          cumulativeOverdraftInterestPaid: { currency: "USD", amountMinor: 0n },
        },
        requiredReserveMinor: 5_000_000_00n,
        deployableSurplusMinor: 0n,
        liquidityStatus: "UNDER_RESERVED",
        events: ["LIQUIDATION_OCCURRED"],
        liquidations: [
          {
            tierId: "tier1_repo",
            tierName: "Tier 1: Overnight Repo",
            grossLiquidated: { currency: "USD", amountMinor: 5_000_000_00n } as any,
            haircutRatePct: 0.5,
            penaltyPaid: { currency: "USD", amountMinor: 500_00n } as any,
            netRecoveredCash: { currency: "USD", amountMinor: 4_999_500_00n } as any,
            settlementLagHours: 0,
          },
        ],
      },
    ],
    summary: {
      policy: "reserve-juggler",
      totalHoursSimulated: 168,
      startHour: 0,
      startTimestamp: "2026-10-18T00:00:00.000Z",
      endTimestamp: "2026-10-25T00:00:00.000Z",
      initialCashUsd: 50_000_000,
      finalNetAssetsUsd: 2_000_000,
      netPnlUsd: 145,
      annualizedNetReturnPct: 4.62,
      grossYieldEarnedUsd: 150,
      penaltiesPaidUsd: 5,
      overdraftInterestPaidUsd: 0,
      shortfallEventsCount: 1,
      overdraftHoursCount: 0,
      maxOverdraftDrawnUsd: 0,
      maxTier3DrawdownPct: 0,
    },
    auditLogs: [
      {
        hour: 17,
        timestamp: "2026-10-18T17:00:00.000Z",
        type: "SWEEP",
        message: "Swept $45,000,000 into overnight repo",
      },
      {
        hour: 24,
        timestamp: "2026-10-19T00:00:00.000Z",
        type: "LIQUIDATION",
        message: "Emergency liquidation of Tier 1 Repo: $5,000,000",
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders workstation even when org has no stored runs (dashboardStatus === 'empty')", () => {
    vi.spyOn(dashboardHookModule, "useDashboardData").mockReturnValue({
      status: "empty",
      data: null,
      error: null,
      retryAfterSeconds: null,
      refresh: vi.fn(),
      run: vi.fn(),
      isRunning: false,
      isFallback: false,
      fallbackRequestId: null,
    });

    vi.spyOn(replayHookModule, "useReplaySimulation").mockReturnValue({
      status: "ready",
      result: mockReplayResult,
      error: null,
      source: "local-sample",
      refresh: vi.fn(),
    });

    render(
      <ThemeProvider>
        <AuthProvider forceMock={true}>
          <DashboardPage />
        </AuthProvider>
      </ThemeProvider>
    );

    // Verify "No runs yet" banner is present
    expect(screen.getByTestId("dashboard-empty")).toBeDefined();
    expect(screen.getByText("No runs yet")).toBeDefined();

    // Verify the workstation is STILL rendered underneath!
    expect(screen.getByText("BASEL III LIQUIDITY WORKSTATION")).toBeDefined();
    expect(screen.getByTestId("top-bar")).toBeDefined();
    expect(screen.getByText("Available Cash")).toBeDefined();
    expect(screen.getByText(/Required Reserve/i)).toBeDefined();
    expect(screen.getByText("Deployable Surplus")).toBeDefined();
  });

  it("defaults replay hour to the first sweep hour (H17)", async () => {
    vi.spyOn(dashboardHookModule, "useDashboardData").mockReturnValue({
      status: "empty",
      data: null,
      error: null,
      retryAfterSeconds: null,
      refresh: vi.fn(),
      run: vi.fn(),
      isRunning: false,
      isFallback: false,
      fallbackRequestId: null,
    });

    vi.spyOn(replayHookModule, "useReplaySimulation").mockReturnValue({
      status: "ready",
      result: mockReplayResult,
      error: null,
      source: "local-sample",
      refresh: vi.fn(),
    });

    render(
      <ThemeProvider>
        <AuthProvider forceMock={true}>
          <DashboardPage />
        </AuthProvider>
      </ThemeProvider>
    );

    // Replay hour should default to 17 (the first sweep hour in auditLogs)
    await waitFor(() => {
      expect(screen.getByText(/Active Frame H17/i)).toBeDefined();
    });

    // Repo window at 17:00 UTC should be open
    expect(screen.getByText(/REPO SWEEP WINDOW OPEN/i)).toBeDefined();
  });

  it("shows replay error banner and triggers retry on click", () => {
    const mockRefresh = vi.fn();
    vi.spyOn(dashboardHookModule, "useDashboardData").mockReturnValue({
      status: "empty",
      data: null,
      error: null,
      retryAfterSeconds: null,
      refresh: vi.fn(),
      run: vi.fn(),
      isRunning: false,
      isFallback: false,
      fallbackRequestId: null,
    });

    vi.spyOn(replayHookModule, "useReplaySimulation").mockReturnValue({
      status: "error",
      result: null,
      error: "Simulation backend timeout",
      source: "live-api",
      refresh: mockRefresh,
    });

    render(
      <ThemeProvider>
        <AuthProvider forceMock={true}>
          <DashboardPage />
        </AuthProvider>
      </ThemeProvider>
    );

    const errorBanner = screen.getByTestId("replay-error-banner");
    expect(errorBanner).toBeDefined();
    expect(errorBanner.textContent).toContain("Simulation backend timeout");

    const retryBtn = screen.getByRole("button", { name: /retry/i });
    fireEvent.click(retryBtn);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("jumps to first liquidation when the command button is clicked", async () => {
    vi.spyOn(dashboardHookModule, "useDashboardData").mockReturnValue({
      status: "empty",
      data: null,
      error: null,
      retryAfterSeconds: null,
      refresh: vi.fn(),
      run: vi.fn(),
      isRunning: false,
      isFallback: false,
      fallbackRequestId: null,
    });

    vi.spyOn(replayHookModule, "useReplaySimulation").mockReturnValue({
      status: "ready",
      result: mockReplayResult,
      error: null,
      source: "local-sample",
      refresh: vi.fn(),
    });

    render(
      <ThemeProvider>
        <AuthProvider forceMock={true}>
          <DashboardPage />
        </AuthProvider>
      </ThemeProvider>
    );

    // Initial default is H17
    expect(screen.getByText(/Active Frame H17/i)).toBeDefined();

    // Click "Jump to first liquidation" button (at H24)
    const liqBtn = screen.getByRole("button", { name: /First Liquidation/i });
    expect(liqBtn).toBeDefined();
    fireEvent.click(liqBtn);

    // Frame should now be H24
    await waitFor(() => {
      expect(screen.getByText(/Active Frame H24/i)).toBeDefined();
    });
  });
});
