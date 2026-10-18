import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, createErrorResponse } from "@/server/with-auth";
import { parseJsonBody } from "@/server/request-guards";
import { enforceRateLimit } from "@/server/rate-limiter";
import { controlClock, readClock, ClockError } from "@/server/clock-service";
import { auditClock, clockErrorResponse, publicClock } from "@/server/clock-http";
import type { OrgAuthContext } from "@/server/auth";

export const maxDuration = 30;

const ControlBodySchema = z
  .object({
    action: z.enum(["start", "pause", "setSpeed", "step", "reset"]),
    speedHoursPerMinute: z.number().int().optional(),
    confirm: z.boolean().optional(),
  })
  .strict();

/**
 * POST /api/clock/control
 * Actions: start (acquires the lease), pause, setSpeed, step (one manual hour while paused),
 * reset (admin only, needs confirm: true). Every action is audited.
 * Minimum role: analyst.
 */
export const POST = withAuth(
  async function controlRoute(request: NextRequest, auth: OrgAuthContext): Promise<NextResponse> {
    const limited = await enforceRateLimit({ routeKey: "clock.control", orgId: auth.orgId, uid: auth.user.uid });
    if (limited) return limited;

    const body = await parseJsonBody(request, ControlBodySchema);
    if (!body.success) return body.response;

    try {
      const result = await controlClock({
        orgId: auth.orgId,
        uid: auth.user.uid,
        role: auth.role,
        action: body.data.action,
        speedHoursPerMinute: body.data.speedHoursPerMinute,
        confirm: body.data.confirm,
        nowMs: Date.now(),
      });

      const audited = await auditClock(auth.orgId, auth.user.uid, `clock.${body.data.action}`, {
        action: body.data.action,
        appliedHours: result.clock.appliedHours,
        status: result.clock.status,
        speedHoursPerMinute: result.clock.speedHoursPerMinute,
        ...(result.deletedStream !== undefined ? { deletedStream: result.deletedStream } : {}),
      });

      return NextResponse.json({
        ok: true,
        data: { clock: publicClock(result.clock), audited },
      });
    } catch (err) {
      if (err instanceof ClockError) return clockErrorResponse(err);
      console.error("[api/clock/control] unexpected error:", err);
      return createErrorResponse(500, "INTERNAL", "An unexpected internal server error occurred.");
    }
  },
  { minRole: "analyst" }
);

/**
 * GET /api/clock/control
 * Returns the current clock (viewer and above), for sessions that have not subscribed yet.
 */
export const GET = withAuth(
  async function readClockRoute(_request: NextRequest, auth: OrgAuthContext): Promise<NextResponse> {
    try {
      const clock = await readClock(auth.orgId, Date.now());
      return NextResponse.json({ ok: true, data: { clock: publicClock(clock) } });
    } catch (err) {
      console.error("[api/clock/control GET] unexpected error:", err);
      return createErrorResponse(500, "INTERNAL", "An unexpected internal server error occurred.");
    }
  },
  { minRole: "viewer" }
);
