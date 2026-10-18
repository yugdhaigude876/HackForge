import { createHash } from "node:crypto";

/** Deterministic JSON string: BigInt as "<n>n", object keys in insertion order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? `${v.toString()}n` : v));
}

export function sha256Of(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
