import { NextRequest, NextResponse } from "next/server";
import { withAuth, createErrorResponse } from "@/server/with-auth";
import { instrumentsRepo } from "@/server/repositories/instruments";
import type { OrgAuthContext } from "@/server/auth";

/**
 * GET /api/instruments
 * Lists all active yield instruments configured for the organisation.
 * Minimum required role: viewer.
 */
export const GET = withAuth(
  async function listInstrumentsRoute(
    request: NextRequest,
    authContext: OrgAuthContext
  ): Promise<NextResponse> {
    const { orgId } = authContext;

    try {
      const stored = await instrumentsRepo.list(orgId);
      const instruments = stored.map((inst) => ({
        id: inst.id,
        name: inst.name,
        annualRateBps: inst.annualRateBps,
        capacityMinor: inst.capacityMinor.toString(),
        settlementLagHours: inst.settlementLagHours,
        minHoldHours: inst.minHoldHours,
        penaltyBps: inst.penaltyBps,
      }));

      return NextResponse.json({
        ok: true,
        data: {
          instruments,
        },
      });
    } catch (err) {
      console.warn("[listInstrumentsRoute] Error retrieving instruments:", err);
      return createErrorResponse(500, "INTERNAL", "Failed to retrieve organisation instruments.");
    }
  }
);
