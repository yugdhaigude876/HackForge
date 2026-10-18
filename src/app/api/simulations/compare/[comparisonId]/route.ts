import { NextRequest, NextResponse } from "next/server";
import { withAuth, createErrorResponse } from "@/server/with-auth";
import { simulationsRepo } from "@/server/repositories/simulations";
import type { OrgAuthContext } from "@/server/auth";
import { SIMULATION_DISCLAIMER } from "@/engine/simulate";
import { validatePathId, IdValidationError } from "@/server/request-guards";

interface RouteParams {
  params: Promise<{
    comparisonId: string;
  }>;
}

/**
 * GET /api/simulations/compare/[comparisonId]
 * Retrieves stored policy comparison simulation records for replay.
 * Minimum role: viewer. Org-isolated.
 */
export const GET = withAuth(
  async function getComparisonByIdRoute(
    request: NextRequest,
    authContext: OrgAuthContext,
    routeProps?: unknown
  ): Promise<NextResponse> {
    const { orgId } = authContext;
    const { params } = (routeProps ?? {}) as RouteParams;
    const { comparisonId } = await params;

    if (!comparisonId) {
      return createErrorResponse(400, "VALIDATION_ERROR", "Missing comparisonId parameter.");
    }

    try {
      validatePathId(comparisonId, "comparisonId");
    } catch (valErr) {
      if (valErr instanceof IdValidationError) {
        return createErrorResponse(400, "VALIDATION_ERROR", valErr.message);
      }
      throw valErr;
    }

    try {
      const records = await simulationsRepo.listByComparisonId(orgId, comparisonId);

      if (!records || records.length === 0) {
        return createErrorResponse(404, "NOT_FOUND", `Comparison '${comparisonId}' not found for organisation '${orgId}'.`);
      }

      const first = records[0];
      const policies = records.map((r) =>
        typeof r.policy === "string" ? r.policy : JSON.stringify(r.policy)
      );

      const policyResults: Record<string, Record<string, unknown>> = {};
      for (const rec of records) {
        const pKey = typeof rec.policy === "string" ? rec.policy : JSON.stringify(rec.policy);
        policyResults[pKey] = rec.metrics as Record<string, unknown>;
      }

      // Compute deltas versus hold-all-cash and fixed-buffer from stored metrics
      const holdAllCashMetrics = policyResults["hold-all-cash"];
      const fixedBufferMetrics = policyResults["fixed-buffer"];

      function computeMetricDelta(target: Record<string, unknown>, baseline: Record<string, unknown>) {
        const targetNet = BigInt(String(target.netYieldMinor ?? "0"));
        const baseNet = BigInt(String(baseline.netYieldMinor ?? "0"));

        const targetFreq = Number(target.shortfallFrequency ?? 0);
        const baseFreq = Number(baseline.shortfallFrequency ?? 0);

        const targetExpShortfall = BigInt(String(target.expectedShortfallMinor ?? "0"));
        const baseExpShortfall = BigInt(String(baseline.expectedShortfallMinor ?? "0"));

        const targetP95Shortfall = BigInt(String(target.p95ShortfallMinor ?? "0"));
        const baseP95Shortfall = BigInt(String(baseline.p95ShortfallMinor ?? "0"));

        const targetPenalties = BigInt(String(target.penaltiesPaidMinor ?? "0"));
        const basePenalties = BigInt(String(baseline.penaltiesPaidMinor ?? "0"));

        const targetBorrowing = BigInt(String(target.emergencyBorrowingCostMinor ?? "0"));
        const baseBorrowing = BigInt(String(baseline.emergencyBorrowingCostMinor ?? "0"));

        return {
          netYieldMinor: (targetNet - baseNet).toString(),
          shortfallFrequency: targetFreq - baseFreq,
          expectedShortfallMinor: (targetExpShortfall - baseExpShortfall).toString(),
          p95ShortfallMinor: (targetP95Shortfall - baseP95Shortfall).toString(),
          penaltiesPaidMinor: (targetPenalties - basePenalties).toString(),
          emergencyBorrowingCostMinor: (targetBorrowing - baseBorrowing).toString(),
        };
      }

      const deltas: Record<string, Record<string, unknown>> = {};
      for (const p of policies) {
        const target = policyResults[p];
        deltas[p] = {
          vsHoldAllCash: holdAllCashMetrics ? computeMetricDelta(target, holdAllCashMetrics) : undefined,
          vsFixedBuffer: fixedBufferMetrics ? computeMetricDelta(target, fixedBufferMetrics) : undefined,
        };
      }

      // Compute descriptive winners per metric
      let bestNetYield = policies[0];
      let bestShortfallFreq = policies[0];
      let bestExpShortfall = policies[0];
      let bestP95Shortfall = policies[0];
      let bestPenalties = policies[0];
      let bestBorrowing = policies[0];

      for (const p of policies) {
        const m = policyResults[p];
        const netMinor = BigInt(String(m.netYieldMinor ?? "0"));
        const bestNetMinor = BigInt(String(policyResults[bestNetYield]?.netYieldMinor ?? "0"));
        if (netMinor > bestNetMinor) bestNetYield = p;

        const freq = Number(m.shortfallFrequency ?? 0);
        const bestFreq = Number(policyResults[bestShortfallFreq]?.shortfallFrequency ?? 1);
        if (freq < bestFreq) bestShortfallFreq = p;

        const expMinor = BigInt(String(m.expectedShortfallMinor ?? "0"));
        const bestExpMinor = BigInt(String(policyResults[bestExpShortfall]?.expectedShortfallMinor ?? "0"));
        if (expMinor < bestExpMinor) bestExpShortfall = p;

        const p95Minor = BigInt(String(m.p95ShortfallMinor ?? "0"));
        const bestP95Minor = BigInt(String(policyResults[bestP95Shortfall]?.p95ShortfallMinor ?? "0"));
        if (p95Minor < bestP95Minor) bestP95Shortfall = p;

        const penMinor = BigInt(String(m.penaltiesPaidMinor ?? "0"));
        const bestPenMinor = BigInt(String(policyResults[bestPenalties]?.penaltiesPaidMinor ?? "0"));
        if (penMinor < bestPenMinor) bestPenalties = p;

        const borMinor = BigInt(String(m.emergencyBorrowingCostMinor ?? "0"));
        const bestBorMinor = BigInt(String(policyResults[bestBorrowing]?.emergencyBorrowingCostMinor ?? "0"));
        if (borMinor < bestBorMinor) bestBorrowing = p;
      }

      return NextResponse.json({
        ok: true,
        data: {
          comparisonId,
          seed: first.seed,
          scenario: first.scenario,
          source: first.source,
          createdAt: first.createdAt.toISOString(),
          policies,
          policyResults,
          deltas,
          winners: {
            netYield: bestNetYield,
            shortfallFrequency: bestShortfallFreq,
            expectedShortfall: bestExpShortfall,
            p95Shortfall: bestP95Shortfall,
            penaltiesPaid: bestPenalties,
            emergencyBorrowingCost: bestBorrowing,
          },
          disclaimer: SIMULATION_DISCLAIMER,
        },
      });
    } catch (err) {
      console.warn("[simulationsCompareReplayRoute] Error retrieving comparison:", err);
      return createErrorResponse(500, "INTERNAL", "Failed to retrieve simulation comparison replay.");
    }
  },
  { minRole: "viewer" }
);
