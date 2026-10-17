import { NextRequest, NextResponse } from "next/server";
import { withAuth, createErrorResponse } from "@/server/with-auth";
import { simulationsRepo } from "@/server/repositories/simulations";
import { validateId, RepositoryError } from "@/server/repositories/common";
import type { OrgAuthContext } from "@/server/auth";

interface RouteContext {
  params: Promise<{ id: string }> | { id: string };
}

/**
 * GET /api/simulations/[id]
 * Retrieves a single simulation run record by ID within the authenticated organisation.
 * Minimum required role: viewer.
 */
export const GET = withAuth<RouteContext>(
  async function getSimulationByIdRoute(
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
          "Missing simulation ID in route path."
        );
      }

      try {
        validateId(id, "simulationId");
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

      const simulation = await simulationsRepo.get(authContext.orgId, id);
      if (!simulation) {
        return createErrorResponse(
          404,
          "NOT_FOUND",
          `Simulation '${id}' not found in organisation '${authContext.orgId}'.`
        );
      }

      return NextResponse.json({
        ok: true,
        data: {
          id: simulation.id,
          orgId: simulation.orgId,
          scenario: simulation.scenario,
          seed: simulation.seed,
          policy: simulation.policy,
          metrics: simulation.metrics,
          source: simulation.source,
          createdAt:
            simulation.createdAt instanceof Date
              ? simulation.createdAt.toISOString()
              : simulation.createdAt,
          createdBy: simulation.createdBy,
        },
      });
    } catch (error) {
      console.error("[getSimulationByIdRoute Error]:", error);
      return createErrorResponse(500, "INTERNAL", "Failed to retrieve simulation.");
    }
  },
  { minRole: "viewer" }
);

