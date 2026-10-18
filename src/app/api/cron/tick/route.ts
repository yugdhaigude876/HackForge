import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createErrorResponse } from "@/server/with-auth";
import {
  CRON_OWNER_UID,
  advanceClock,
  hoursDue,
  listRunningOrgs,
  readClock,
  ClockError,
} from "@/server/clock-service";
import { auditClock, lastEventTick, tickRefPath } from "@/server/clock-http";

export const maxDuration = 60;

function secretMatches(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * GET /api/cron/tick
 * Server-side clock driver for Vercel Cron (Pro plan: per-minute schedule). Advances every
 * organisation whose clock is running by the hours due since its last tick, capped at 24.
 * Guarded by `Authorization: Bearer $CRON_SECRET`. Disabled (503) when CRON_SECRET is unset.
 * Orgs driven by an active client lease are skipped so two drivers never advance the same clock.
 *
 * Hobby plan cron is limited to once per day, so this is an opt-in driver: see docs/DEPLOYMENT.md.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return createErrorResponse(503, "INTERNAL", "Cron driver is not configured.");
  }
  if (!secretMatches(request.headers.get("authorization"), secret)) {
    return createErrorResponse(401, "UNAUTHENTICATED", "Invalid cron credentials.");
  }

  const nowMs = Date.now();
  const summary: Array<{ orgId: string; applied: number; skipped?: string }> = [];

  try {
    const orgs = await listRunningOrgs(100);
    for (const orgId of orgs) {
      try {
        const clock = await readClock(orgId, nowMs);
        if (clock.lease && clock.lease.untilMs > nowMs && clock.lease.ownerUid !== CRON_OWNER_UID) {
          summary.push({ orgId, applied: 0, skipped: "driven by an active client session" });
          continue;
        }
        const due = hoursDue(clock, nowMs);
        if (due < 1) {
          summary.push({ orgId, applied: 0, skipped: "nothing due" });
          continue;
        }
        const result = await advanceClock({
          orgId,
          uid: CRON_OWNER_UID,
          steps: due,
          expectedHourIndex: clock.appliedHours,
          nowMs,
          asCron: true,
        });
        const eventTick = lastEventTick(result.ticks);
        if (eventTick) {
          await auditClock(
            orgId,
            CRON_OWNER_UID,
            "clock.tick",
            { hourIndex: eventTick.hourIndex, events: eventTick.events, status: eventTick.status },
            tickRefPath(orgId, eventTick.hourIndex)
          );
        }
        summary.push({ orgId, applied: result.applied });
      } catch (err) {
        if (err instanceof ClockError) {
          summary.push({ orgId, applied: 0, skipped: err.code });
        } else {
          console.error(`[api/cron/tick] org ${orgId} failed:`, err);
          summary.push({ orgId, applied: 0, skipped: "error" });
        }
      }
    }
    return NextResponse.json({ ok: true, data: { orgs: summary.length, summary } });
  } catch (err) {
    console.error("[api/cron/tick] unexpected error:", err);
    return createErrorResponse(500, "INTERNAL", "An unexpected internal server error occurred.");
  }
}
