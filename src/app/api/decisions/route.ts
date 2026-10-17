import { NextRequest, NextResponse } from "next/server";
import { withAuth, createErrorResponse } from "@/server/with-auth";
import { decisionsRepo } from "@/server/repositories/decisions";
import { clampLimit } from "@/server/repositories/common";
import type { OrgAuthContext } from "@/server/auth";

/**
 * GET /api/decisions
 * Lists persisted decisions for the organisation, ordered newest first with bounded pagination.
 * Minimum required role: viewer.
 */
export const GET = withAuth(
  async function listDecisionsRoute(
    request: NextRequest,
    authContext: OrgAuthContext
  ): Promise<NextResponse> {
    try {
      const searchParams = request.nextUrl.searchParams;
      const rawLimit = searchParams.get("limit");
      let parsedLimit: number | undefined = undefined;

      if (rawLimit !== null) {
        const num = Number(rawLimit);
        if (Number.isNaN(num) || !Number.isInteger(num) || num < 1) {
          return createErrorResponse(
            400,
            "VALIDATION_ERROR",
            "Query parameter 'limit' must be a positive integer."
          );
        }
        parsedLimit = num;
      }

      const limit = clampLimit(parsedLimit, 20, 100);
      const decisions = await decisionsRepo.list(authContext.orgId, { limit });

      const safeDecisions = decisions.map((d) => ({
        id: d.id,
        orgId: d.orgId,
        forecastId: d.forecastId,
        confidence: d.confidence,
        reserve: d.reserveMinor,
        surplus: d.surplusMinor,
        allocations: (d.allocations ?? []).map((a) => ({
          instrumentId: a.instrumentId,
          amount: a.amountMinor,
        })),
        status: d.status,
        expectedNetYield: d.expectedNetYieldMinor,
        explanation: d.explanation,
        createdAt: d.createdAt instanceof Date ? d.createdAt.toISOString() : d.createdAt,
        createdBy: d.createdBy,
      }));

      return NextResponse.json({
        ok: true,
        data: safeDecisions,
      });
    } catch (error) {
      console.error("[listDecisionsRoute Error]:", error);
      return createErrorResponse(
        500,
        "INTERNAL",
        "An internal server error occurred while retrieving decisions."
      );
    }
  },
  { minRole: "viewer" }
);
