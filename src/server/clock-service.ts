import "server-only";

import { Money } from "@/engine/money";
import { treasuryRecordToHourlyBucket } from "@/engine/dataset";
import {
  DEFAULT_ALLOCATION_WEIGHTS,
  applyStressShocks,
  createTreasuryState,
  deserializeTreasuryState,
  serializeTreasuryState,
  stepTreasury,
  type StepContext,
} from "@/engine/treasury-step";
import {
  buildStreamTick,
  emptyAccuracyTracker,
  recordOneStepError,
  type AccuracyTracker,
  type StreamTick,
} from "@/engine/live-tick";
import { datasetHash, getDatasetLength, getDatasetRow } from "@/server/dataset";
import { getAdminFirestore } from "@/server/firebase-admin";
import { validateId } from "@/server/repositories/common";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const LEASE_MS = 30_000;
export const MAX_STEPS_PER_ADVANCE = 24;
export const MIN_SPEED_HOURS_PER_MINUTE = 1;
export const MAX_SPEED_HOURS_PER_MINUTE = 1440;
export const DEFAULT_SPEED_HOURS_PER_MINUTE = 12;
export const CRON_OWNER_UID = "system:cron";

const INITIAL_CASH = Money.fromDecimal(50_000_000, "USD");
const OPERATIONAL_FLOOR = Money.fromDecimal(5_000_000, "USD");
const ALPHA = 0.01;
const HORIZON_HOURS = 24;

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export type ClockStatus = "stopped" | "running" | "completed";

export interface ClockLease {
  ownerUid: string;
  untilMs: number;
}

/** orgs/{orgId}/clock/state. Readable by org members. */
export interface ClockDoc {
  /** Number of dataset hours already applied (0 = none). The next row to apply is this index. */
  appliedHours: number;
  status: ClockStatus;
  speedHoursPerMinute: number;
  datasetHash: string;
  datasetLength: number;
  lease: ClockLease | null;
  startedAtMs: number | null;
  lastTickAtMs: number | null;
  version: number;
  updatedAtMs: number;
}

/** orgs/{orgId}/engine/state. Server only (rules deny all client access). */
export interface EngineDoc {
  appliedHours: number;
  stateJson: string;
  accuracyJson: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type ClockErrorCode =
  | "NOT_RUNNING"
  | "LEASE_REQUIRED"
  | "LEASE_HELD"
  | "STALE_INDEX"
  | "COMPLETED"
  | "INVALID"
  | "CONFIRM_REQUIRED"
  | "FORBIDDEN"
  | "INCONSISTENT";

export class ClockError extends Error {
  readonly code: ClockErrorCode;
  readonly status: number;
  readonly clock?: ClockDoc;

  constructor(code: ClockErrorCode, message: string, status: number, clock?: ClockDoc) {
    super(message);
    this.name = "ClockError";
    this.code = code;
    this.status = status;
    this.clock = clock;
  }
}

// ---------------------------------------------------------------------------
// Storage abstraction
// ---------------------------------------------------------------------------

export interface ClockTx {
  getClock(): Promise<ClockDoc | null>;
  getEngine(): Promise<EngineDoc | null>;
  setClock(doc: ClockDoc): void;
  setEngine(doc: EngineDoc): void;
  setStream(hourIndex: number, tick: StreamTick): void;
}

export interface ClockStore {
  runTransaction<T>(orgId: string, fn: (tx: ClockTx) => Promise<T>): Promise<T>;
  /** Deletes clock, engine and every stream document for the org. Returns deleted stream count. */
  resetOrg(orgId: string): Promise<number>;
  /** Org ids whose clock status is "running". */
  listRunningOrgIds(limit: number): Promise<string[]>;
}

export const streamDocId = (hourIndex: number): string => String(hourIndex).padStart(5, "0");

/** Firestore rejects undefined values; round-trip through JSON to drop them. */
const clean = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export class FirestoreClockStore implements ClockStore {
  async runTransaction<T>(orgId: string, fn: (tx: ClockTx) => Promise<T>): Promise<T> {
    validateId(orgId, "orgId");
    const db = getAdminFirestore();
    const base = `orgs/${orgId}`;
    return db.runTransaction(async (t) => {
      const clockRef = db.doc(`${base}/clock/state`);
      const engineRef = db.doc(`${base}/engine/state`);
      const tx: ClockTx = {
        async getClock() {
          const snap = await t.get(clockRef);
          return snap.exists ? (snap.data() as ClockDoc) : null;
        },
        async getEngine() {
          const snap = await t.get(engineRef);
          return snap.exists ? (snap.data() as EngineDoc) : null;
        },
        setClock(doc) {
          t.set(clockRef, clean(doc));
        },
        setEngine(doc) {
          t.set(engineRef, clean(doc));
        },
        setStream(hourIndex, tick) {
          t.set(db.doc(`${base}/stream/${streamDocId(hourIndex)}`), clean(tick));
        },
      };
      return fn(tx);
    });
  }

  async resetOrg(orgId: string): Promise<number> {
    validateId(orgId, "orgId");
    const db = getAdminFirestore();
    const base = `orgs/${orgId}`;
    let deleted = 0;
    // Delete stream docs in bounded batches
    for (;;) {
      const snap = await db.collection(`${base}/stream`).limit(400).get();
      if (snap.empty) break;
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      deleted += snap.size;
    }
    await db.doc(`${base}/engine/state`).delete();
    await db.doc(`${base}/clock/state`).delete();
    return deleted;
  }

  async listRunningOrgIds(limit: number): Promise<string[]> {
    const db = getAdminFirestore();
    const snap = await db.collectionGroup("clock").where("status", "==", "running").limit(limit).get();
    return snap.docs
      .map((d) => d.ref.parent.parent?.id)
      .filter((id): id is string => typeof id === "string");
  }
}

/** In-memory store with all-or-nothing transactions. Used by tests. */
export class MemoryClockStore implements ClockStore {
  readonly clocks = new Map<string, ClockDoc>();
  readonly engines = new Map<string, EngineDoc>();
  readonly streams = new Map<string, Map<number, StreamTick>>();

