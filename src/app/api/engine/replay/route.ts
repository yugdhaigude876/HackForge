import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/server/with-auth";
import { parseJsonBody } from "@/server/request-guards";
import { enforceRateLimit } from "@/server/rate-limiter";
import { Money } from "@/engine/money";
import {
  runTimelineSimulation,
  TimelineSimulatorOptions,
  TimelinePolicy,
  TimelineSimulationResult,
} from "@/engine/simulator";
import type { OrgAuthContext } from "@/server/auth";

export const maxDuration = 60;

const ReplayRequestSchema = z.object({
  startHour: z.number().int().min(0).max(8759).optional().default(0),
  maxHours: z.number().int().min(1).max(8760).optional().default(168),
  initialCashUsd: z.number().positive().max(10_000_000_000).optional().default(50_000_000),
  operationalFloorUsd: z.number().positive().max(1_000_000_000).optional().default(5_000_000),
  horizonHours: z.number().int().min(1).max(168).optional().default(24),
  alpha: z.number().min(0.001).max(0.5).optional().default(0.01),
  outflowShockPct: z.number().min(0).max(100).optional().default(0),
  settlementLagHours: z.number().min(0).max(72).optional().default(0),
  rateShiftBps: z.number().min(-500).max(500).optional().default(0),
  equityDrawdownShockPct: z.number().min(0).max(90).optional().default(0),
  policy: z.enum(["reserve-juggler", "hold-all-cash", "fixed-buffer"]).optional().default("reserve-juggler"),
  compareAllPolicies: z.boolean().optional().default(false),
  subsampleStep: z.number().int().min(1).max(24).optional().default(1),
}).strict();

/**
 * POST /api/engine/replay
 *
 * Runs the 4-tier timeline simulation runner across the benchmark dataset.
 * Supports side-by-side policy comparisons and configurable stress scenario controls.
 * Minimum required role: viewer.
 */
export const POST = withAuth(
  async function runReplayRoute(
    request: NextRequest,
    authContext: OrgAuthContext
  ): Promise<NextResponse> {
    const { orgId, user } = authContext;

    // Rate limiting
    const rateLimitError = await enforceRateLimit({
      routeKey: "engine.replay",
      orgId,
      uid: user.uid,
    });
    if (rateLimitError) {
      return rateLimitError;
    }

    // Body parsing & validation
    const bodyResult = await parseJsonBody(request, ReplayRequestSchema);
    if (!bodyResult.success) {
      return bodyResult.response;
    }

    const input = bodyResult.data;
    const initialCash = Money.fromDecimal(input.initialCashUsd, "USD");
    const operationalFloor = Money.fromDecimal(input.operationalFloorUsd, "USD");

    const simOptions: TimelineSimulatorOptions = {
      startHour: input.startHour,
      maxHours: input.maxHours,
      initialCash,
      operationalFloor,
      horizonHours: input.horizonHours,
      alpha: input.alpha,
      outflowShockPct: input.outflowShockPct,
      settlementLagHours: input.settlementLagHours,
      rateShiftBps: input.rateShiftBps,
      equityDrawdownShockPct: input.equityDrawdownShockPct,
      policy: input.policy as TimelinePolicy,
    };

    try {
      if (input.compareAllPolicies) {
        // Run all 3 policies across the exact same window
        const policies: TimelinePolicy[] = ["reserve-juggler", "hold-all-cash", "fixed-buffer"];
        const policyResults: Record<string, TimelineSimulationResult> = {};

        for (const pol of policies) {
          policyResults[pol] = runTimelineSimulation({
            ...simOptions,
            policy: pol,
          });
        }

        // Subsample frames to optimize payload size if requested
        const step = input.subsampleStep;
        const mainFrames = policyResults["reserve-juggler"].frames.filter(
          (_, idx) => idx % step === 0 || idx === policyResults["reserve-juggler"].frames.length - 1
        );

        return NextResponse.json({
          ok: true,
          data: {
            comparison: {
              "reserve-juggler": policyResults["reserve-juggler"].summary,
              "hold-all-cash": policyResults["hold-all-cash"].summary,
              "fixed-buffer": policyResults["fixed-buffer"].summary,
            },
            frames: mainFrames,
            auditLogs: policyResults["reserve-juggler"].auditLogs,
          },
        });
      }

      // Single policy run
      const result = runTimelineSimulation(simOptions);
      const step = input.subsampleStep;
      const sampledFrames = result.frames.filter(
        (_, idx) => idx % step === 0 || idx === result.frames.length - 1
      );

      return NextResponse.json({
        ok: true,
        data: {
          summary: result.summary,
          frames: sampledFrames,
          auditLogs: result.auditLogs,
        },
      });
    } catch (err) {
      console.error("[api/engine/replay] Simulation execution failed:", err);
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "INTERNAL",
            message: "Timeline simulation execution failed.",
          },
        },
        { status: 500 }
      );
    }
  },
  { minRole: "viewer" }
);
