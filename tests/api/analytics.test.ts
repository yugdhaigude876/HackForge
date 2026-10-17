import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as getForecastAnalyticsHandler } from "@/app/api/analytics/forecast/route";
import { GET as getPolicyAnalyticsHandler } from "@/app/api/analytics/policies/route";
import { GET as getDecisionByIdHandler } from "@/app/api/decisions/[id]/route";
import { forecastsRepo, type ForecastRecord } from "@/server/repositories/forecasts";
import { simulationsRepo, type SimulationRecord } from "@/server/repositories/simulations";
import { decisionsRepo, type DecisionRecord } from "@/server/repositories/decisions";
import { instrumentsRepo } from "@/server/repositories/instruments";
import { seriesRepo } from "@/server/repositories/series";
import { Money } from "@/engine/money";
import {
  setTokenVerifier,
  setMembershipStore,
  type TokenVerifier,
  type MembershipStore,
  type AuthenticatedUser,
  type OrgRole,
} from "@/server/auth";

class TestTokenVerifier implements TokenVerifier {
  tokens: Record<string, AuthenticatedUser> = {
    "valid-viewer-token": { uid: "viewer-1", email: "viewer@bank.internal" },
    "valid-analyst-token": { uid: "analyst-1", email: "analyst@bank.internal" },
    "outsider-token": { uid: "outsider-1", email: "outsider@evil.com" },
  };

  async verifyIdToken(token: string): Promise<AuthenticatedUser> {
    const user = this.tokens[token];
    if (!user) throw new Error("Invalid token signature");
    return user;
  }
}

class TestMembershipStore implements MembershipStore {
  memberships: Record<string, Record<string, OrgRole>> = {
    org_bank_a: {
      "viewer-1": "viewer",
      "analyst-1": "analyst",
    },
    org_bank_b: {
      "analyst-1": "analyst",
    },
  };

  async getRole(orgId: string, uid: string): Promise<OrgRole | null> {
    return this.memberships[orgId]?.[uid] ?? null;
  }
}

function createGetRequest(
  url: string,
  token = "valid-viewer-token",
  orgId = "org_bank_a"
): NextRequest {
  const headers = new Headers({
    Authorization: `Bearer ${token}`,
    "x-org-id": orgId,
  });

  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method: "GET",
    headers,
  });
}

