"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useAuth } from "@/lib/firebase/auth-context";
import { apiFetch } from "@/lib/api-client";
import type {
  DashboardSummaryPayload as ServerDashboardSummaryPayload,
  SerializedDecision,
  SerializedForecast,
} from "@/app/api/dashboard/summary/route";

/** Source labels the client can show. "offline-fallback" never comes from the server. */
export type ClientDataSource = NonNullable<SerializedDecision["source"]> | "offline-fallback";

/** Server payload with the client-only "offline-fallback" source label allowed. */
export type DashboardSummaryPayload = Omit<ServerDashboardSummaryPayload, "decision" | "forecast"> & {
  decision: (Omit<SerializedDecision, "source"> & { source?: ClientDataSource }) | null;
  forecast: (Omit<SerializedForecast, "source"> & { source?: ClientDataSource }) | null;
};

export type DashboardStatus =
  | "loading"
  | "empty"
  | "error"
  | "ready"
  | "unauthenticated";

export interface RunEngineOptions {
  source?: "synthetic" | "live";
  seed?: string;
  horizonHours?: number;
  alpha?: number;
  availableCash?: string | number;
  operationalFloor?: string | number;
}

export interface UseDashboardDataResult {
  status: DashboardStatus;
  data: DashboardSummaryPayload | null;
  error: string | null;
  retryAfterSeconds: number | null;
  isFallback: boolean;
  fallbackRequestId: string | null;
  refresh: () => Promise<void>;
  run: (options?: RunEngineOptions) => Promise<boolean>;
  isRunning: boolean;
}

export const SEEDED_DASHBOARD_PAYLOAD: DashboardSummaryPayload = {
  decision: {
    id: "dec-seeded-live",
    orgId: "org_treasury",
    forecastId: "fc-seeded-2026",
    confidence: 0.99,
    reserveMinor: "1650000000",
    surplusMinor: "3350000000",
    availableCashMinor: "5000000000",
    deployedTotalMinor: "3350000000",
    operationalFloorMinor: "500000000",
    horizonHours: 24,
    alpha: 0.01,
    expectedCumulativeFlowMinor: "120000000",
    worstCaseResidualShortfallMinor: "-1150000000",
    backtest: {
      mase: 0.85,
      sampleSize: 96,
    },
    allocations: [
      {
        instrumentId: "tier1_repo",
        name: "Tier 1: Overnight Repo",
        amountMinor: "1850000000",
        annualRateBps: 429,
        settlementLagHours: 0,
        penaltyBps: 50,
        capacityMinor: "5000000000",
      },
      {
        instrumentId: "tier2_bonds",
        name: "Tier 2: 2Y Sovereign Debt",
        amountMinor: "1000000000",
        annualRateBps: 480,
        settlementLagHours: 1,
        penaltyBps: 200,
        capacityMinor: "3000000000",
      },
      {
        instrumentId: "tier3_equities",
        name: "Tier 3: Growth Equities",
        amountMinor: "500000000",
        annualRateBps: 1000,
        settlementLagHours: 2,
        penaltyBps: 1500,
        capacityMinor: "2000000000",
      },
    ],
    status: "HEALTHY",
    expectedNetYieldMinor: "34212000",
    explanation:
      "Portfolio is healthy under Basel III LCR. $16.5M operational buffer fully covers 99% VaR worst-case outflow. $33.5M surplus deployed across Tiers 1-3.",
    source: "synthetic",
    createdAt: new Date().toISOString(),
    createdBy: "treasury-engine",
  },
  forecast: {
    id: "fc-seeded-2026",
    orgId: "org_treasury",
    method: "Hour-of-Week Empirical Bayes (EWMA)",
    asOf: new Date().toISOString(),
    horizon: 24,
    points: Array.from({ length: 24 }, (_, i) => {
      const mean = Math.round(Math.sin((i / 24) * Math.PI * 2) * 2_000_000 + 500_000);
      return {
        ts: new Date(Date.now() + (i + 1) * 3600_000).toISOString(),
        meanMinor: (mean * 100).toString(),
        bandLowerMinor: ((mean - 650_000) * 100).toString(),
        bandUpperMinor: ((mean + 650_000) * 100).toString(),
      };
    }),
    backtest: {
      mase: 0.85,
      pinball: 1420,
      skillVsBaseline: 0.15,
      sampleSize: 96,
    },
    source: "synthetic",
    createdAt: new Date().toISOString(),
  },
  actuals: Array.from({ length: 24 }, (_, i) => {
    const net = Math.round(Math.sin((i / 24) * Math.PI * 2) * 1_800_000 + 400_000);
    return {
      hour: new Date(Date.now() - (24 - i) * 3600_000).toISOString(),
      netMinor: (net * 100).toString(),
    };
  }),
  userRole: "operator",
};

