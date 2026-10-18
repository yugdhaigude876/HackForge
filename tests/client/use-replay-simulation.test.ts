// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useReplaySimulation, toBigIntSafe } from "@/hooks/use-replay-simulation";
import * as authContextModule from "@/lib/firebase/auth-context";
import * as apiClientModule from "@/lib/api-client";

describe("toBigIntSafe Helper", () => {
  it("converts numbers, strings, and bigints safely", () => {
    expect(toBigIntSafe(0)).toBe(0n);
    expect(toBigIntSafe(12345)).toBe(12345n);
    expect(toBigIntSafe("5000000000")).toBe(5000000000n);
    expect(toBigIntSafe(42n)).toBe(42n);
  });

  it("throws clear error when number is not a safe integer", () => {
    // 9007199254740992 is 2^53, not safe
    expect(() => toBigIntSafe(9007199254740992)).toThrow(/exceeds JavaScript safe integer range/);
    expect(() => toBigIntSafe(12.34)).toThrow(/exceeds JavaScript safe integer range/);
  });

  it("throws clear error for invalid non-numeric inputs", () => {
    expect(() => toBigIntSafe("invalid_nan")).toThrow(/Failed to parse string/);
    expect(() => toBigIntSafe(null)).toThrow(/invalid type/);
    expect(() => toBigIntSafe(undefined)).toThrow(/invalid type/);
  });
});

describe("useReplaySimulation Hook", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts in loading status and executes pure engine in local-sample mode when signed out", async () => {
    vi.spyOn(authContextModule, "useAuth").mockReturnValue({
      user: null,
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

    const { result } = renderHook(() =>
      useReplaySimulation({
        maxHours: 24,
      })
    );

    // Initial state: loading
    expect(result.current.status).toBe("loading");
    expect(result.current.result).toBeNull();
    expect(result.current.source).toBe("local-sample");

    // Advance 300ms debounce
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current.status).toBe("ready");
    expect(result.current.source).toBe("local-sample");
    expect(result.current.result).not.toBeNull();
    expect(result.current.result!.frames.length).toBeGreaterThan(0);
    expect(typeof result.current.result!.frames[0].requiredReserveMinor).toBe("bigint");
  });

  it("uses apiFetch when user is signed in with a real account", async () => {
    vi.spyOn(authContextModule, "useAuth").mockReturnValue({
      user: { uid: "user-123", email: "trader@bank.internal", displayName: "Trader" },
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

    const mockApiFetch = vi.spyOn(apiClientModule, "apiFetch").mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        summary: {
          totalHoursSimulated: 24,
          grossYieldEarnedUsd: 1000,
        },
        frames: [
          {
            hourIndex: 0,
            timestamp: "2026-01-01T00:00:00Z",
            requiredReserveMinor: "1500000000",
            deployableSurplusMinor: "3500000000",
            portfolio: {
              tier0Cash: { amountMinor: 5000000000, currency: "USD" },
              tier1RepoPrincipal: { amountMinor: 0, currency: "USD" },
            },
          },
        ],
        auditLogs: [],
      },
    });

    const { result } = renderHook(() =>
      useReplaySimulation({
        maxHours: 24,
      })
    );

    expect(result.current.status).toBe("loading");
    expect(result.current.source).toBe("live-api");

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(mockApiFetch).toHaveBeenCalled();
    expect(result.current.status).toBe("ready");
    expect(result.current.source).toBe("live-api");
    expect(result.current.result!.frames[0].requiredReserveMinor).toBe(1500000000n);
    expect(result.current.result!.frames[0].portfolio.tier0Cash.amountMinor).toBe(5000000000n);
  });

  it("surfaces errors when apiFetch fails", async () => {
    vi.spyOn(authContextModule, "useAuth").mockReturnValue({
      user: { uid: "user-123", email: "trader@bank.internal", displayName: "Trader" },
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

    vi.spyOn(apiClientModule, "apiFetch").mockResolvedValue({
      ok: false,
      status: 500,
      error: {
        code: "INTERNAL",
        message: "Simulation engine backend unavailable",
      },
    });

    const { result } = renderHook(() =>
      useReplaySimulation({
        maxHours: 24,
      })
    );

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("Simulation engine backend unavailable");
  });

  it("debounces rapid slider parameter changes (300ms)", async () => {
    vi.spyOn(authContextModule, "useAuth").mockReturnValue({
      user: { uid: "user-123", email: "trader@bank.internal", displayName: "Trader" },
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

    const mockApiFetch = vi.spyOn(apiClientModule, "apiFetch").mockResolvedValue({
      ok: true,
      status: 200,
      data: { summary: {}, frames: [], auditLogs: [] },
    });

    const { rerender } = renderHook(
      ({ shock }) => useReplaySimulation({ outflowShockPct: shock }),
      { initialProps: { shock: 5 } }
    );

    // Fast slider changes at 100ms and 200ms
    act(() => {
      vi.advanceTimersByTime(100);
    });
    rerender({ shock: 15 });

    act(() => {
      vi.advanceTimersByTime(100);
    });
    rerender({ shock: 30 });

    // Has only elapsed 200ms from start, no fetch yet
    expect(mockApiFetch).not.toHaveBeenCalled();

    // Now wait full 300ms after last change
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    const sentBody = JSON.parse(mockApiFetch.mock.calls[0][1]!.body as string);
    expect(sentBody.outflowShockPct).toBe(30);
  });

  it("cancels in-flight requests and timers on unmount", () => {
    vi.spyOn(authContextModule, "useAuth").mockReturnValue({
      user: null,
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

    const { unmount } = renderHook(() => useReplaySimulation());
    unmount();

    // Should not throw or crash after timer advances
    expect(() => {
      act(() => {
        vi.advanceTimersByTime(500);
      });
    }).not.toThrow();
  });
});