  async runTransaction<T>(orgId: string, fn: (tx: ClockTx) => Promise<T>): Promise<T> {
    validateId(orgId, "orgId");
    let pendingClock: ClockDoc | undefined;
    let pendingEngine: EngineDoc | undefined;
    const pendingStream = new Map<number, StreamTick>();
    const tx: ClockTx = {
      getClock: async () => this.clocks.get(orgId) ?? null,
      getEngine: async () => this.engines.get(orgId) ?? null,
      setClock: (doc) => {
        pendingClock = clean(doc);
      },
      setEngine: (doc) => {
        pendingEngine = clean(doc);
      },
      setStream: (h, tick) => {
        pendingStream.set(h, clean(tick));
      },
    };
    const result = await fn(tx);
    // Commit only after the callback succeeded
    if (pendingClock) this.clocks.set(orgId, pendingClock);
    if (pendingEngine) this.engines.set(orgId, pendingEngine);
    if (pendingStream.size > 0) {
      const existing = this.streams.get(orgId) ?? new Map<number, StreamTick>();
      pendingStream.forEach((tick, h) => existing.set(h, tick));
      this.streams.set(orgId, existing);
    }
    return result;
  }

  async resetOrg(orgId: string): Promise<number> {
    const count = this.streams.get(orgId)?.size ?? 0;
    this.streams.delete(orgId);
    this.engines.delete(orgId);
    this.clocks.delete(orgId);
    return count;
  }

