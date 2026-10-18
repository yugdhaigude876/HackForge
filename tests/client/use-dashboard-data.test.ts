// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useDashboardData } from "@/hooks/use-dashboard-data";
import * as authContextModule from "@/lib/firebase/auth-context";
import * as apiClientModule from "@/lib/api-client";

describe("useDashboardData Hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets status to 'unauthenticated' in mock mode without making network calls", () => {
    vi.spyOn(authContextModule, "useAuth").mockReturnValue({
      user: {
        uid: "mock-user-analyst",
        email: "analyst@bank.internal",
        displayName: "Mock Analyst",
        photoURL: null,
      },
      isMock: true,
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

    const apiFetchSpy = vi.spyOn(apiClientModule, "apiFetch");

    const { result } = renderHook(() => useDashboardData());

    expect(result.current.status).toBe("unauthenticated");
    expect(result.current.data).toBeNull();
    expect(apiFetchSpy).not.toHaveBeenCalled();
  });

  it("loads summary data and transitions to 'ready' when decision exists", async () => {
    vi.spyOn(authContextModule, "useAuth").mockReturnValue({
      user: {
        uid: "real-user-1",
        email: "user@bank.com",
        displayName: "Real User",
      },
      isMock: false,
      isUnconfigured: false,
      loading: false,
      error: null,
      getIdToken: vi.fn().mockResolvedValue("token"),
      signInWithEmail: vi.fn(),
      signUpWithEmail: vi.fn(),
      signInWithGoogle: vi.fn(),
      signInAsDemoUser: vi.fn(),
      signOut: vi.fn(),
      clearError: vi.fn(),
    });

    const mockSummary = {
      decision: {
        id: "dec_100",
        orgId: "org_demo",
        forecastId: "fc_100",
        confidence: 0.99,
        reserveMinor: "1500000000",
        surplusMinor: "3500000000",
        availableCashMinor: "5000000000",
        deployedTotalMinor: "0",
        operationalFloorMinor: "1000000000",
        horizonHours: 24,
        alpha: 0.01,
        expectedCumulativeFlowMinor: "0",
        worstCaseResidualShortfallMinor: "0",
        backtest: { mase: 0.85, sampleSize: 30 },
        allocations: [],
        status: "HEALTHY",
        expectedNetYieldMinor: "0",
        explanation: "OK",
        createdAt: new Date().toISOString(),
        createdBy: "user-1",
      },
      forecast: null,
      actuals: [],
      userRole: "analyst",
    };

    vi.spyOn(apiClientModule, "apiFetch").mockResolvedValue({
      ok: true,
      data: mockSummary,
      status: 200,
    });

    const { result } = renderHook(() => useDashboardData());

    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });

    expect(result.current.data?.decision?.id).toBe("dec_100");
    expect(result.current.data?.userRole).toBe("analyst");
  });

  it("transitions to 'empty' when summary has no decision and no forecast", async () => {
    vi.spyOn(authContextModule, "useAuth").mockReturnValue({
      user: { uid: "user-1", email: "u@b.com", displayName: "User" },
      isMock: false,
      isUnconfigured: false,
      loading: false,
      error: null,
      getIdToken: vi.fn().mockResolvedValue("token"),
      signInWithEmail: vi.fn(),
      signUpWithEmail: vi.fn(),
      signInWithGoogle: vi.fn(),
      signInAsDemoUser: vi.fn(),
      signOut: vi.fn(),
      clearError: vi.fn(),
    });

    vi.spyOn(apiClientModule, "apiFetch").mockResolvedValue({
      ok: true,
      data: { decision: null, forecast: null, actuals: [], userRole: "analyst" },
      status: 200,
    });

    const { result } = renderHook(() => useDashboardData());

    await waitFor(() => {
      expect(result.current.status).toBe("empty");
    });

    expect(result.current.data?.decision).toBeNull();
  });

  it("sets 'error' state when summary fetch fails with 429 rate limit", async () => {
    vi.spyOn(authContextModule, "useAuth").mockReturnValue({
      user: { uid: "user-1", email: "u@b.com", displayName: "User" },
      isMock: false,
      isUnconfigured: false,
      loading: false,
      error: null,
      getIdToken: vi.fn().mockResolvedValue("token"),
      signInWithEmail: vi.fn(),
      signUpWithEmail: vi.fn(),
      signInWithGoogle: vi.fn(),
      signInAsDemoUser: vi.fn(),
      signOut: vi.fn(),
      clearError: vi.fn(),
    });

    vi.spyOn(apiClientModule, "apiFetch").mockResolvedValue({
      ok: false,
      error: { code: "RATE_LIMITED", message: "Rate limit exceeded" },
      status: 429,
    });

    const { result } = renderHook(() => useDashboardData());

    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });

    expect(result.current.error).toContain("Rate limit");
  });

  it("activates honest offline fallback when summary fetch fails with 500", async () => {
    vi.spyOn(authContextModule, "useAuth").mockReturnValue({
      user: { uid: "user-1", email: "u@b.com", displayName: "User" },
      isMock: false,
      isUnconfigured: false,
      loading: false,
      error: null,
      getIdToken: vi.fn().mockResolvedValue("token"),
      signInWithEmail: vi.fn(),
      signUpWithEmail: vi.fn(),
      signInWithGoogle: vi.fn(),
      signInAsDemoUser: vi.fn(),
      signOut: vi.fn(),
      clearError: vi.fn(),
    });

    vi.spyOn(apiClientModule, "apiFetch").mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL", message: "Database connection failed" },
      status: 500,
      requestId: "req-dash-500",
    });

    const { result } = renderHook(() => useDashboardData());

    await waitFor(() => {
      expect(result.current.isFallback).toBe(true);
    });

    expect(result.current.status).toBe("ready");
    expect(result.current.data?.decision?.source).toBe("offline-fallback");
    expect(result.current.fallbackRequestId).toBe("req-dash-500");
  });

  it("run() calls POST /api/dashboard/run and updates state to ready on success", async () => {
    vi.spyOn(authContextModule, "useAuth").mockReturnValue({
      user: { uid: "user-1", email: "u@b.com", displayName: "User" },
      isMock: false,
      isUnconfigured: false,
      loading: false,
      error: null,
      getIdToken: vi.fn().mockResolvedValue("token"),
      signInWithEmail: vi.fn(),
      signUpWithEmail: vi.fn(),
      signInWithGoogle: vi.fn(),
      signInAsDemoUser: vi.fn(),
      signOut: vi.fn(),
      clearError: vi.fn(),
    });

    const emptySummary = { decision: null, forecast: null, actuals: [], userRole: "analyst" };
    const ranSummary = {
      decision: {
        id: "dec_new",
        orgId: "org_demo",
        forecastId: "fc_new",
        confidence: 0.99,
        reserveMinor: "1000",
        surplusMinor: "2000",
        availableCashMinor: "3000",
        deployedTotalMinor: "0",
        operationalFloorMinor: "500",
        horizonHours: 24,
        alpha: 0.01,
        expectedCumulativeFlowMinor: "0",
        worstCaseResidualShortfallMinor: "0",
        backtest: { mase: 0.79, sampleSize: 32 },
        allocations: [],
        status: "HEALTHY",
        expectedNetYieldMinor: "0",
        explanation: "Run complete",
        createdAt: new Date().toISOString(),
        createdBy: "user-1",
      },
      forecast: null,
      actuals: [],
      userRole: "analyst",
    };

    const fetchSpy = vi.spyOn(apiClientModule, "apiFetch")
      .mockResolvedValueOnce({ ok: true, data: emptySummary, status: 200 })
      .mockResolvedValueOnce({ ok: true, data: ranSummary, status: 200 });

    const { result } = renderHook(() => useDashboardData());

    await waitFor(() => {
      expect(result.current.status).toBe("empty");
    });

    let success: boolean = false;
    await act(async () => {
      success = await result.current.run({ source: "synthetic" });
    });

    expect(success).toBe(true);
    expect(result.current.status).toBe("ready");
    expect(result.current.data?.decision?.id).toBe("dec_new");
    expect(fetchSpy).toHaveBeenCalledWith("/api/dashboard/run", expect.objectContaining({
      method: "POST",
    }));
  });

  it("handles unmount cancellation gracefully", () => {
    vi.spyOn(authContextModule, "useAuth").mockReturnValue({
      user: { uid: "user-1", email: "u@b.com", displayName: "User" },
      isMock: false,
      isUnconfigured: false,
      loading: false,
      error: null,
      getIdToken: vi.fn().mockResolvedValue("token"),
      signInWithEmail: vi.fn(),
      signUpWithEmail: vi.fn(),
      signInWithGoogle: vi.fn(),
      signInAsDemoUser: vi.fn(),
      signOut: vi.fn(),
      clearError: vi.fn(),
    });

    vi.spyOn(apiClientModule, "apiFetch").mockReturnValue(
      new Promise(() => {}) // never resolves
    );

    const { unmount } = renderHook(() => useDashboardData());
    expect(() => unmount()).not.toThrow();
  });
});
