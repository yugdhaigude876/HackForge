import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, createErrorResponse } from "@/server/with-auth";
import { parseJsonBody } from "@/server/request-guards";
import { enforceRateLimit } from "@/server/rate-limiter";
import { advanceClock, ClockError, MAX_STEPS_PER_ADVANCE } from "@/server/clock-service";
import { auditClock, clockErrorResponse, lastEventTick, publicClock, tickRefPath } from "@/server/clock-http";
import type { OrgAuthContext } from "@/server/auth";

export const maxDuration = 30;

const AdvanceBodySchema = z
  .object({
    steps: z.number().int().min(1).max(MAX_STEPS_PER_ADVANCE).optional(),
    expectedHourIndex: z.number().int().min(0).optional(),
  })
  .strict();

/**
 * POST /api/clock/advance
 * Advances the organisation's dataset clock by `steps` hours (default 1) in one transaction.
 * Minimum role: analyst. The caller must hold the clock lease (acquired with control "start").
 * A stale `expectedHourIndex` returns 409 and changes nothing.
 */
export const POST = withAuth(
  async function advanceRoute(request: NextRequest, auth: OrgAuthContext): Promise<NextResponse> {
    const limited = await enforceRateLimit({ routeKey: "clock.advance", orgId: auth.orgId, uid: auth.user.uid });
    if (limited) return limited;

    const body = await parseJsonBody(request, AdvanceBodySchema);
    if (!body.success) return body.response;

    try {
      const result = await advanceClock({
        orgId: auth.orgId,
        uid: auth.user.uid,
        steps: body.data.steps,
        expectedHourIndex: body.data.expectedHourIndex,
        nowMs: Date.now(),
      });

      // Audit only the hours that carried events (sweeps, maturities, liquidations, overdraft)
      const eventTick = lastEventTick(result.ticks);
      let audited = true;
      if (eventTick) {
        audited = await auditClock(
          auth.orgId,
          auth.user.uid,
          "clock.tick",
          { hourIndex: eventTick.hourIndex, events: eventTick.events, status: eventTick.status },
          tickRefPath(auth.orgId, eventTick.hourIndex)
        );
      }

      const last = result.ticks[result.ticks.length - 1];
      return NextResponse.json({
        ok: true,
        data: {
          clock: publicClock(result.clock),
          applied: result.applied,
          latest: last
            ? { hourIndex: last.hourIndex, timestamp: last.timestamp, status: last.status }
            : null,
          audited,
        },
      });
    } catch (err) {
      if (err instanceof ClockError) return clockErrorResponse(err);
      console.error("[api/clock/advance] unexpected error:", err);
      return createErrorResponse(500, "INTERNAL", "An unexpected internal server error occurred.");
    }
  },
  { minRole: "analyst" }
);
