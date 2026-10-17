import { NextRequest, NextResponse } from "next/server";
import { withAuth, createErrorResponse } from "@/server/with-auth";
import { decisionsRepo } from "@/server/repositories/decisions";
import { validateId, RepositoryError } from "@/server/repositories/common";
import type { OrgAuthContext } from "@/server/auth";

interface RouteContext {
  params: Promise<{ id: string }> | { id: string };
}

/**
 * GET /api/decisions/[id]
 * Retrieves a single decision record by ID within the authenticated organisation.
 * Minimum required role: viewer.
 */
export const GET = withAuth<RouteContext>(
  async function getDecisionByIdRoute(
    request: NextRequest,
    authContext: OrgAuthContext,
    routeContext?: RouteContext
  ): Promise<NextResponse> {
    try {
      let id: string | undefined;

      if (routeContext?.params) {
        const resolved = await routeContext.params;
        id = resolved?.id;
      }

      if (!id) {
        // Fallback to URL path extraction
        const segments = request.nextUrl.pathname.split("/").filter(Boolean);
        id = segments[segments.length - 1];
      }

      if (!id) {
        return createErrorResponse(
          400,
          "VALIDATION_ERROR",
          "Missing decision ID in route path."
        );
      }

      try {
        validateId(id, "decisionId");
      } catch (validationErr) {
        if (validationErr instanceof RepositoryError) {
          return createErrorResponse(
            400,
            "VALIDATION_ERROR",
            validationErr.message
          );
        }
        throw validationErr;
      }

      const decision = await decisionsRepo.get(authContext.orgId, id);
      if (!decision) {
        return createErrorResponse(
          404,
          "NOT_FOUND",
          `Decision '${id}' was not found in organisation '${authContext.orgId}'.`
        );
      }

      const safeDecision = {
        id: decision.id,
        orgId: decision.orgId,
        forecastId: decision.forecastId,
        confidence: decision.confidence,
        reserve: decision.reserveMinor,
        surplus: decision.surplusMinor,
        allocations: (decision.allocations ?? []).map((a) => ({
          instrumentId: a.instrumentId,
          amount: a.amountMinor,
        })),
        status: decision.status,
        expectedNetYield: decision.expectedNetYieldMinor,
        explanation: decision.explanation,
        createdAt:
          decision.createdAt instanceof Date
            ? decision.createdAt.toISOString()
            : decision.createdAt,
        createdBy: decision.createdBy,
      };

      return NextResponse.json({
        ok: true,
        data: safeDecision,
      });
    } catch (error) {
      console.error("[getDecisionByIdRoute Error]:", error);
      return createErrorResponse(
        500,
        "INTERNAL",
        "An internal server error occurred while retrieving the decision."
      );
    }
  },
  { minRole: "viewer" }
);
