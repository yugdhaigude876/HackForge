// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FallbackBanner } from "@/components/ui/fallback-banner";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import ForecastPage from "@/app/(app)/forecast/page";
import AuditTrailPage from "@/app/(app)/audit/page";
import DigitalTwinPage from "@/app/(app)/twin/page";
import * as apiClientModule from "@/lib/api-client";
import * as authContextModule from "@/lib/firebase/auth-context";
import * as orgRoleModule from "@/hooks/use-org-role";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { DataSourceProvider } from "@/components/providers/data-source-provider";
import type { AuthUser } from "@/lib/firebase/types";

// Mock Recharts
vi.mock("recharts", async () => {
  const actual = await vi.importActual("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 600, height: 300 }}>{children}</div>
    ),
  };
});

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <ThemeProvider>
      <DataSourceProvider>{ui}</DataSourceProvider>
    </ThemeProvider>
  );
}

describe("Part B & C: Fallback Honesty, Banners, Badges, and KPI Grid", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("FallbackBanner component", () => {
    it("renders the exact persistent warning text, requestId, and handles retry clicks", () => {
      const handleRetry = vi.fn();
      render(
        <FallbackBanner
          onRetry={handleRetry}
          requestId="req-test-12345"
          isRetrying={false}
        />
      );

      expect(
        screen.getByText("Live data unavailable. Showing locally generated sample data. Nothing here is saved.")
      ).toBeDefined();
      expect(screen.getByTestId("request-id").textContent).toContain("req-test-12345");

      const retryBtn = screen.getByTestId("fallback-retry-btn");
      fireEvent.click(retryBtn);
      expect(handleRetry).toHaveBeenCalledOnce();
    });
  });

  describe("KpiGrid Simulation Honesty", () => {
    it("renders em-dash with tooltip 'Run the replay to compute' when uncomputed", () => {
      render(
        <KpiGrid
          availableCashMinor={50_000_000_00n}
          requiredReserveMinor={16_500_000_00n}
          deployableSurplusMinor={33_500_000_00n}
          netYieldMinor={34_212_000n}
          isLive={true}
        />
      );

      const uncomputedOd = screen.getByTestId("avoided-overdraft-uncomputed");
      expect(uncomputedOd.textContent).toBe("—");
      expect(uncomputedOd.getAttribute("title")).toBe("Run the replay to compute");

      const uncomputedYield = screen.getByTestId("yield-vs-naive-uncomputed");
      expect(uncomputedYield.textContent).toBe("—");
      expect(uncomputedYield.getAttribute("title")).toBe("Run the replay to compute");
    });

    it("renders formatted numbers and 'Simulated, seed <seed>' when simulation is present", () => {
      render(
        <KpiGrid
          availableCashMinor={50_000_000_00n}
          requiredReserveMinor={16_500_000_00n}
          deployableSurplusMinor={33_500_000_00n}
          netYieldMinor={34_212_000n}
          avoidedOverdraftFeesMinor={120_000_000n}
          yieldEarnedVsNaiveMinor={45_000_000n}
          simulationSeed="test-seed-42"
          isLive={true}
        />
      );

      expect(screen.getAllByText(/\(Simulated, seed test-seed-42\)/).length).toBe(2);
      expect(screen.queryByTestId("avoided-overdraft-uncomputed")).toBeNull();
      expect(screen.queryByTestId("yield-vs-naive-uncomputed")).toBeNull();
    });
  });

  describe("ForecastPage Failure Discrimination", () => {
    it("shows real auth error without fallback data on 401", async () => {
      vi.spyOn(authContextModule, "useAuth").mockReturnValue({
        user: { uid: "user-1", email: "user@test.com" } as AuthUser,
        isMock: false,
        loading: false,
        signOut: vi.fn(),
      } as unknown as ReturnType<typeof authContextModule.useAuth>);

      vi.spyOn(apiClientModule, "apiFetch").mockResolvedValue({
        ok: false,
        status: 401,
        error: { code: "UNAUTHENTICATED", message: "Token expired" },
      });

      renderWithProviders(<ForecastPage />);

      await waitFor(() => {
        expect(screen.getByRole("alert")).toBeDefined();
      });

      expect(screen.getByText(/Authentication required/)).toBeDefined();
      expect(screen.queryByTestId("fallback-banner")).toBeNull();
      expect(screen.queryByTestId("fallback-badge")).toBeNull();
    });

    it("activates honest offline fallback with banner and badge on 500 error", async () => {
      vi.spyOn(authContextModule, "useAuth").mockReturnValue({
        user: { uid: "user-1", email: "user@test.com" } as AuthUser,
        isMock: false,
        loading: false,
        signOut: vi.fn(),
      } as unknown as ReturnType<typeof authContextModule.useAuth>);

      vi.spyOn(apiClientModule, "apiFetch").mockResolvedValue({
        ok: false,
        status: 500,
        requestId: "req-err-500",
        error: { code: "INTERNAL", message: "Server crash" },
      });

      renderWithProviders(<ForecastPage />);

      await waitFor(() => {
        expect(screen.getByTestId("fallback-banner")).toBeDefined();
      });

      expect(screen.getByTestId("fallback-badge").textContent).toBe("Offline fallback");
      expect(screen.getByTestId("request-id").textContent).toContain("req-err-500");
    });
  });

  describe("AuditTrailPage Failure Discrimination", () => {
    it("shows permission error without fallback data on 403", async () => {
      vi.spyOn(authContextModule, "useAuth").mockReturnValue({
        user: { uid: "user-1", email: "user@test.com" } as AuthUser,
        isMock: false,
        loading: false,
        signOut: vi.fn(),
      } as unknown as ReturnType<typeof authContextModule.useAuth>);

      vi.spyOn(apiClientModule, "apiFetch").mockResolvedValue({
        ok: false,
        status: 403,
        error: { code: "FORBIDDEN", message: "Insufficient permissions" },
      });

      renderWithProviders(<AuditTrailPage />);

      await waitFor(() => {
        expect(screen.getByText(/Permission denied/)).toBeDefined();
      });

      expect(screen.queryByTestId("fallback-banner")).toBeNull();
    });

    it("activates honest offline fallback on 500", async () => {
      vi.spyOn(authContextModule, "useAuth").mockReturnValue({
        user: { uid: "user-1", email: "user@test.com" } as AuthUser,
        isMock: false,
        loading: false,
        signOut: vi.fn(),
      } as unknown as ReturnType<typeof authContextModule.useAuth>);

      vi.spyOn(apiClientModule, "apiFetch").mockResolvedValue({
        ok: false,
        status: 500,
        requestId: "req-audit-err",
        error: { code: "INTERNAL", message: "Database unreachable" },
      });

      renderWithProviders(<AuditTrailPage />);

      await waitFor(() => {
        expect(screen.getByTestId("fallback-banner")).toBeDefined();
      });

      expect(screen.getByTestId("fallback-badge").textContent).toBe("Offline fallback");
    });
  });

  describe("TwinPage Viewer Notice", () => {
    it("displays clear message for signed-in viewer in org", () => {
      vi.spyOn(authContextModule, "useAuth").mockReturnValue({
        user: { uid: "viewer-uid", email: "viewer@bank.com" } as AuthUser,
        isMock: false,
        loading: false,
        signOut: vi.fn(),
      } as unknown as ReturnType<typeof authContextModule.useAuth>);

      vi.spyOn(orgRoleModule, "useOrgRole").mockReturnValue({
        role: "viewer",
        loading: false,
        isLive: true,
      });

      renderWithProviders(<DigitalTwinPage />);

      const notice = screen.getByTestId("viewer-role-notice");
      expect(notice.textContent).toContain("You are a viewer in org");
      expect(notice.textContent).toContain("Ask an admin to grant analyst access.");
    });
  });
});