  async listRunningOrgIds(limit: number): Promise<string[]> {
    return [...this.clocks.entries()]
      .filter(([, c]) => c.status === "running")
      .map(([id]) => id)
      .slice(0, limit);
  }
}

let activeStore: ClockStore | null = null;

export function setClockStore(store: ClockStore | null): void {
  activeStore = store;
}

function store(): ClockStore {
  if (!activeStore) activeStore = new FirestoreClockStore();
  return activeStore;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function initialClock(nowMs: number): ClockDoc {
  return {
    appliedHours: 0,
    status: "stopped",
    speedHoursPerMinute: DEFAULT_SPEED_HOURS_PER_MINUTE,
    datasetHash,
    datasetLength: getDatasetLength(),
    lease: null,
    startedAtMs: null,
    lastTickAtMs: null,
    version: 0,
    updatedAtMs: nowMs,
  };
}

const leaseActive = (lease: ClockLease | null, nowMs: number): lease is ClockLease =>
  lease !== null && lease.untilMs > nowMs;

const stepContext: StepContext = {
  policy: "reserve-juggler",
  operationalFloor: OPERATIONAL_FLOOR,
  horizonHours: HORIZON_HOURS,
  alpha: ALPHA,
  weights: DEFAULT_ALLOCATION_WEIGHTS,
};

/** Reads the clock, returning the initial stopped clock when none exists yet. */
export async function readClock(orgId: string, nowMs: number): Promise<ClockDoc> {
  return store().runTransaction(orgId, async (tx) => (await tx.getClock()) ?? initialClock(nowMs));
}

// ---------------------------------------------------------------------------
// Advance
// ---------------------------------------------------------------------------

export interface AdvanceArgs {
  orgId: string;
  uid: string;
  steps?: number;
  /** Optimistic check: the caller's view of `appliedHours`. Mismatch yields STALE_INDEX. */
  expectedHourIndex?: number;
  nowMs: number;
  /** Cron acts as a system driver and does not need to hold the client lease. */
  asCron?: boolean;
  /** Allows a manual single step while the clock is stopped (used by the "step" control). */
  allowWhileStopped?: boolean;
}

export interface AdvanceResult {
  clock: ClockDoc;
  applied: number;
  ticks: StreamTick[];
}

/**
 * Advances the org clock by up to `steps` dataset hours in ONE transaction: stream documents,
 * engine state and clock state commit together or not at all.
 */
export async function advanceClock(args: AdvanceArgs): Promise<AdvanceResult> {
  const { orgId, uid, nowMs } = args;
  const requested = args.steps ?? 1;
  if (!Number.isInteger(requested) || requested < 1 || requested > MAX_STEPS_PER_ADVANCE) {
    throw new ClockError("INVALID", `steps must be an integer from 1 to ${MAX_STEPS_PER_ADVANCE}.`, 400);
  }

  return store().runTransaction(orgId, async (tx) => {
    const clock = (await tx.getClock()) ?? initialClock(nowMs);

    if (clock.status === "completed") {
      throw new ClockError("COMPLETED", "The dataset is fully streamed. Reset the clock to run it again.", 409, clock);
    }
    if (clock.status !== "running" && !args.allowWhileStopped) {
      throw new ClockError("NOT_RUNNING", "The clock is not running.", 409, clock);
    }
    if (args.expectedHourIndex !== undefined && args.expectedHourIndex !== clock.appliedHours) {
      throw new ClockError("STALE_INDEX", "The clock has moved since your last update.", 409, clock);
    }
    if (clock.status === "running" && !args.asCron) {
      if (!leaseActive(clock.lease, nowMs) || clock.lease.ownerUid !== uid) {
        throw new ClockError(
          clock.lease && leaseActive(clock.lease, nowMs) ? "LEASE_HELD" : "LEASE_REQUIRED",
          "Another session drives this clock, or your lease expired. Start the clock to take over.",
          409,
          clock
        );
      }
    }

    const total = getDatasetLength();
    const remaining = total - clock.appliedHours;
    const steps = Math.min(requested, remaining);

    const engineDoc = await tx.getEngine();
    if (engineDoc && engineDoc.appliedHours !== clock.appliedHours) {
      throw new ClockError("INCONSISTENT", "Engine state and clock are out of sync.", 409, clock);
    }
    if (!engineDoc && clock.appliedHours !== 0) {
      throw new ClockError("INCONSISTENT", "Engine state is missing for a clock that has advanced.", 409, clock);
    }

    const state = engineDoc
      ? deserializeTreasuryState(JSON.parse(engineDoc.stateJson))
      : createTreasuryState(INITIAL_CASH);
    const tracker: AccuracyTracker = engineDoc ? JSON.parse(engineDoc.accuracyJson) : emptyAccuracyTracker();

    const ticks: StreamTick[] = [];
    for (let i = 0; i < steps; i++) {
      const hourIndex = clock.appliedHours + i;
      const raw = getDatasetRow(hourIndex);
      if (!raw) throw new ClockError("INCONSISTENT", `Dataset row ${hourIndex} is missing.`, 500, clock);
      const record = applyStressShocks(raw);

      const actualNet = treasuryRecordToHourlyBucket(record).netFlow.amountMinor;
      recordOneStepError(tracker, state.historyBuckets, actualNet);

      const { frame } = stepTreasury(state, record, hourIndex, stepContext);
      const tick = buildStreamTick({
        frame,
        record,
        state,
        tracker,
        operationalFloor: OPERATIONAL_FLOOR,
        alpha: ALPHA,
        nowMs,
      });
      tx.setStream(hourIndex, tick);
      ticks.push(tick);
    }

    const appliedHours = clock.appliedHours + steps;
    tx.setEngine({
      appliedHours,
      stateJson: JSON.stringify(serializeTreasuryState(state)),
      accuracyJson: JSON.stringify(tracker),
    });

    const completed = appliedHours >= total;
    const nextClock: ClockDoc = {
      ...clock,
      appliedHours,
      status: completed ? "completed" : clock.status,
      lease: completed || clock.status !== "running" ? null : args.asCron ? clock.lease : { ownerUid: uid, untilMs: nowMs + LEASE_MS },
      lastTickAtMs: nowMs,
      version: clock.version + 1,
      updatedAtMs: nowMs,
    };
    tx.setClock(nextClock);

    return { clock: nextClock, applied: steps, ticks };
  });
}

// ---------------------------------------------------------------------------
// Control
// ---------------------------------------------------------------------------

export type ClockAction = "start" | "pause" | "setSpeed" | "step" | "reset";
export type ClockRole = "viewer" | "analyst" | "admin";

export interface ControlArgs {
  orgId: string;
  uid: string;
  role: ClockRole;
  action: ClockAction;
  speedHoursPerMinute?: number;
  confirm?: boolean;
  nowMs: number;
}

export interface ControlResult {
  clock: ClockDoc;
  /** Number of stream documents removed by a reset. */
  deletedStream?: number;
}

export async function controlClock(args: ControlArgs): Promise<ControlResult> {
  const { orgId, uid, role, action, nowMs } = args;

  if (role === "viewer") {
    throw new ClockError("FORBIDDEN", "Viewers cannot control the clock.", 403);
  }

  if (action === "reset") {
    if (role !== "admin") throw new ClockError("FORBIDDEN", "Only admins can reset the clock.", 403);
    if (args.confirm !== true) {
      throw new ClockError("CONFIRM_REQUIRED", "Reset removes all streamed data. Send confirm: true.", 400);
    }
    const deleted = await store().resetOrg(orgId);
    const fresh = await store().runTransaction(orgId, async (tx) => {
      const doc = initialClock(nowMs);
      tx.setClock(doc);
      return doc;
    });
    return { clock: fresh, deletedStream: deleted };
  }

  if (action === "step") {
    const current = await readClock(orgId, nowMs);
    if (current.status === "running") {
      throw new ClockError("INVALID", "Pause the clock before stepping manually.", 409, current);
    }
    const result = await advanceClock({ orgId, uid, steps: 1, nowMs, allowWhileStopped: true });
    return { clock: result.clock };
  }

  return store().runTransaction(orgId, async (tx) => {
    const clock = (await tx.getClock()) ?? initialClock(nowMs);

    if (action === "setSpeed") {
      const speed = args.speedHoursPerMinute;
      if (
        speed === undefined ||
        !Number.isInteger(speed) ||
        speed < MIN_SPEED_HOURS_PER_MINUTE ||
        speed > MAX_SPEED_HOURS_PER_MINUTE
      ) {
        throw new ClockError(
          "INVALID",
          `speedHoursPerMinute must be an integer from ${MIN_SPEED_HOURS_PER_MINUTE} to ${MAX_SPEED_HOURS_PER_MINUTE}.`,
          400
        );
      }
      const next = { ...clock, speedHoursPerMinute: speed, version: clock.version + 1, updatedAtMs: nowMs };
      tx.setClock(next);
      return { clock: next };
    }

    if (action === "start") {
      if (clock.status === "completed") {
        throw new ClockError("COMPLETED", "The dataset is fully streamed. Reset the clock to run it again.", 409, clock);
      }
      if (leaseActive(clock.lease, nowMs) && clock.lease.ownerUid !== uid && role !== "admin") {
        throw new ClockError("LEASE_HELD", "Another session is driving the clock.", 409, clock);
      }
      const next: ClockDoc = {
        ...clock,
        status: "running",
        lease: { ownerUid: uid, untilMs: nowMs + LEASE_MS },
        startedAtMs: clock.startedAtMs ?? nowMs,
        version: clock.version + 1,
        updatedAtMs: nowMs,
      };
      tx.setClock(next);
      return { clock: next };
    }

    // pause
    if (clock.status === "completed") return { clock };
    if (leaseActive(clock.lease, nowMs) && clock.lease.ownerUid !== uid && role !== "admin") {
      throw new ClockError("LEASE_HELD", "Only the driving session or an admin can pause the clock.", 409, clock);
    }
    const next: ClockDoc = {
      ...clock,
      status: "stopped",
      lease: null,
      version: clock.version + 1,
      updatedAtMs: nowMs,
    };
    tx.setClock(next);
    return { clock: next };
  });
}

// ---------------------------------------------------------------------------
// Cron
// ---------------------------------------------------------------------------

/** Org ids with a running clock, for the server-side cron driver. */
export async function listRunningOrgs(limit = 100): Promise<string[]> {
  return store().listRunningOrgIds(limit);
}

/** Number of whole dataset hours due since the last tick at the configured speed. */
export function hoursDue(clock: ClockDoc, nowMs: number): number {
  if (clock.status !== "running") return 0;
  const since = clock.lastTickAtMs ?? clock.startedAtMs ?? nowMs;
  const minutes = Math.max(0, nowMs - since) / 60_000;
  return Math.min(MAX_STEPS_PER_ADVANCE, Math.floor(minutes * clock.speedHoursPerMinute));
}
