"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useAuth } from "@/lib/firebase/auth-context";
import { apiFetch } from "@/lib/api-client";
import type { DashboardSummaryPayload } from "@/app/api/dashboard/summary/route";

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
  refresh: () => Promise<void>;
  run: (options?: RunEngineOptions) => Promise<boolean>;
  isRunning: boolean;
}

export function useDashboardData(): UseDashboardDataResult {
  const { user, isMock } = useAuth();
  const [internalStatus, setInternalStatus] = useState<DashboardStatus>("loading");
  const [data, setData] = useState<DashboardSummaryPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const isLive = Boolean(user && !isMock);
  const status: DashboardStatus = !isLive ? "unauthenticated" : internalStatus;
  const currentData = !isLive ? null : data;
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

  const fetchSummary = useCallback(async () => {
    if (!isLive) {
      setData(null);
      setError(null);
      return;
    }

    setInternalStatus("loading");
    setError(null);

    try {
      const res = await apiFetch<DashboardSummaryPayload>("/api/dashboard/summary");
      if (unmountedRef.current) return;

      if (res.ok) {
        setData(res.data);
        if (!res.data.decision && !res.data.forecast) {
          setInternalStatus("empty");
        } else {
          setInternalStatus("ready");
        }
      } else {
        setError(res.error.message || "Failed to load dashboard summary");
        setInternalStatus("error");
      }
    } catch (err) {
      if (unmountedRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load dashboard summary");
      setInternalStatus("error");
    }
  }, [isLive]);

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
          if (!res.data.decision && !res.data.forecast) {
            setInternalStatus("empty");
          } else {
            setInternalStatus("ready");
          }
        } else {
          setError(res.error.message || "Failed to load dashboard summary");
          setInternalStatus("error");
        }
      })
      .catch((err) => {
        if (cancelled || unmountedRef.current) return;
        setError(err instanceof Error ? err.message : "Failed to load dashboard summary");
        setInternalStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [isLive]);

  const run = useCallback(
    async (options?: RunEngineOptions): Promise<boolean> => {
      if (!isLive) return false;
      setIsRunning(true);
      setError(null);

      try {
        const res = await apiFetch<DashboardSummaryPayload>("/api/dashboard/run", {
          method: "POST",
          body: JSON.stringify(options ?? { source: "synthetic" }),
        });

        if (unmountedRef.current) return false;

        if (res.ok) {
          setData(res.data);
          setInternalStatus("ready");
          setRetryAfterSeconds(null);
          return true;
        }

        if (res.status === 429) {
          const details = res.error.details as { retryAfterSeconds?: number } | undefined;
          const retrySec = details?.retryAfterSeconds ?? 10;
          setRetryAfterSeconds(retrySec);
          setError(res.error.message || `Rate limited. Please wait ${retrySec}s.`);
          return false;
        }

        setError(res.error.message || "Engine run failed");
        return false;
      } catch (err) {
        if (unmountedRef.current) return false;
        setError(err instanceof Error ? err.message : "Engine run failed");
        return false;
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
    refresh: fetchSummary,
    run,
    isRunning,
  };
}