describe("Analytics API Routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setTokenVerifier(new TestTokenVerifier());
    setMembershipStore(new TestMembershipStore());
  });

  describe("GET /api/analytics/forecast", () => {
    it("enforces authentication and organization membership", async () => {
      // Unauthenticated request
      const unauthReq = new NextRequest("http://localhost:3000/api/analytics/forecast", {
        headers: { "x-org-id": "org_bank_a" },
      });
      const unauthRes = await getForecastAnalyticsHandler(unauthReq);
      expect(unauthRes.status).toBe(401);

      // Outsider user
      const outsiderReq = createGetRequest("http://localhost:3000/api/analytics/forecast", "outsider-token", "org_bank_a");
      const outsiderRes = await getForecastAnalyticsHandler(outsiderReq);
      expect(outsiderRes.status).toBe(403);
    });

    it("returns clean null fields when no forecast exists in the organisation", async () => {
      vi.spyOn(forecastsRepo, "list").mockResolvedValue([]);

      const req = createGetRequest("http://localhost:3000/api/analytics/forecast");
      const res = await getForecastAnalyticsHandler(req);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.forecastId).toBeNull();
      expect(json.data.evaluation).toBeNull();
      expect(json.data.reason).toContain("No forecast records");
    });

    it("returns comparative metrics and skill scores for stored forecast", async () => {
      const mockForecast: ForecastRecord = {
        id: "fc_stored_1",
        orgId: "org_bank_a",
        method: "Hour-of-Week Empirical Bayes",
        params: { lambda: 0.3, seed: "analytics-seed-42" },
        asOf: new Date("2026-10-15T00:00:00.000Z"),
        horizon: 24,
        points: [],
        residualQuantiles: { "0.05": -25000000, "0.95": 25000000 },
        backtest: {
          mase: 0.88,
          pinball: 1420.5,
          skillVsBaseline: 0.12,
          sampleSize: 96,
        },
        source: "synthetic",
        createdAt: new Date(),
        createdBy: "analyst-1",
      };

      vi.spyOn(forecastsRepo, "list").mockResolvedValue([mockForecast]);
      vi.spyOn(seriesRepo, "listRange").mockResolvedValue([]); // short series fallback

      const req = createGetRequest("http://localhost:3000/api/analytics/forecast");
      const res = await getForecastAnalyticsHandler(req);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.forecastId).toBe("fc_stored_1");
      expect(json.data.seed).toBe("analytics-seed-42");
      expect(json.data.source).toBe("synthetic");
      expect(json.data.windowCount).toBe(96);
      expect(json.data.evaluation.model.mase).toBe(0.88);
      expect(json.data.evaluation.skillScores.vsSeasonalNaive.mase.skill).toBe(0.12);
      expect(json.data.evaluation.skillScores.vsSeasonalNaive.mase.isBetter).toBe(true);
    });
  });

  describe("GET /api/analytics/policies", () => {
    it("returns empty policy list when no comparisons exist", async () => {
      vi.spyOn(simulationsRepo, "list").mockResolvedValue([]);

      const req = createGetRequest("http://localhost:3000/api/analytics/policies");
      const res = await getPolicyAnalyticsHandler(req);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.totalComparisonsCounted).toBe(0);
      expect(json.data.policies).toEqual([]);
    });

    it("aggregates simulation comparison records sharing a comparisonId and evaluates head-to-head vs hold-all-cash", async () => {
      const mockRuns: SimulationRecord[] = [
        // Comparison 1
        {
          id: "sim_1_rj",
          orgId: "org_bank_a",
          comparisonId: "cmp_1",
          scenario: "deposit-shock",
          seed: "seed-100",
          policy: "reserve-juggler",
          metrics: {
            netYieldMinor: "500000",
            shortfallFrequency: 0.0,
            totalPenaltiesPaidMinor: "1000",
            totalBorrowingCostMinor: "0",
            trials: 50,
          },
          createdAt: new Date(),
          createdBy: "analyst-1",
        },
        {
          id: "sim_1_hac",
          orgId: "org_bank_a",
          comparisonId: "cmp_1",
          scenario: "deposit-shock",
          seed: "seed-100",
          policy: "hold-all-cash",
          metrics: {
            netYieldMinor: "0",
            shortfallFrequency: 0.05,
            totalPenaltiesPaidMinor: "0",
            totalBorrowingCostMinor: "5000",
            trials: 50,
          },
          createdAt: new Date(),
          createdBy: "analyst-1",
        },
        // Comparison 2
        {
          id: "sim_2_rj",
          orgId: "org_bank_a",
          comparisonId: "cmp_2",
          scenario: "deposit-shock",
          seed: "seed-200",
          policy: "reserve-juggler",
          metrics: {
            netYieldMinor: "700000",
            shortfallFrequency: 0.01,
            totalPenaltiesPaidMinor: "2000",
            totalBorrowingCostMinor: "500",
            trials: 50,
          },
          createdAt: new Date(),
          createdBy: "analyst-1",
        },
        {
          id: "sim_2_hac",
          orgId: "org_bank_a",
          comparisonId: "cmp_2",
          scenario: "deposit-shock",
          seed: "seed-200",
          policy: "hold-all-cash",
          metrics: {
            netYieldMinor: "0",
            shortfallFrequency: 0.08,
            totalPenaltiesPaidMinor: "0",
            totalBorrowingCostMinor: "10000",
            trials: 50,
          },
          createdAt: new Date(),
          createdBy: "analyst-1",
        },
      ];

      vi.spyOn(simulationsRepo, "list").mockResolvedValue(mockRuns);

      const req = createGetRequest("http://localhost:3000/api/analytics/policies");
      const res = await getPolicyAnalyticsHandler(req);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.totalComparisonsCounted).toBe(2);

      const rj = json.data.policies.find((p: { policy: string }) => p.policy === "reserve-juggler");
      expect(rj).toBeDefined();
      expect(rj.comparisonsCounted).toBe(2);
      expect(rj.trialsTotal).toBe(100);
      // Mean net yield: (500000 + 700000) / 2 = 600000 cents
      expect(rj.netYield.meanMinor).toBe("600000");
      expect(rj.netYield.minMinor).toBe("500000");
      expect(rj.netYield.maxMinor).toBe("700000");

      // Head-to-head vs hold-all-cash
      expect(rj.headToHeadVsHoldAllCash).toBeDefined();
      expect(rj.headToHeadVsHoldAllCash.comparisonsCounted).toBe(2);
      expect(rj.headToHeadVsHoldAllCash.netYieldWins).toBe(2);
      expect(rj.headToHeadVsHoldAllCash.shortfallWins).toBe(2);
    });
  });

  describe("GET /api/decisions/[id] explanation enrichment", () => {
    it("includes explanationDetails additive field with step-by-step numbers", async () => {
      const mockDecision: DecisionRecord = {
        id: "dec_123",
        orgId: "org_bank_a",
        forecastId: "fc_1",
        confidence: 0.95,
        reserve: Money.fromMinor(400000000n),
        reserveMinor: "400000000",
        surplus: Money.fromMinor(100000000n),
        surplusMinor: "100000000",
        availableCash: Money.fromMinor(500000000n),
        availableCashMinor: "500000000",
        operationalFloor: Money.fromMinor(200000000n),
        operationalFloorMinor: "200000000",
        expectedCumulativeFlow: Money.fromMinor(-50000000n),
        expectedCumulativeFlowMinor: "-50000000",
        worstCaseResidualShortfall: Money.fromMinor(-150000000n),
        worstCaseResidualShortfallMinor: "-150000000",
        allocations: [],
        status: "HEALTHY",
        expectedNetYield: Money.fromMinor(45000n),
        expectedNetYieldMinor: "45000",
        explanation: "Decision healthy",
        createdAt: new Date(),
        createdBy: "analyst-1",
      };

      vi.spyOn(decisionsRepo, "get").mockResolvedValue(mockDecision);
      vi.spyOn(instrumentsRepo, "list").mockResolvedValue([]);

      const req = createGetRequest("http://localhost:3000/api/decisions/dec_123");
      const res = await getDecisionByIdHandler(req, {
        params: Promise.resolve({ id: "dec_123" }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.id).toBe("dec_123");
      expect(json.data.explanationDetails).toBeDefined();
      expect(json.data.explanationDetails.steps).toHaveLength(7);
      expect(json.data.explanationDetails.status).toBe("HEALTHY");
      expect(json.data.explanationDetails.steps[0].symbol).toBe("μ");
      expect(json.data.explanationDetails.steps[4].symbol).toBe("R");
      expect(json.data.explanationDetails.steps[4].valueFormatted).toBe("$4,000,000.00");
    });
  });
});
