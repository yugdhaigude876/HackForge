// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { DecisionStatusCard } from "@/components/finance/decision-status-card";
import DashboardPage from "@/app/(app)/dashboard/page";
import { AuthProvider } from "@/lib/firebase/auth-context";
import * as authContextModule from "@/lib/firebase/auth-context";
import * as apiClientModule from "@/lib/api-client";
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

describe("Dashboard Components & Status Cards", () => {
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

  describe("DashboardPage Mock vs Live Mode", () => {
    it("renders sample data badge and demo banner in mock mode", () => {
      render(
        <ThemeProvider>
          <AuthProvider forceMock={true}>
            <DashboardPage />
          </AuthProvider>
        </ThemeProvider>
      );

      expect(screen.getByTestId("sample-data-badge")).toBeDefined();
      expect(screen.getByText(/Demonstration Mode:/i)).toBeDefined();
      expect(screen.queryByTestId("live-data-badge")).toBeNull();
    });

    it("renders live state with API data when signed in with real account", async () => {
      const mockDecisions = [
        {
          id: "dec_live_123",
          createdAt: new Date().toISOString(),
          status: "HEALTHY" as const,
          reserve: "1500000000",
          surplus: "2500000000",
          confidence: 0.99,
          explanation: "Live evaluation completed",
          allocations: [
            { instrumentId: "inst_1", amount: "2500000000" },
          ],
        },
      ];

      vi.spyOn(authContextModule, "useAuth").mockReturnValue({
        user: {
          uid: "user_real_1",
          email: "treasurer@bank.com",
          displayName: "Real Treasurer",
          photoURL: null,
          isAnonymous: false,
        },
        isMock: false,
        isUnconfigured: false,
        loading: false,
        error: null,
        getIdToken: vi.fn().mockResolvedValue("real-token"),
        signInWithEmail: vi.fn(),
        signUpWithEmail: vi.fn(),
        signInWithGoogle: vi.fn(),
        signInAsDemoUser: vi.fn(),
        signOut: vi.fn(),
        clearError: vi.fn(),
      });

      const apiFetchSpy = vi.spyOn(apiClientModule, "apiFetch").mockResolvedValue({
        ok: true,
        data: mockDecisions,
        status: 200,
      });

      render(
        <ThemeProvider>
          <DashboardPage />
        </ThemeProvider>
      );

      await waitFor(() => {
        expect(apiFetchSpy).toHaveBeenCalledWith("/api/decisions?limit=10");
      });

      expect(screen.getByTestId("live-data-badge")).toBeDefined();
      expect(screen.queryByTestId("sample-data-badge")).toBeNull();
      expect(screen.queryByText(/Demonstration Mode:/i)).toBeNull();
    });
  });
});
