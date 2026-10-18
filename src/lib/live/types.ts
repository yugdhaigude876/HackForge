/**
 * Client-side types for the realtime dataset stream. Pure types only: safe to import anywhere.
 */
import type { StreamTick } from "@/engine/live-tick";

export type { StreamTick };

export type ClockStatus = "stopped" | "running" | "completed";

/** Clock document as read from Firestore (orgs/{orgId}/clock/state). */
export interface LiveClock {
  appliedHours: number;
  status: ClockStatus;
  speedHoursPerMinute: number;
  datasetHash: string;
  datasetLength: number;
  lease: { ownerUid: string; untilMs: number } | null;
  startedAtMs: number | null;
  lastTickAtMs: number | null;
  version: number;
  updatedAtMs: number;
}

export type LiveConnection =
  | "connecting"
  | "live"
  | "paused"
  | "completed"
  | "offline"
  | "permission-denied"
  | "empty";

/** Source of live data. The default implementation uses Firestore onSnapshot; tests inject a fake. */
export interface LiveSource {
  subscribeClock(
    orgId: string,
    onNext: (clock: LiveClock | null, meta: { fromCache: boolean }) => void,
    onError: (err: { code?: string; message?: string }) => void
  ): () => void;
  subscribeStream(
    orgId: string,
    limit: number,
    onNext: (ticksNewestFirst: StreamTick[], meta: { fromCache: boolean }) => void,
    onError: (err: { code?: string; message?: string }) => void
  ): () => void;
}

export const STREAM_WINDOW = 168;
