"use client";

import React, { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/firebase/auth-context";
import { DEFAULT_ORG_ID } from "@/lib/api-client";
import { firestoreLiveSource } from "@/lib/live/firestore-source";
import {
  STREAM_WINDOW,
  type LiveClock,
  type LiveConnection,
  type LiveSource,
  type StreamTick,
} from "@/lib/live/types";

export interface LiveTreasuryValue {
  /** True when the user is signed in with a real account and live listeners are attached. */
  enabled: boolean;
  orgId: string;
  connection: LiveConnection;
  /** True when the connection is down and the data shown may be out of date. */
  stale: boolean;
  clock: LiveClock | null;
  /** Streamed hours, oldest first, at most the last 168. */
  ticks: StreamTick[];
  latest: StreamTick | null;
  lastUpdateAt: number | null;
  error: { code?: string; message?: string } | null;
}

const DISABLED: LiveTreasuryValue = {
  enabled: false,
  orgId: DEFAULT_ORG_ID,
  connection: "empty",
  stale: false,
  clock: null,
  ticks: [],
  latest: null,
  lastUpdateAt: null,
  error: null,
};

const LiveTreasuryContext = createContext<LiveTreasuryValue>(DISABLED);

export interface LiveTreasuryProviderProps {
  children: ReactNode;
  /** Injectable source for tests. Defaults to Firestore realtime listeners. */
  source?: LiveSource;
  /** Override the organisation (defaults to NEXT_PUBLIC_DEFAULT_ORG_ID). */
  orgId?: string;
  /** Force-enable or disable listeners regardless of auth (tests). */
  forceEnabled?: boolean;
}

export function LiveTreasuryProvider({
  children,
  source = firestoreLiveSource,
  orgId = DEFAULT_ORG_ID,
  forceEnabled,
}: LiveTreasuryProviderProps) {
  const { user, isMock } = useAuth();
  const enabled = forceEnabled ?? Boolean(user && !isMock);

  const [clock, setClock] = useState<LiveClock | null>(null);
  const [clockLoaded, setClockLoaded] = useState(false);
  const [clockFromCache, setClockFromCache] = useState(false);
  const [ticksDesc, setTicksDesc] = useState<StreamTick[]>([]);
  const [streamFromCache, setStreamFromCache] = useState(false);
  const [error, setError] = useState<{ code?: string; message?: string } | null>(null);
  const [lastUpdateAt, setLastUpdateAt] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const unsubClock = source.subscribeClock(
      orgId,
      (next, meta) => {
        setClock(next);
        setClockLoaded(true);
        setClockFromCache(meta.fromCache);
        if (!meta.fromCache) {
          setError(null);
          setLastUpdateAt(Date.now());
        }
      },
      (err) => setError(err)
    );
    const unsubStream = source.subscribeStream(
      orgId,
      STREAM_WINDOW,
      (next, meta) => {
        setTicksDesc(next);
        setStreamFromCache(meta.fromCache);
        if (!meta.fromCache) setLastUpdateAt(Date.now());
      },
      (err) => setError(err)
    );

    return () => {
      unsubClock();
      unsubStream();
    };
  }, [enabled, source, orgId]);

  const value = useMemo<LiveTreasuryValue>(() => {
    if (!enabled) return DISABLED;

    const ticks = [...ticksDesc].sort((a, b) => a.hourIndex - b.hourIndex);
    const latest = ticks.length > 0 ? ticks[ticks.length - 1] : null;

    let connection: LiveConnection;
    if (error?.code === "permission-denied") connection = "permission-denied";
    else if (error) connection = "offline";
    else if (!clockLoaded) connection = "connecting";
    else if (clockFromCache && streamFromCache && lastUpdateAt === null) connection = "offline";
    else if (!clock && ticks.length === 0) connection = "empty";
    else if (clock?.status === "completed") connection = "completed";
    else if (clock?.status === "running") connection = "live";
    else connection = "paused";

    return {
      enabled,
      orgId,
      connection,
      stale: connection === "offline",
      clock,
      ticks,
      latest,
      lastUpdateAt,
      error,
    };
  }, [enabled, orgId, ticksDesc, clock, clockLoaded, clockFromCache, streamFromCache, error, lastUpdateAt]);

  return <LiveTreasuryContext.Provider value={value}>{children}</LiveTreasuryContext.Provider>;
}

export function useLiveTreasury(): LiveTreasuryValue {
  return useContext(LiveTreasuryContext);
}

export function useLiveClock(): LiveClock | null {
  return useLiveTreasury().clock;
}

export function useLiveTicks(): StreamTick[] {
  return useLiveTreasury().ticks;
}

export function useLatestTick(): StreamTick | null {
  return useLiveTreasury().latest;
}
