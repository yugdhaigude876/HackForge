"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/firebase/auth-context";
import { apiFetch, type ApiResponse } from "@/lib/api-client";
import { useOrgRole } from "@/hooks/use-org-role";
import { useLiveTreasury } from "@/components/providers/live-treasury-provider";
import type { LiveClock } from "@/lib/live/types";

export const DRIVER_TICK_MS = 1000;
/** Renew the lease at least this often even when no hour is due (slow speeds). */
export const LEASE_RENEW_MS = 10_000;
/** Pause the clock if the driving tab has been hidden this long. */
export const HIDDEN_PAUSE_MS = 60_000;
export const MAX_STEPS_PER_CALL = 24;

export const SPEED_PRESETS: ReadonlyArray<{ label: string; hoursPerMinute: number }> = [
  { label: "1 h / 10 s", hoursPerMinute: 6 },
  { label: "1 h / 5 s", hoursPerMinute: 12 },
  { label: "1 h / s", hoursPerMinute: 60 },
  { label: "6 h / s", hoursPerMinute: 360 },
];

type ClockApiData = { clock: LiveClock };

function clockCodeOf(res: ApiResponse<unknown>): string | undefined {
  if (res.ok) return undefined;
  const details = res.error.details as { clockCode?: string } | undefined;
  return details?.clockCode;
}

export interface ClockControls {
  /** Analyst or admin with live listeners attached. */
  canControl: boolean;
  canReset: boolean;
  /** This session currently holds the clock lease and is the one advancing it. */
  isDriver: boolean;
  busy: boolean;
  error: string | null;
  clearError: () => void;
  start: () => Promise<boolean>;
  pause: () => Promise<boolean>;
  step: () => Promise<boolean>;
  setSpeed: (hoursPerMinute: number) => Promise<boolean>;
  reset: () => Promise<boolean>;
}

export function useClockControls(): ClockControls {
  const { user } = useAuth();
  const { enabled, clock } = useLiveTreasury();
  const { role } = useOrgRole();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canControl = enabled && (role === "analyst" || role === "admin");
  const canReset = enabled && role === "admin";
  const isDriver = Boolean(
    clock?.status === "running" && clock.lease && user && clock.lease.ownerUid === user.uid
  );

  const send = useCallback(async (body: Record<string, unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<ClockApiData>("/api/clock/control", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError(res.error.message || "Clock action failed.");
        return false;
      }
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Clock action failed.");
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    canControl,
    canReset,
    isDriver,
    busy,
    error,
    clearError: () => setError(null),
    start: () => send({ action: "start" }),
    pause: () => send({ action: "pause" }),
    step: () => send({ action: "step" }),
    setSpeed: (hoursPerMinute) => send({ action: "setSpeed", speedHoursPerMinute: hoursPerMinute }),
    reset: () => send({ action: "reset", confirm: true }),
  };
}

export type DriverState = "idle" | "driving" | "backoff";

/**
 * Drives the shared dataset clock for analyst/admin sessions that hold the lease.
 * Mount once (AppShell). Advances at the configured speed while the tab is visible, renews the
 * lease when no hour is due, and stops on pause, lease loss, completion, hidden tab or unmount.
 */
export function useClockDriver(): DriverState {
  const { user } = useAuth();
  const { enabled, clock } = useLiveTreasury();
  const { role } = useOrgRole();
  const [backingOff, setBackingOff] = useState(false);

  const clockRef = useRef<LiveClock | null>(clock);
  useEffect(() => {
    clockRef.current = clock;
  }, [clock]);

  const eligible = Boolean(
    enabled &&
      user &&
      (role === "analyst" || role === "admin") &&
      clock?.status === "running" &&
      clock.lease &&
      clock.lease.ownerUid === user.uid
  );

  useEffect(() => {
    if (!eligible) return;

    let stopped = false;
    let inFlight = false;
    let accumulator = 0;
    let lastContact = Date.now();
    let backoffUntil = 0;
    let hiddenSince: number | null = typeof document !== "undefined" && document.visibilityState === "hidden" ? Date.now() : null;

    const onVisibility = () => {
      hiddenSince = document.visibilityState === "hidden" ? Date.now() : null;
    };
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);

    const tick = async () => {
      if (stopped || inFlight) return;
      const c = clockRef.current;
      if (!c || c.status !== "running") return;
      const now = Date.now();
      if (now < backoffUntil) return;

      // Auto-pause when the driving tab has been hidden too long
      if (hiddenSince !== null) {
        if (now - hiddenSince > HIDDEN_PAUSE_MS) {
          inFlight = true;
          try {
            await apiFetch("/api/clock/control", { method: "POST", body: JSON.stringify({ action: "pause" }) });
          } finally {
            inFlight = false;
          }
          stopped = true;
        }
        return;
      }

      accumulator += c.speedHoursPerMinute / 60;
      const steps = Math.min(MAX_STEPS_PER_CALL, Math.floor(accumulator));

      inFlight = true;
      try {
        let res: ApiResponse<unknown>;
        if (steps >= 1) {
          res = await apiFetch("/api/clock/advance", {
            method: "POST",
            body: JSON.stringify({ steps, expectedHourIndex: c.appliedHours }),
          });
          if (res.ok) {
            accumulator -= steps;
            lastContact = now;
          }
        } else if (now - lastContact >= LEASE_RENEW_MS) {
          res = await apiFetch("/api/clock/control", { method: "POST", body: JSON.stringify({ action: "start" }) });
          if (res.ok) lastContact = now;
        } else {
          return;
        }

        if (!res.ok) {
          const code = clockCodeOf(res);
          if (res.status === 429) {
            const retry = (res.error.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds ?? 5;
            backoffUntil = Date.now() + retry * 1000;
            setBackingOff(true);
          } else if (code === "STALE_INDEX") {
            // The snapshot will deliver the new index; do not advance on a stale view.
            accumulator = Math.max(0, accumulator - steps);
          } else if (code === "LEASE_HELD" || code === "LEASE_REQUIRED" || code === "NOT_RUNNING" || code === "COMPLETED") {
            stopped = true;
            setBackingOff(false);
          } else {
            backoffUntil = Date.now() + 5000;
            setBackingOff(true);
          }
        } else {
          setBackingOff(false);
        }
      } catch {
        backoffUntil = Date.now() + 5000;
        setBackingOff(true);
      } finally {
        inFlight = false;
      }
    };

    const interval = setInterval(tick, DRIVER_TICK_MS);
    return () => {
      stopped = true;
      clearInterval(interval);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [eligible]);

  if (!eligible) return "idle";
  return backingOff ? "backoff" : "driving";
}
