import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { getAdminFirestore } from "./firebase-admin";
import { createErrorResponse } from "./with-auth";

export const IDEMPOTENCY_KEY_REGEX = /^[A-Za-z0-9_-]{1,128}$/;
export const DEFAULT_IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60; // 24 hours

export interface StoredIdempotencyRecord {
  status: number;
  payload: unknown;
  expiresAtMs: number;
}

export interface IdempotencyStore {
  get(orgId: string, key: string): Promise<StoredIdempotencyRecord | null>;
  set(
    orgId: string,
    key: string,
    status: number,
    payload: unknown,
    ttlSeconds?: number
  ): Promise<void>;
}

export class MemoryIdempotencyStore implements IdempotencyStore {
  private records = new Map<string, StoredIdempotencyRecord>();

  async get(orgId: string, key: string): Promise<StoredIdempotencyRecord | null> {
    const fullKey = `${orgId}::${key}`;
    const rec = this.records.get(fullKey);
    if (!rec) return null;
    if (Date.now() > rec.expiresAtMs) {
      this.records.delete(fullKey);
      return null;
    }
    return rec;
  }

  async set(
    orgId: string,
    key: string,
    status: number,
    payload: unknown,
    ttlSeconds = DEFAULT_IDEMPOTENCY_TTL_SECONDS
  ): Promise<void> {
    const fullKey = `${orgId}::${key}`;
    this.records.set(fullKey, {
      status,
      payload,
      expiresAtMs: Date.now() + ttlSeconds * 1000,
    });
  }

  clear(): void {
    this.records.clear();
  }
}

export class FirestoreIdempotencyStore implements IdempotencyStore {
  private fallbackStore = new MemoryIdempotencyStore();

  async get(orgId: string, key: string): Promise<StoredIdempotencyRecord | null> {
    let db;
    try {
      db = getAdminFirestore();
    } catch {
      return this.fallbackStore.get(orgId, key);
    }

    try {
      const docId = `${orgId}_${key}`;
      const snap = await db.collection("idempotency").doc(docId).get();
      if (!snap.exists) return null;

      const data = snap.data();
      const expiresAt = data?.expiresAt;
      const expiresAtMs =
        expiresAt instanceof Timestamp ? expiresAt.toMillis() : (expiresAt ?? 0);

      if (Date.now() > expiresAtMs) {
        return null;
      }

      return {
        status: data?.status ?? 200,
        payload: data?.payload,
        expiresAtMs,
      };
    } catch (err) {
      console.warn(`[FirestoreIdempotencyStore] Read error for org=${orgId} key=${key}:`, err);
      return null;
    }
  }

  async set(
    orgId: string,
    key: string,
    status: number,
    payload: unknown,
    ttlSeconds = DEFAULT_IDEMPOTENCY_TTL_SECONDS
  ): Promise<void> {
    let db;
    try {
      db = getAdminFirestore();
    } catch {
      return this.fallbackStore.set(orgId, key, status, payload, ttlSeconds);
    }

    try {
      const docId = `${orgId}_${key}`;
      const expiresAtDate = new Date(Date.now() + ttlSeconds * 1000);

      await db.collection("idempotency").doc(docId).set({
        orgId,
        idempotencyKey: key,
        status,
        payload,
        createdAt: Timestamp.now(),
        expiresAt: Timestamp.fromDate(expiresAtDate),
      });
    } catch (err) {
      console.warn(`[FirestoreIdempotencyStore] Write error for org=${orgId} key=${key}:`, err);
    }
  }
}

let activeIdempotencyStore: IdempotencyStore = new FirestoreIdempotencyStore();

export function setIdempotencyStore(store: IdempotencyStore): void {
  activeIdempotencyStore = store;
}

export function resetIdempotencyStore(): void {
  activeIdempotencyStore = new FirestoreIdempotencyStore();
}

/**
 * Validates Idempotency-Key header if provided.
 * If cached response found, returns replayed NextResponse.
 * If header invalid, returns 400 validation error NextResponse.
 * Returns null if no key or key is fresh and needs execution.
 */
export async function checkIdempotency(
  request: NextRequest,
  orgId: string
): Promise<{ key: string | null; response: NextResponse | null }> {
  const rawKey = request.headers.get("idempotency-key") || request.headers.get("Idempotency-Key");
  if (!rawKey) {
    return { key: null, response: null };
  }

  const key = rawKey.trim();
  if (!IDEMPOTENCY_KEY_REGEX.test(key)) {
    const errorResponse = createErrorResponse(
      400,
      "VALIDATION_ERROR",
      `Invalid 'Idempotency-Key' header: must match pattern ^[A-Za-z0-9_-]{1,128}$, received "${key}"`
    );
    return { key, response: errorResponse };
  }

  const cached = await activeIdempotencyStore.get(orgId, key);
  if (cached) {
    const replayResponse = NextResponse.json(cached.payload, {
      status: cached.status,
    });
    replayResponse.headers.set("Idempotency-Replayed", "true");
    replayResponse.headers.set("Idempotency-Key", key);
    return { key, response: replayResponse };
  }

  return { key, response: null };
}

/**
 * Persists an idempotent response if a valid idempotency key was supplied and execution succeeded.
 */
export async function recordIdempotency(
  orgId: string,
  key: string | null,
  status: number,
  payload: unknown
): Promise<void> {
  if (!key || status < 200 || status >= 300) {
    return;
  }
  await activeIdempotencyStore.set(orgId, key, status, payload);
}
