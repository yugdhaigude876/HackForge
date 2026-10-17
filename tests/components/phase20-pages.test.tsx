// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import ForecastPage from "@/app/(app)/forecast/page";
import ReservePage from "@/app/(app)/reserve/page";
import OptimizerPage from "@/app/(app)/optimizer/page";
import AnalyticsPage from "@/app/(app)/analytics/page";
import * as apiClientModule from "@/lib/api-client";
import * as authContextModule from "@/lib/firebase/auth-context";
import type { AuthUser } from "@/lib/firebase/types";

import { ThemeProvider } from "@/components/providers/theme-provider";

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

describe("Phase 20 UI Pages", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("Forecast Page (/forecast)", () => {
    it("renders sample data mode with badge and baseline table when unauthenticated", () => {
      vi.spyOn(authContextModule, "useAuth").mockReturnValue({
        user: null,
        isMock: true,
        loading: false,
        signOut: vi.fn(),
      } as unknown as ReturnType<typeof authContextModule.useAuth>);

      render(
        <ThemeProvider>
          <ForecastPage />
        </ThemeProvider>
      );

      expect(screen.getByText("Forecast & Baselines")).toBeDefined();
      expect(screen.getByTestId("sample-data-badge")).toBeDefined();
      expect(screen.getByText("Demonstration Mode")).toBeDefined();
      expect(screen.getByText("Model versus Baseline Benchmark Matrix")).toBeDefined();
      expect(screen.getByText("Seasonal Naive (Same Hour Last Week, 168h lag)")).toBeDefined();
    });

    it("renders live forecast metrics, residual band, and skill callout when authenticated", async () => {
      vi.spyOn(authContextModule, "useAuth").mockReturnValue({
        user: { uid: "analyst-1", email: "analyst@bank.internal", displayName: "Analyst", isAnonymous: false } as AuthUser,
        isMock: false,
        loading: false,
        signOut: vi.fn(),
      } as unknown as ReturnType<typeof authContextModule.useAuth>);

      vi.spyOn(apiClientModule, "apiFetch").mockResolvedValue({
        ok: true,
        status: 200,
        data: {
          forecastId: "fc_live_1",
          source: "live",
          asOf: "2026-10-18T00:00:00.000Z",
          seed: "live-seed-1",
          method: "Hour-of-Week Smoothing",
          windowCount: 96,
          evaluation: {
            windowCount: 96,
            horizonHours: 24,
            tau: 0.95,
            model: { name: "Hour-of-Week Smoothing", mase: 0.82, pinballLoss: 1250, maeDollars: 16000 },
            naive: { name: "Naive", mase: 1.45, pinballLoss: 2100, maeDollars: 30000 },
            seasonalNaive: { name: "Seasonal Naive", mase: 1.0, pinballLoss: 1600, maeDollars: 22000 },
            skillScores: {
              vsNaive: { mase: { skill: 0.43, isBetter: true }, pinball: { skill: 0.4, isBetter: true }, mae: { skill: 0.46, isBetter: true } },
              vsSeasonalNaive: { mase: { skill: 0.18, isBetter: true }, pinball: { skill: 0.21, isBetter: true }, mae: { skill: 0.27, isBetter: true } },
            },
          },
          residualQuantiles: { "0.05": -20000, "0.95": 20000 },
        },
      });

      render(
        <ThemeProvider>
          <ForecastPage />
        </ThemeProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId("live-data-badge")).toBeDefined();
      });

      expect(screen.getByText(/vs Seasonal Naive/)).toBeDefined();
      expect(screen.getByText("Hour-of-Week Smoothing (Active Model)")).toBeDefined();
    });
  });

  describe("Reserve Page (/reserve)", () => {
    it("renders step-by-step reserve math, standing regulatory caveat, and waterfall chart", () => {
      vi.spyOn(authContextModule, "useAuth").mockReturnValue({
        user: null,
        isMock: true,
        loading: false,
        signOut: vi.fn(),
      } as unknown as ReturnType<typeof authContextModule.useAuth>);

      render(
        <ThemeProvider>
          <ReservePage />
        </ThemeProvider>
      );

      expect(screen.getByText("Liquid Reserve Determination")).toBeDefined();
      expect(screen.getByText(/Standing Regulatory Caveat: Probabilistic Reserve is Not a Guarantee/)).toBeDefined();
      expect(screen.getByText("Step-by-Step Deterministic Reserve Math")).toBeDefined();
      expect(screen.getByText("Expected Cumulative Flow")).toBeDefined();
      expect(screen.getByText("Operational Floor")).toBeDefined();
      expect(screen.getByText("Required Liquid Reserve")).toBeDefined();
    });
  });

  describe("Optimizer Page (/optimizer)", () => {
    it("renders allocation matrix with net unit values, funding reasons, and donut chart", () => {
      vi.spyOn(authContextModule, "useAuth").mockReturnValue({
        user: null,
        isMock: true,
        loading: false,
        signOut: vi.fn(),
      } as unknown as ReturnType<typeof authContextModule.useAuth>);

      render(
        <ThemeProvider>
          <OptimizerPage />
        </ThemeProvider>
      );

      expect(screen.getByText("Surplus Yield Optimizer")).toBeDefined();
      expect(screen.getByText("Instrument Evaluation & Allocation Matrix")).toBeDefined();
      expect(screen.getByText("Overnight Treasury Repo")).toBeDefined();
      expect(screen.getByText("30-Day T-Bill MMF")).toBeDefined();
      expect(screen.getByText("Greedy Surplus Allocation Principles")).toBeDefined();
    });
  });

  describe("Analytics Page (/analytics)", () => {
    it("renders multi-policy comparison aggregates and decision explanation inspector", async () => {
      vi.spyOn(authContextModule, "useAuth").mockReturnValue({
        user: null,
        isMock: true,
        loading: false,
        signOut: vi.fn(),
      } as unknown as ReturnType<typeof authContextModule.useAuth>);

      render(
        <ThemeProvider>
          <AnalyticsPage />
        </ThemeProvider>
      );

      expect(screen.getByText("Analytics & Explainability")).toBeDefined();
      expect(screen.getByText("Forecast Model versus Baseline Accuracy")).toBeDefined();
      expect(screen.getByText("Multi-Policy Simulation Aggregates")).toBeDefined();
      expect(screen.getByText("Decision Audit History & Plain-Language Explanations")).toBeDefined();
    });
  });
});
