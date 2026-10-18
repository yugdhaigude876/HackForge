import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import { getAdminFirestore } from "./firebase-admin";
import { createErrorResponse } from "./with-auth";
import { NextResponse } from "next/server";

export interface RateLimitConfig {
  orgLimit: number;
  userLimit: number;
  windowMs: number; // e.g. 60_000 for 1 minute
}

export const ROUTE_RATE_LIMITS: Record<string, RateLimitConfig> = {
  "dashboard.run": { orgLimit: 10, userLimit: 5, windowMs: 60_000 },
  "simulations.run": { orgLimit: 15, userLimit: 10, windowMs: 60_000 },
  "simulations.compare": { orgLimit: 10, userLimit: 5, windowMs: 60_000 },
  "engine.generate": { orgLimit: 30, userLimit: 15, windowMs: 60_000 },
  "engine.forecast": { orgLimit: 30, userLimit: 15, windowMs: 60_000 },
  "engine.decision": { orgLimit: 30, userLimit: 15, windowMs: 60_000 },
  // Realtime clock: a client driver advances about once per second, so allow headroom.
  "clock.advance": { orgLimit: 180, userLimit: 150, windowMs: 60_000 },
  "clock.control": { orgLimit: 40, userLimit: 30, windowMs: 60_000 },
};

export interface RateLimitCheckResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAtMs: number;
  retryAfterSeconds: number;
  reason?: "org_limit" | "user_limit";
}

export interface RateLimiterStore {
  checkAndIncrement(
    key: string,
    limit: number,
    windowMs: number,
    nowMs: number
  ): Promise<RateLimitCheckResult>;
}

export class MemoryRateLimiterStore implements RateLimiterStore {
  private records = new Map<string, { count: number; resetAtMs: number }>();

  async checkAndIncrement(
    key: string,
    limit: number,
    windowMs: number,
    nowMs: number
  ): Promise<RateLimitCheckResult> {
    const existing = this.records.get(key);

    if (!existing || nowMs >= existing.resetAtMs) {
      const resetAtMs = nowMs + windowMs;
      this.records.set(key, { count: 1, resetAtMs });
      return {
        allowed: true,
        limit,
        remaining: Math.max(0, limit - 1),
        resetAtMs,
        retryAfterSeconds: 0,
      };
    }

    if (existing.count >= limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAtMs - nowMs) / 1000));
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetAtMs: existing.resetAtMs,
        retryAfterSeconds,
      };
    }

    existing.count += 1;
    return {
      allowed: true,
      limit,
      remaining: Math.max(0, limit - existing.count),
      resetAtMs: existing.resetAtMs,
      retryAfterSeconds: 0,
    };
  }

  clear(): void {
    this.records.clear();
  }
}

export class FirestoreRateLimiterStore implements RateLimiterStore {
  private fallbackStore = new MemoryRateLimiterStore();

  async checkAndIncrement(
    key: string,
    limit: number,
    windowMs: number,
    nowMs: number
  ): Promise<RateLimitCheckResult> {
    let db;
    try {
      db = getAdminFirestore();
    } catch {
      return this.fallbackStore.checkAndIncrement(key, limit, windowMs, nowMs);
    }

    const docRef = db.collection("limits").doc(key);

    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);

      if (!snap.exists) {
        const resetAtMs = nowMs + windowMs;
        tx.set(docRef, {
          count: 1,
          resetAtMs,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        return {
          allowed: true,
          limit,
          remaining: Math.max(0, limit - 1),
          resetAtMs,
          retryAfterSeconds: 0,
        };
      }

      const data = snap.data();
      const existingResetAt = typeof data?.resetAtMs === "number" ? data.resetAtMs : 0;
      const existingCount = typeof data?.count === "number" ? data.count : 0;

      // Window expired -> reset window
      if (nowMs >= existingResetAt) {
        const resetAtMs = nowMs + windowMs;
        tx.set(
          docRef,
          {
            count: 1,
            resetAtMs,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        return {
          allowed: true,
          limit,
          remaining: Math.max(0, limit - 1),
          resetAtMs,
          retryAfterSeconds: 0,
        };
      }

      // Limit exceeded
      if (existingCount >= limit) {
        const retryAfterSeconds = Math.max(1, Math.ceil((existingResetAt - nowMs) / 1000));
        return {
          allowed: false,
          limit,
          remaining: 0,
          resetAtMs: existingResetAt,
          retryAfterSeconds,
        };
      }

      // Increment count
      const nextCount = existingCount + 1;
      tx.update(docRef, {
        count: nextCount,
        updatedAt: FieldValue.serverTimestamp(),
      });

      return {
        allowed: true,
        limit,
        remaining: Math.max(0, limit - nextCount),
        resetAtMs: existingResetAt,
        retryAfterSeconds: 0,
      };
    });
  }
}

let activeLimiterStore: RateLimiterStore = new FirestoreRateLimiterStore();
let activeClock: () => number = () => Date.now();

export function setRateLimiterStore(store: RateLimiterStore): void {
  activeLimiterStore = store;
}

export function setRateLimiterClock(clock: () => number): void {
  activeClock = clock;
}

export function resetRateLimiterOverrides(): void {
  activeLimiterStore = new FirestoreRateLimiterStore();
  activeClock = () => Date.now();
}

export interface RateLimitOptions {
  routeKey: string;
  orgId: string;
  uid: string;
  failClosed?: boolean;
}

export class RateLimiterUnavailableError extends Error {
  constructor(message = "Rate limiter service unavailable. Request rejected.") {
    super(message);
    this.name = "RateLimiterUnavailableError";
  }
}

/**
 * Checks both per-organisation and per-user limits using durable atomic increments.
 * Returns null if allowed, or an error NextResponse (429 or 503) if rejected.
 */
export async function enforceRateLimit(
  options: RateLimitOptions
): Promise<NextResponse | null> {
  const { routeKey, orgId, uid, failClosed = true } = options;
  const config = ROUTE_RATE_LIMITS[routeKey] ?? {
    orgLimit: 30,
    userLimit: 15,
    windowMs: 60_000,
  };

  const nowMs = activeClock();

  try {
    // 1. Check per-user rate limit
    const userKey = `${routeKey}_user_${orgId}_${uid}`;
    const userCheck = await activeLimiterStore.checkAndIncrement(
      userKey,
      config.userLimit,
      config.windowMs,
      nowMs
    );

    if (!userCheck.allowed) {
      return createRateLimitResponse(userCheck.retryAfterSeconds);
    }

    // 2. Check per-organisation rate limit
    const orgKey = `${routeKey}_org_${orgId}`;
    const orgCheck = await activeLimiterStore.checkAndIncrement(
      orgKey,
      config.orgLimit,
      config.windowMs,
      nowMs
    );

    if (!orgCheck.allowed) {
      return createRateLimitResponse(orgCheck.retryAfterSeconds);
    }

    return null;
  } catch (err) {
    console.error(`[RateLimiter Error] routeKey=${routeKey} org=${orgId}:`, err);
    if (failClosed) {
      return createErrorResponse(
        503,
        "INTERNAL",
        "Rate limiter service unavailable. Request rejected."
      );
    }
    // Fail-open only if explicitly requested (non-expensive routes)
    return null;
  }
}

export function createRateLimitResponse(retryAfterSeconds: number): NextResponse {
  const res = createErrorResponse(
    429,
    "RATE_LIMITED",
    `Rate limit exceeded. Please wait ${retryAfterSeconds}s before retrying.`,
    { retryAfterSeconds }
  );
  res.headers.set("Retry-After", String(retryAfterSeconds));
  return res;
}
