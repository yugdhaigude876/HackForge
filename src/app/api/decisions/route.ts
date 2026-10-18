import { NextRequest, NextResponse } from "next/server";
import { withAuth, createErrorResponse } from "@/server/with-auth";
import { decisionsRepo } from "@/server/repositories/decisions";
import { validatePaginationLimit } from "@/server/request-guards";
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
      const limitResult = validatePaginationLimit(request.nextUrl.searchParams, 20, 100);
      if ("errorResponse" in limitResult) {
        return limitResult.errorResponse;
      }
      const limit = limitResult.limit;
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
