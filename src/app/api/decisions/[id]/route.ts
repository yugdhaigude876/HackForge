import { NextRequest, NextResponse } from "next/server";
import { withAuth, createErrorResponse } from "@/server/with-auth";
import { decisionsRepo } from "@/server/repositories/decisions";
import { instrumentsRepo } from "@/server/repositories/instruments";
import { explainDecision } from "@/engine/explain";
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

      // Enrich with deterministic plain-language structured explanation
      let knownInstruments: Array<{
        id: string;
        name: string;
        apy?: number;
        settlementLagHours?: number;
        withdrawalPenalty?: number;
        capacityMinor?: string;
        earlyWithdrawalRisk?: number;
      }> = [];
      try {
        const storedInstruments = await instrumentsRepo.list(authContext.orgId);
        knownInstruments = storedInstruments.map((inst) => ({
          id: inst.id,
          name: inst.name,
          annualRateBps: inst.annualRateBps,
          settlementLagHours: inst.settlementLagHours,
          penaltyBps: inst.penaltyBps,
          capacityMinor: inst.capacityMinor,
        }));
      } catch {
        // Fall back to stored allocation metadata if instruments repo fails
      }

      const structuredExplanation = explainDecision(decision, knownInstruments);

      const safeDecision = {
        id: decision.id,
        orgId: decision.orgId,
        forecastId: decision.forecastId,
        confidence: decision.confidence,
        reserve: decision.reserveMinor,
        surplus: decision.surplusMinor,
        availableCash: decision.availableCashMinor,
        operationalFloor: decision.operationalFloorMinor,
        expectedCumulativeFlow: decision.expectedCumulativeFlowMinor,
        worstCaseResidualShortfall: decision.worstCaseResidualShortfallMinor,
        allocations: (decision.allocations ?? []).map((a) => ({
          instrumentId: a.instrumentId,
          amount: a.amountMinor,
          name: a.name,
          annualRateBps: a.annualRateBps,
          penaltyBps: a.penaltyBps,
        })),
        status: decision.status,
        expectedNetYield: decision.expectedNetYieldMinor,
        explanation: decision.explanation,
        explanationDetails: structuredExplanation,
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