export const OFFLINE_FALLBACK_DASHBOARD_PAYLOAD: DashboardSummaryPayload = {
  ...SEEDED_DASHBOARD_PAYLOAD,
  decision: {
    ...SEEDED_DASHBOARD_PAYLOAD.decision!,
    source: "offline-fallback",
  },
  forecast: {
    ...SEEDED_DASHBOARD_PAYLOAD.forecast!,
    source: "offline-fallback",
  },
};

export function useDashboardData(): UseDashboardDataResult {
  const { user, isMock } = useAuth();
  const [internalStatus, setInternalStatus] = useState<DashboardStatus>("loading");
  const [data, setData] = useState<DashboardSummaryPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(null);
  const [isFallback, setIsFallback] = useState<boolean>(false);
  const [fallbackRequestId, setFallbackRequestId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const isLive = Boolean(user && !isMock);
  const status: DashboardStatus = !isLive ? "unauthenticated" : internalStatus;
  const currentData = isLive ? data : null;
  const unmountedRef = useRef(false);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  // Countdown timer for rate limiting
  useEffect(() => {
    if (retryAfterSeconds === null || retryAfterSeconds <= 0) return;
    const interval = setInterval(() => {
      setRetryAfterSeconds((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(interval);
          return null;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [retryAfterSeconds]);

  const handleFetchFailure = useCallback((resStatus: number, errObj?: { message?: string; details?: unknown }, reqId?: string) => {
    if (resStatus === 401 || resStatus === 403) {
      const msg = resStatus === 401
        ? "Authentication required. Please sign in with an authorised account to view live telemetry."
        : (errObj?.message || "Permission denied. Please ask an organisation admin for access.");
      setInternalStatus("error");
      setError(msg);
      setData(null);
      setIsFallback(false);
      setFallbackRequestId(null);
      return;
    }

    if (resStatus === 429) {
      const details = errObj?.details as { retryAfterSeconds?: number } | undefined;
      const retrySec = details?.retryAfterSeconds ?? 10;
      setRetryAfterSeconds(retrySec);
      setInternalStatus("error");
      setError(errObj?.message || `Rate limit exceeded. Please wait ${retrySec}s before retrying.`);
      setData(null);
      setIsFallback(false);
      setFallbackRequestId(null);
      return;
    }

    // 5xx / Network / Timeout -> honest offline fallback
    console.warn(`[useDashboardData] Server error (HTTP ${resStatus}), falling back to local engine sample data`);
    setData(OFFLINE_FALLBACK_DASHBOARD_PAYLOAD);
    setInternalStatus("ready");
    setError(null);
    setIsFallback(true);
    setFallbackRequestId(reqId || null);
  }, []);

  const fetchSummary = useCallback(async () => {
    if (!isLive) {
      setInternalStatus("unauthenticated");
      setData(null);
      setError(null);
      setIsFallback(false);
      setFallbackRequestId(null);
      return;
    }

    setInternalStatus("loading");
    setError(null);

    try {
      const res = await apiFetch<DashboardSummaryPayload>("/api/dashboard/summary");
      if (unmountedRef.current) return;

      if (res.ok) {
        setData(res.data);
        setIsFallback(false);
        setFallbackRequestId(null);
        if (!res.data.decision && !res.data.forecast) {
          setInternalStatus("empty");
        } else {
          setInternalStatus("ready");
        }
      } else {
        handleFetchFailure(res.status, res.error, res.requestId);
      }
    } catch (err) {
      if (unmountedRef.current) return;
      handleFetchFailure(500, { message: err instanceof Error ? err.message : "Network error" });
    }
  }, [isLive, handleFetchFailure]);

  // Initial load on mount or auth change
  useEffect(() => {
    if (!isLive) {
      return;
    }

    let cancelled = false;

    apiFetch<DashboardSummaryPayload>("/api/dashboard/summary")
      .then((res) => {
        if (cancelled || unmountedRef.current) return;
        if (res.ok) {
          setData(res.data);
          setIsFallback(false);
          setFallbackRequestId(null);
          if (!res.data.decision && !res.data.forecast) {
            setInternalStatus("empty");
          } else {
            setInternalStatus("ready");
          }
        } else {
          handleFetchFailure(res.status, res.error, res.requestId);
        }
      })
      .catch((err) => {
        if (cancelled || unmountedRef.current) return;
        handleFetchFailure(500, { message: err instanceof Error ? err.message : "Network error" });
      });

    return () => {
      cancelled = true;
    };
  }, [isLive, handleFetchFailure]);

  const run = useCallback(
    async (options?: RunEngineOptions): Promise<boolean> => {
      setIsRunning(true);
      setError(null);

      try {
        if (isLive) {
          const res = await apiFetch<DashboardSummaryPayload>("/api/dashboard/run", {
            method: "POST",
            body: JSON.stringify(options ?? { source: "synthetic" }),
          });

          if (unmountedRef.current) return false;

          if (res.ok) {
            setData(res.data);
            setInternalStatus("ready");
            setRetryAfterSeconds(null);
            setIsFallback(false);
            setFallbackRequestId(null);
            return true;
          }

          if (res.status === 401 || res.status === 403) {
            const msg = res.status === 401
              ? "Authentication required. Please sign in to run the treasury engine."
              : (res.error?.message || "Permission denied. Analyst role required to execute engine.");
            setError(msg);
            return false;
          }

          if (res.status === 429) {
            const details = res.error.details as { retryAfterSeconds?: number } | undefined;
            const retrySec = details?.retryAfterSeconds ?? 10;
            setRetryAfterSeconds(retrySec);
            setError(res.error.message || `Rate limited. Please wait ${retrySec}s.`);
            return false;
          }

          // 5xx on run
          console.warn(`[useDashboardData.run] Server error (HTTP ${res.status}), activating offline fallback`);
          setData(OFFLINE_FALLBACK_DASHBOARD_PAYLOAD);
          setInternalStatus("ready");
          setIsFallback(true);
          setFallbackRequestId(res.requestId || null);
          return true;
        }

        // Offline / demo / fallback run: simulate calculation and update data immediately
        await new Promise((r) => setTimeout(r, 400));
        if (unmountedRef.current) return false;
        setData(SEEDED_DASHBOARD_PAYLOAD);
        setInternalStatus("ready");
        return true;
      } catch (err) {
        if (unmountedRef.current) return false;
        console.warn("[useDashboardData.run] Network exception, activating offline fallback:", err);
        setData(OFFLINE_FALLBACK_DASHBOARD_PAYLOAD);
        setInternalStatus("ready");
        setIsFallback(true);
        setFallbackRequestId(null);
        return true;
      } finally {
        if (!unmountedRef.current) {
          setIsRunning(false);
        }
      }
    },
    [isLive]
  );

  return {
    status,
    data: currentData,
    error,
    retryAfterSeconds,
    isFallback,
    fallbackRequestId,
    refresh: fetchSummary,
    run,
    isRunning,
  };
}
