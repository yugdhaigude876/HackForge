import { NextRequest, NextResponse } from "next/server";
import { withAuth, createErrorResponse } from "@/server/with-auth";
import { simulationsRepo, type SimulationRecord } from "@/server/repositories/simulations";
import type { OrgAuthContext } from "@/server/auth";

interface PolicyMetricsSummary {
  policy: string;
  comparisonsCounted: number;
  trialsTotal: number;
  uniqueSeeds: string[];
  netYield: {
    meanMinor: string;
    minMinor: string;
    maxMinor: string;
  };
  shortfallFrequency: {
    mean: number;
    min: number;
    max: number;
  };
  penalties: {
    meanMinor: string;
    minMinor: string;
    maxMinor: string;
  };
  borrowingCost: {
    meanMinor: string;
    minMinor: string;
    maxMinor: string;
  };
  headToHeadVsHoldAllCash: {
    comparisonsCounted: number;
    netYieldWins: number;
    netYieldTies: number;
    shortfallWins: number;
    shortfallTies: number;
  } | null;
}

/**
 * Extracts a BigInt minor unit string from a simulation record's metrics object.
 */
function extractMinor(metrics: Record<string, unknown>, keys: string[]): bigint {
  for (const k of keys) {
    const val = metrics[k];
    if (typeof val === "string" && /^-?\d+$/.test(val)) {
      return BigInt(val);
    }
    if (typeof val === "number" && Number.isFinite(val)) {
      return BigInt(Math.round(val));
    }
  }
  return 0n;
}

/**
 * Extracts a numeric rate or frequency [0, 1] from metrics.
 */
