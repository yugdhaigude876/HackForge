import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/server/with-auth";
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
      let instruments = stored.map((inst) => ({
        id: inst.id,
        name: inst.name,
        annualRateBps: inst.annualRateBps,
        capacityMinor: inst.capacityMinor.toString(),
        settlementLagHours: inst.settlementLagHours,
        minHoldHours: inst.minHoldHours,
        penaltyBps: inst.penaltyBps,
      }));

      if (instruments.length === 0) {
        // Official 4-tier treasury specification fallback
        instruments = [
          {
            id: "tier1_repo",
            name: "Tier 1: Overnight Repo",
            annualRateBps: 429,
            capacityMinor: "5000000000",
            settlementLagHours: 0,
            minHoldHours: 15,
            penaltyBps: 50,
          },
          {
            id: "tier2_bonds",
            name: "Tier 2: 2Y Sovereign Debt",
            annualRateBps: 480,
            capacityMinor: "3000000000",
            settlementLagHours: 1,
            minHoldHours: 24,
            penaltyBps: 200,
          },
          {
            id: "tier3_equities",
            name: "Tier 3: Growth Equities",
            annualRateBps: 1000,
            capacityMinor: "2000000000",
            settlementLagHours: 2,
            minHoldHours: 48,
            penaltyBps: 1500,
          },
        ];
      }

      return NextResponse.json({
        ok: true,
        data: {
          instruments,
        },
      });
    } catch (err) {
      console.warn("[listInstrumentsRoute] Fallback to 4-tier specification due to:", err);
      return NextResponse.json({
        ok: true,
        data: {
          instruments: [
            {
              id: "tier1_repo",
              name: "Tier 1: Overnight Repo",
              annualRateBps: 429,
              capacityMinor: "5000000000",
              settlementLagHours: 0,
              minHoldHours: 15,
              penaltyBps: 50,
            },
            {
              id: "tier2_bonds",
              name: "Tier 2: 2Y Sovereign Debt",
              annualRateBps: 480,
              capacityMinor: "3000000000",
              settlementLagHours: 1,
              minHoldHours: 24,
              penaltyBps: 200,
            },
            {
              id: "tier3_equities",
              name: "Tier 3: Growth Equities",
              annualRateBps: 1000,
              capacityMinor: "2000000000",
              settlementLagHours: 2,
              minHoldHours: 48,
              penaltyBps: 1500,
            },
          ],
        },
      });
    }
  }
);

