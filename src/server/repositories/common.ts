import "server-only";

import { createHash } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { Money } from "@/engine/money";

export type RepositoryErrorCode =
  | "NOT_FOUND"
  | "INVALID_ID"
  | "MALFORMED_DATA"
  | "ALREADY_EXISTS"
  | "BATCH_LIMIT_EXCEEDED"
  | "OPERATION_FAILED";

export class RepositoryError extends Error {
  readonly code: RepositoryErrorCode;
  readonly details?: unknown;

  constructor(code: RepositoryErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "RepositoryError";
    this.code = code;
    this.details = details;
  }
}

const ID_REGEX = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Validates document and org IDs against path traversal and malformed strings.
 * Pattern: ^[A-Za-z0-9_-]{1,64}$
 */
export function validateId(id: string, fieldName = "id"): string {
  if (typeof id !== "string" || !id || !ID_REGEX.test(id)) {
    throw new RepositoryError(
      "INVALID_ID",
      `Invalid ${fieldName}: must match pattern ^[A-Za-z0-9_-]{1,64}$, received "${String(id)}"`
    );
  }
  return id;
}

/**
 * Bounded read limit helper with default and maximum caps.
 */
export function clampLimit(limit?: number, defaultLimit = 50, maxLimit = 500): number {
  if (limit === undefined || limit === null) {
    return defaultLimit;
  }
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit < 1) {
    return 1;
  }
  return Math.min(Math.floor(limit), maxLimit);
}

/**
 * Converts Firestore Timestamp, Date, string, or number to JavaScript Date.
 */
export function toDate(val: unknown): Date {
  if (val instanceof Date) {
    return val;
  }
  if (val && typeof (val as { toDate?: unknown }).toDate === "function") {
    return (val as Timestamp).toDate();
  }
  if (typeof val === "string" || typeof val === "number") {
    const d = new Date(val);
    if (!isNaN(d.getTime())) {
      return d;
    }
  }
  throw new RepositoryError("MALFORMED_DATA", `Cannot convert ${String(val)} to Date`);
}

/**
 * Converts Date or Timestamp to Firestore Timestamp.
 */
export function toTimestamp(date: Date | Timestamp): Timestamp {
  if (date instanceof Timestamp) {
    return date;
  }
  if (date instanceof Date) {
    return Timestamp.fromDate(date);
  }
  throw new RepositoryError("MALFORMED_DATA", `Cannot convert ${String(date)} to Timestamp`);
}

/**
 * Converts Money, bigint, or integer string to decimal string representation.
 * Prevents IEEE 754 precision loss on values >= 2^53.
 */
export function moneyToDecimalString(amount: Money | string | bigint | number): string {
  if (amount instanceof Money) {
    return amount.amountMinor.toString();
  }
  if (typeof amount === "bigint") {
    return amount.toString();
  }
  if (typeof amount === "string") {
    const trimmed = amount.trim();
    if (!/^-?\d+$/.test(trimmed)) {
      throw new RepositoryError("MALFORMED_DATA", `Invalid minor units amount string: "${amount}"`);
    }
    return trimmed;
  }
  if (typeof amount === "number") {
    if (!Number.isSafeInteger(amount)) {
      throw new RepositoryError(
        "MALFORMED_DATA",
        `Amount number ${amount} is outside safe integer range. Store as decimal string.`
      );
    }
    return Math.floor(amount).toString();
  }
  throw new RepositoryError("MALFORMED_DATA", `Unsupported money type: ${typeof amount}`);
}

/**
 * Converts decimal string representation to domain Money object.
 */
export function decimalStringToMoney(val: string | number | bigint, currency = "USD"): Money {
  try {
    return Money.fromMinor(val.toString(), currency);
  } catch (err) {
    throw new RepositoryError(
      "MALFORMED_DATA",
      `Failed to parse Money from decimal string "${String(val)}": ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Computes a deterministic SHA-256 hash of a JSON-serializable value.
 * Recursively sorts object keys so equivalent payloads yield identical hashes.
 */
export function canonicalJsonHash(data: unknown): string {
  function stringifyCanonical(val: unknown): string {
    if (val === null || typeof val !== "object") {
      return JSON.stringify(val);
    }
    if (val instanceof Date) {
      return JSON.stringify(val.toISOString());
    }
    if (typeof (val as { toDate?: unknown }).toDate === "function") {
      return JSON.stringify((val as { toDate: () => Date }).toDate().toISOString());
    }
    if (Array.isArray(val)) {
      return "[" + val.map(stringifyCanonical).join(",") + "]";
    }
    const keys = Object.keys(val as Record<string, unknown>).sort();
    return (
      "{" +
      keys
        .map((k) => JSON.stringify(k) + ":" + stringifyCanonical((val as Record<string, unknown>)[k]))
        .join(",") +
      "}"
    );
  }

  return createHash("sha256").update(stringifyCanonical(data)).digest("hex");
}