function extractNumber(metrics: Record<string, unknown>, keys: string[]): number {
  for (const k of keys) {
    const val = metrics[k];
    if (typeof val === "number" && Number.isFinite(val)) {
      return val;
    }
    if (typeof val === "string") {
      const parsed = parseFloat(val);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

/**
 * GET /api/analytics/policies
 * Minimum role: viewer.
 * Aggregates stored multi-policy simulation comparisons into deterministic summary metrics,
 * reporting only what is stored across shared comparisonId groups.
 * Money amounts are strictly formatted as integer strings in minor units (cents).
 */
export const GET = withAuth(
  async function getPolicyAnalyticsRoute(
    _request: NextRequest,
    authContext: OrgAuthContext
  ): Promise<NextResponse> {
    try {
      const orgId = authContext.orgId;

      // 1. Fetch recent simulation runs
      const records = await simulationsRepo.list(orgId, { limit: 100 });

      // 2. Group records by comparisonId
      const comparisonGroups = new Map<string, SimulationRecord[]>();
      for (const rec of records) {
        if (!rec.comparisonId) continue;
        const group = comparisonGroups.get(rec.comparisonId) ?? [];
        group.push(rec);
        comparisonGroups.set(rec.comparisonId, group);
      }

      if (comparisonGroups.size === 0) {
        return NextResponse.json({
          ok: true,
          data: {
            totalComparisonsCounted: 0,
            totalSimulationsAnalyzed: records.length,
            policies: [],
            reason: "No multi-policy comparison simulations stored for organisation.",
          },
        });
      }

      // Tracking containers per policy
      interface PolicyDataCollector {
        netYields: bigint[];
        shortfallFreqs: number[];
        penalties: bigint[];
        borrowingCosts: bigint[];
        trials: number[];
        seeds: Set<string>;
        h2hComparisons: number;
        h2hNetYieldWins: number;
        h2hNetYieldTies: number;
        h2hShortfallWins: number;
        h2hShortfallTies: number;
      }

      const policyCollectors = new Map<string, PolicyDataCollector>();

      function getCollector(policy: string): PolicyDataCollector {
        let coll = policyCollectors.get(policy);
        if (!coll) {
          coll = {
            netYields: [],
            shortfallFreqs: [],
            penalties: [],
            borrowingCosts: [],
            trials: [],
            seeds: new Set<string>(),
            h2hComparisons: 0,
            h2hNetYieldWins: 0,
            h2hNetYieldTies: 0,
            h2hShortfallWins: 0,
            h2hShortfallTies: 0,
          };
          policyCollectors.set(policy, coll);
        }
        return coll;
      }

      // 3. Process each comparison group
      for (const [, group] of comparisonGroups.entries()) {
        // Build map of policy -> record for this comparison
        const byPolicyInCmp = new Map<string, {
          rec: SimulationRecord;
          netYield: bigint;
          shortfallFreq: number;
          penalties: bigint;
          borrowingCost: bigint;
        }>();

        for (const rec of group) {
          const policyKey = typeof rec.policy === "string" ? rec.policy : "unknown";
          const metrics = rec.metrics ?? {};

          const netYield = extractMinor(metrics, ["netYieldMinor", "netYield"]);
          const shortfallFreq = extractNumber(metrics, ["shortfallFrequency"]);
          const penalties = extractMinor(metrics, ["totalPenaltiesPaidMinor", "penaltiesPaidMinor", "penaltiesPaid"]);
          const borrowingCost = extractMinor(metrics, ["totalBorrowingCostMinor", "borrowingCostMinor", "borrowingCost"]);
          const trials = typeof metrics.trials === "number" ? metrics.trials : 0;
          const seedStr = String(rec.seed);

          const coll = getCollector(policyKey);
          coll.netYields.push(netYield);
          coll.shortfallFreqs.push(shortfallFreq);
          coll.penalties.push(penalties);
          coll.borrowingCosts.push(borrowingCost);
          coll.trials.push(trials);
          coll.seeds.add(seedStr);

          byPolicyInCmp.set(policyKey, {
            rec,
            netYield,
            shortfallFreq,
            penalties,
            borrowingCost,
          });
        }

        // Head-to-head evaluation against hold-all-cash baseline if present
        const holdAllCash = byPolicyInCmp.get("hold-all-cash");
        if (holdAllCash) {
          for (const [pKey, pData] of byPolicyInCmp.entries()) {
            if (pKey === "hold-all-cash") continue;
            const coll = getCollector(pKey);
            coll.h2hComparisons++;

            if (pData.netYield > holdAllCash.netYield) {
              coll.h2hNetYieldWins++;
            } else if (pData.netYield === holdAllCash.netYield) {
              coll.h2hNetYieldTies++;
            }

            if (pData.shortfallFreq < holdAllCash.shortfallFreq) {
              coll.h2hShortfallWins++;
            } else if (pData.shortfallFreq === holdAllCash.shortfallFreq) {
              coll.h2hShortfallTies++;
            }
          }
        }
      }

      // 4. Build output summaries
      const policySummaries: PolicyMetricsSummary[] = [];

      for (const [policy, coll] of policyCollectors.entries()) {
        const count = coll.netYields.length;
        if (count === 0) continue;

        // Net yield min, max, mean (BigInt integer division)
        let totalNetYield = 0n;
        let minNetYield = coll.netYields[0];
        let maxNetYield = coll.netYields[0];

        for (const y of coll.netYields) {
          totalNetYield += y;
          if (y < minNetYield) minNetYield = y;
          if (y > maxNetYield) maxNetYield = y;
        }
        const meanNetYield = totalNetYield / BigInt(count);

        // Shortfall frequency min, max, mean
        let totalShortfall = 0;
        let minShortfall = coll.shortfallFreqs[0];
        let maxShortfall = coll.shortfallFreqs[0];
        for (const sf of coll.shortfallFreqs) {
          totalShortfall += sf;
          if (sf < minShortfall) minShortfall = sf;
          if (sf > maxShortfall) maxShortfall = sf;
        }
        const meanShortfall = totalShortfall / count;

        // Penalties min, max, mean
        let totalPenalties = 0n;
        let minPenalties = coll.penalties[0];
        let maxPenalties = coll.penalties[0];
        for (const p of coll.penalties) {
          totalPenalties += p;
          if (p < minPenalties) minPenalties = p;
          if (p > maxPenalties) maxPenalties = p;
        }
        const meanPenalties = totalPenalties / BigInt(count);

        // Borrowing cost min, max, mean
        let totalBorrowing = 0n;
        let minBorrowing = coll.borrowingCosts[0];
        let maxBorrowing = coll.borrowingCosts[0];
        for (const b of coll.borrowingCosts) {
          totalBorrowing += b;
          if (b < minBorrowing) minBorrowing = b;
          if (b > maxBorrowing) maxBorrowing = b;
        }
        const meanBorrowing = totalBorrowing / BigInt(count);

        const totalTrials = coll.trials.reduce((sum, t) => sum + t, 0);

        let h2hVsHoldAllCash: PolicyMetricsSummary["headToHeadVsHoldAllCash"] = null;
        if (policy !== "hold-all-cash" && coll.h2hComparisons > 0) {
          h2hVsHoldAllCash = {
            comparisonsCounted: coll.h2hComparisons,
            netYieldWins: coll.h2hNetYieldWins,
            netYieldTies: coll.h2hNetYieldTies,
            shortfallWins: coll.h2hShortfallWins,
            shortfallTies: coll.h2hShortfallTies,
          };
        }

        policySummaries.push({
          policy,
          comparisonsCounted: count,
          trialsTotal: totalTrials,
          uniqueSeeds: Array.from(coll.seeds),
          netYield: {
            meanMinor: meanNetYield.toString(),
            minMinor: minNetYield.toString(),
            maxMinor: maxNetYield.toString(),
          },
          shortfallFrequency: {
            mean: meanShortfall,
            min: minShortfall,
            max: maxShortfall,
          },
          penalties: {
            meanMinor: meanPenalties.toString(),
            minMinor: minPenalties.toString(),
            maxMinor: maxPenalties.toString(),
          },
          borrowingCost: {
            meanMinor: meanBorrowing.toString(),
            minMinor: minBorrowing.toString(),
            maxMinor: maxBorrowing.toString(),
          },
          headToHeadVsHoldAllCash: h2hVsHoldAllCash,
        });
      }

      return NextResponse.json({
        ok: true,
        data: {
          totalComparisonsCounted: comparisonGroups.size,
          totalSimulationsAnalyzed: records.length,
          policies: policySummaries,
        },
      });
    } catch (error) {
      console.error("[getPolicyAnalyticsRoute Error]:", error);
      return createErrorResponse(
        500,
        "INTERNAL",
        "An internal error occurred while aggregating policy comparison analytics."
      );
    }
  },
  { minRole: "viewer" }
);
