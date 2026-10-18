import "server-only";

import { NextResponse } from "next/server";
import { createErrorResponse } from "@/server/with-auth";
import { auditRepo } from "@/server/repositories/audit";
import { canonicalJsonHash } from "@/server/repositories/common";
import { ClockError, streamDocId, type ClockDoc } from "@/server/clock-service";
import type { StreamTick } from "@/engine/live-tick";

/** Maps a ClockError to the standard error envelope. */
export function clockErrorResponse(err: ClockError): NextResponse {
  const code = err.status === 403 ? "FORBIDDEN" : err.status === 409 ? "CONFLICT" : err.status === 500 ? "INTERNAL" : "VALIDATION_ERROR";
  return createErrorResponse(err.status, code, err.message, {
    clockCode: err.code,
    ...(err.clock ? { clock: publicClock(err.clock) } : {}),
  });
}

/** Clock fields that are safe and useful to return to callers. */
export function publicClock(clock: ClockDoc) {
  return {
    appliedHours: clock.appliedHours,
    status: clock.status,
    speedHoursPerMinute: clock.speedHoursPerMinute,
    datasetLength: clock.datasetLength,
    lease: clock.lease ? { ownerUid: clock.lease.ownerUid, untilMs: clock.lease.untilMs } : null,
    lastTickAtMs: clock.lastTickAtMs,
    version: clock.version,
  };
}

/**
 * Appends an audit entry for a clock action. Failures are logged and never fail the request.
 * Returns whether the audit entry was written.
 */
export async function auditClock(
  orgId: string,
  actorUid: string,
  action: string,
  detail: unknown,
  refPath?: string
): Promise<boolean> {
  try {
    await auditRepo.append(orgId, {
      actorUid,
      action,
      refPath: refPath ?? `orgs/${orgId}/clock/state`,
      afterHash: canonicalJsonHash(detail),
    });
    return true;
  } catch (err) {
    console.error(`[clock audit] failed to append ${action} for org ${orgId}:`, err);
    return false;
  }
}

/** Audit path for the last tick that carried events, if any. */
export function lastEventTick(ticks: readonly StreamTick[]): StreamTick | null {
  for (let i = ticks.length - 1; i >= 0; i--) {
    if (ticks[i].events.length > 0) return ticks[i];
  }
  return null;
}

export const tickRefPath = (orgId: string, hourIndex: number): string =>
  `orgs/${orgId}/stream/${streamDocId(hourIndex)}`;
