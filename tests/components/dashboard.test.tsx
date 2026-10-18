// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { DecisionStatusCard } from "@/components/finance/decision-status-card";
import DashboardPage from "@/app/(app)/dashboard/page";
import { AuthProvider } from "@/lib/firebase/auth-context";
import * as authContextModule from "@/lib/firebase/auth-context";
import * as dashboardHookModule from "@/hooks/use-dashboard-data";
import { ThemeProvider } from "@/components/providers/theme-provider";

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

describe("Dashboard Components & Status Cards (Phase 17)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("DecisionStatusCard", () => {
    it("renders HEALTHY status with MASE and confidence chips", () => {
      render(
        <DecisionStatusCard
          status="HEALTHY"
          mase={0.85}
          confidence={0.99}
          sample={true}
        />
      );

      const statusEl = screen.getByTestId("decision-status-value");
      expect(statusEl.textContent).toBe("HEALTHY");

      const maseChip = screen.getByTestId("mase-chip");
      expect(maseChip.textContent).toContain("MASE: 0.85");

      const confChip = screen.getByTestId("confidence-chip");
      expect(confChip.textContent).toContain("99% Conf.");

      expect(screen.getByText("Sample")).toBeDefined();
    });

    it("renders UNDER_RESERVED status correctly", () => {
      render(
        <DecisionStatusCard
          status="UNDER_RESERVED"
          confidence={0.95}
        />
      );

      const statusEl = screen.getByTestId("decision-status-value");
      expect(statusEl.textContent).toBe("UNDER_RESERVED");
      expect(screen.getByTestId("confidence-chip").textContent).toContain("95% Conf.");
    });

    it("renders LOW_CONFIDENCE status correctly", () => {
      render(
        <DecisionStatusCard
          status="LOW_CONFIDENCE"
          mase={1.35}
        />
      );

      const statusEl = screen.getByTestId("decision-status-value");
      expect(statusEl.textContent).toBe("LOW_CONFIDENCE");
      expect(screen.getByTestId("mase-chip").textContent).toContain("MASE: 1.35");
    });
  });

  describe("DashboardPage States & Data Binding", () => {
    it("renders sample data badge and demo banner in mock mode", () => {
      vi.spyOn(dashboardHookModule, "useDashboardData").mockReturnValue({
        status: "unauthenticated",
        data: null,
        error: null,
        retryAfterSeconds: null,
        refresh: vi.fn(),
        run: vi.fn(),
        isRunning: false,
        isFallback: false,
        fallbackRequestId: null,
      });

      render(
        <ThemeProvider>
          <AuthProvider forceMock={true}>
            <DashboardPage />
          </AuthProvider>
        </ThemeProvider>
      );

      expect(screen.getByTestId("sample-data-badge")).toBeDefined();
      expect(screen.getAllByText(/Demonstration Mode:/i).length).toBeGreaterThan(0);
      expect(screen.queryByTestId("live-data-badge")).toBeNull();
      expect(screen.queryByTestId("run-engine-button")).toBeNull();
    });

    it("renders loading skeleton state when status is loading", () => {
      vi.spyOn(authContextModule, "useAuth").mockReturnValue({
        user: { uid: "user_1", email: "user@bank.com", displayName: "User" },
        isMock: false,
        isUnconfigured: false,
        loading: false,
        error: null,
        getIdToken: vi.fn(),
        signInWithEmail: vi.fn(),
        signUpWithEmail: vi.fn(),
        signInWithGoogle: vi.fn(),
        signInAsDemoUser: vi.fn(),
        signOut: vi.fn(),
        clearError: vi.fn(),
      });

      vi.spyOn(dashboardHookModule, "useDashboardData").mockReturnValue({
        status: "loading",
        data: null,
        error: null,
        retryAfterSeconds: null,
        refresh: vi.fn(),
        run: vi.fn(),
        isRunning: false,
        isFallback: false,
        fallbackRequestId: null,
      });

      render(
        <ThemeProvider>
          <DashboardPage />
        </ThemeProvider>
      );

      expect(screen.getByTestId("dashboard-loading")).toBeDefined();
    });

    it("renders error state with retry button when status is error", () => {
      vi.spyOn(authContextModule, "useAuth").mockReturnValue({
        user: { uid: "user_1", email: "user@bank.com", displayName: "User" },
        isMock: false,
        isUnconfigured: false,
        loading: false,
        error: null,
        getIdToken: vi.fn(),
        signInWithEmail: vi.fn(),
        signUpWithEmail: vi.fn(),
        signInWithGoogle: vi.fn(),
        signInAsDemoUser: vi.fn(),
        signOut: vi.fn(),
        clearError: vi.fn(),
      });

      const refreshSpy = vi.fn();
      vi.spyOn(dashboardHookModule, "useDashboardData").mockReturnValue({
        status: "error",
        data: null,
        error: "Failed to connect to treasury backend",
        retryAfterSeconds: null,
        refresh: refreshSpy,
        run: vi.fn(),
        isRunning: false,
        isFallback: false,
        fallbackRequestId: null,
      });

      render(
        <ThemeProvider>
          <DashboardPage />
        </ThemeProvider>
      );

      expect(screen.getByTestId("dashboard-error")).toBeDefined();
      expect(screen.getByText("Failed to connect to treasury backend")).toBeDefined();
    });

    it("renders empty state with Run button for analyst when no runs exist", () => {
      vi.spyOn(authContextModule, "useAuth").mockReturnValue({
        user: { uid: "user_1", email: "analyst@bank.com", displayName: "Analyst" },
        isMock: false,
        isUnconfigured: false,
        loading: false,
        error: null,
        getIdToken: vi.fn(),
        signInWithEmail: vi.fn(),
        signUpWithEmail: vi.fn(),
        signInWithGoogle: vi.fn(),
        signInAsDemoUser: vi.fn(),
        signOut: vi.fn(),
        clearError: vi.fn(),
      });

      const runSpy = vi.fn();
      vi.spyOn(dashboardHookModule, "useDashboardData").mockReturnValue({
        status: "empty",
        data: { decision: null, forecast: null, actuals: [], userRole: "analyst" },
        error: null,
        retryAfterSeconds: null,
        refresh: vi.fn(),
        run: runSpy,
        isRunning: false,
        isFallback: false,
        fallbackRequestId: null,
      });

      render(
        <ThemeProvider>
          <DashboardPage />
        </ThemeProvider>
      );

      expect(screen.getByTestId("dashboard-empty")).toBeDefined();
      expect(screen.getByText("No runs yet")).toBeDefined();
      expect(screen.getAllByRole("button", { name: /run engine/i }).length).toBeGreaterThan(0);
    });

    it("hides Run engine button when user role is viewer", () => {
      vi.spyOn(authContextModule, "useAuth").mockReturnValue({
        user: { uid: "viewer_1", email: "viewer@bank.com", displayName: "Viewer" },
        isMock: false,
        isUnconfigured: false,
        loading: false,
        error: null,
        getIdToken: vi.fn(),
        signInWithEmail: vi.fn(),
        signUpWithEmail: vi.fn(),
        signInWithGoogle: vi.fn(),
        signInAsDemoUser: vi.fn(),
        signOut: vi.fn(),
        clearError: vi.fn(),
      });

      vi.spyOn(dashboardHookModule, "useDashboardData").mockReturnValue({
        status: "empty",
        data: { decision: null, forecast: null, actuals: [], userRole: "viewer" },
        error: null,
        retryAfterSeconds: null,
        refresh: vi.fn(),
        run: vi.fn(),
        isRunning: false,
        isFallback: false,
        fallbackRequestId: null,
      });

      render(
        <ThemeProvider>
          <DashboardPage />
        </ThemeProvider>
      );

      expect(screen.queryByTestId("run-engine-button")).toBeNull();
    });

    it("renders live state with stored cash, MASE chip, and real instrument names", () => {
      vi.spyOn(authContextModule, "useAuth").mockReturnValue({
        user: { uid: "user_real_1", email: "treasurer@bank.com", displayName: "Real Treasurer" },
        isMock: false,
        isUnconfigured: false,
        loading: false,
        error: null,
        getIdToken: vi.fn(),
        signInWithEmail: vi.fn(),
        signUpWithEmail: vi.fn(),
        signInWithGoogle: vi.fn(),
        signInAsDemoUser: vi.fn(),
        signOut: vi.fn(),
        clearError: vi.fn(),
      });

      const mockLiveSummary = {
        decision: {
          id: "dec_live_789",
          orgId: "org_treasury",
          forecastId: "fc_live_789",
          confidence: 0.99,
          reserveMinor: "1500000000", // $15M
          surplusMinor: "3500000000", // $35M
          availableCashMinor: "6000000000", // Stored $60M (NOT derived from 15M+35M)
          deployedTotalMinor: "0",
          operationalFloorMinor: "1000000000",
          horizonHours: 24,
          alpha: 0.01,
          expectedCumulativeFlowMinor: "200000000",
          worstCaseResidualShortfallMinor: "-300000000",
          backtest: { mase: 0.77, sampleSize: 42 },
          allocations: [
            {
              instrumentId: "inst_fed_repo",
              name: "Fed Overnight Repo",
              amountMinor: "3500000000",
              annualRateBps: 535,
              settlementLagHours: 0,
              penaltyBps: 0,
              capacityMinor: "5000000000",
            },
          ],
          status: "HEALTHY",
          expectedNetYieldMinor: "4500000",
          explanation: "Live decision healthy",
          source: "synthetic" as const,
          createdAt: new Date().toISOString(),
          createdBy: "user-1",
        },
        forecast: {
          id: "fc_live_789",
          orgId: "org_treasury",
          method: "hour_of_week",
          asOf: new Date().toISOString(),
          horizon: 24,
          points: [
            {
              ts: new Date().toISOString(),
              meanMinor: "120000000",
              bandLowerMinor: "90000000",
              bandUpperMinor: "150000000",
            },
          ],
          backtest: { mase: 0.77, pinball: 0.04, sampleSize: 42 },
          source: "synthetic" as const,
          createdAt: new Date().toISOString(),
        },
        actuals: [
          { hour: new Date().toISOString(), netMinor: "50000000" },
        ],
        userRole: "analyst",
      };

      vi.spyOn(dashboardHookModule, "useDashboardData").mockReturnValue({
        status: "ready",
        data: mockLiveSummary,
        error: null,
        retryAfterSeconds: null,
        refresh: vi.fn(),
        run: vi.fn(),
        isRunning: false,
        isFallback: false,
        fallbackRequestId: null,
      });

      render(
        <ThemeProvider>
          <DashboardPage />
        </ThemeProvider>
      );

      // 1. Shows Synthetic source badge since source: "synthetic"
      expect(screen.getByTestId("synthetic-source-badge")).toBeDefined();
      expect(screen.queryByTestId("sample-data-badge")).toBeNull();

      // 2. Available Cash displays stored cash ($60.0M), NOT reserve+surplus ($50.0M)
      expect(screen.getByText("$60.0M")).toBeDefined();

      // 3. Status card renders MASE chip from stored backtest (MASE: 0.77)
      expect(screen.getByTestId("mase-chip").textContent).toContain("MASE: 0.77");

      // 4. Instruments table renders real instrument name
      expect(screen.getByText("Fed Overnight Repo")).toBeDefined();

      // 5. Run engine button is visible for analyst
      expect(screen.getByTestId("run-engine-button")).toBeDefined();
    });
  });
});
