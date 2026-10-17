import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as summaryHandler } from "@/app/api/dashboard/summary/route";
import {
  POST as runHandler,
  _resetDashboardRunRateLimiter,
} from "@/app/api/dashboard/run/route";
import { decisionsRepo, type DecisionRecord } from "@/server/repositories/decisions";
import { forecastsRepo, type ForecastRecord } from "@/server/repositories/forecasts";
import { instrumentsRepo } from "@/server/repositories/instruments";
import { auditRepo, type AuditRecord } from "@/server/repositories/audit";
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
    "valid-analyst-token": { uid: "analyst-1", email: "analyst@bank.internal" },
    "valid-viewer-token": { uid: "viewer-1", email: "viewer@bank.internal" },
    "valid-admin-token": { uid: "admin-1", email: "admin@bank.internal" },
  };

  async verifyIdToken(token: string): Promise<AuthenticatedUser> {
    const user = this.tokens[token];
    if (!user) throw new Error("Invalid token");
    return user;
  }
}

class TestMembershipStore implements MembershipStore {
  memberships: Record<string, Record<string, OrgRole>> = {
    org_treasury: {
      "analyst-1": "analyst",
      "viewer-1": "viewer",
      "admin-1": "admin",
    },
    org_other: {
      "analyst-1": "viewer",
    },
  };

  async getRole(orgId: string, uid: string): Promise<OrgRole | null> {
    return this.memberships[orgId]?.[uid] ?? null;
  }
}

function createRequest(
  url: string,
  options: {
    method?: string;
    token?: string;
    orgId?: string;
    body?: unknown;
  } = {}
): NextRequest {
  const token = options.token ?? "valid-analyst-token";
  const orgId = options.orgId ?? "org_treasury";
  const headers = new Headers({
    Authorization: `Bearer ${token}`,
    "x-org-id": orgId,
  });

  if (options.body) {
    headers.set("Content-Type", "application/json");
  }

  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
}

describe("Dashboard API Routes (Phase 17)", () => {
  beforeEach(() => {
    setTokenVerifier(new TestTokenVerifier());
    setMembershipStore(new TestMembershipStore());
    _resetDashboardRunRateLimiter();
    vi.restoreAllMocks();
  });

  describe("GET /api/dashboard/summary", () => {
    it("returns null fields when no runs exist yet (not an error)", async () => {
      vi.spyOn(decisionsRepo, "list").mockResolvedValue([]);
      vi.spyOn(forecastsRepo, "list").mockResolvedValue([]);

      const req = createRequest("http://localhost:3000/api/dashboard/summary", {
        token: "valid-viewer-token",
      });

      const res = await summaryHandler(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.decision).toBeNull();
      expect(json.data.forecast).toBeNull();
      expect(json.data.actuals).toEqual([]);
      expect(json.data.userRole).toBe("viewer");
    });

    it("enforces authentication and organization membership", async () => {
      const unauthReq = new NextRequest("http://localhost:3000/api/dashboard/summary");
      const unauthRes = await summaryHandler(unauthReq);
      expect(unauthRes.status).toBe(400); // Missing x-org-id header

      const outsiderReq = createRequest("http://localhost:3000/api/dashboard/summary", {
        token: "valid-analyst-token",
        orgId: "org_unknown",
      });
      const outsiderRes = await summaryHandler(outsiderReq);
      expect(outsiderRes.status).toBe(403);
    });

    it("returns serialized decision and forecast with stored cash and quantiles", async () => {
      const mockDecision = {
        id: "dec_1",
        orgId: "org_treasury",
        forecastId: "fc_1",
        confidence: 0.99,
        reserve: Money.fromMinor(10_000_000_00n, "USD"),
        reserveMinor: "1000000000",
        surplus: Money.fromMinor(40_000_000_00n, "USD"),
        surplusMinor: "4000000000",
        availableCash: Money.fromMinor(50_000_000_00n, "USD"),
        availableCashMinor: "5000000000",
        deployedTotalMinor: "0",
        operationalFloorMinor: "1000000000",
        horizonHours: 24,
        alpha: 0.01,
        expectedCumulativeFlowMinor: "200000000",
        worstCaseResidualShortfallMinor: "-300000000",
        backtest: { mase: 0.82, sampleSize: 45 },
        allocations: [
          {
            instrumentId: "inst_treasury",
            name: "Treasury 3M",
            amount: Money.fromMinor(40_000_000_00n, "USD"),
            amountMinor: "4000000000",
            annualRateBps: 520,
            settlementLagHours: 24,
            penaltyBps: 15,
            capacityMinor: "5000000000",
          },
        ],
        status: "HEALTHY",
        expectedNetYield: Money.fromMinor(50_000_00n, "USD"),
        expectedNetYieldMinor: "5000000",
        explanation: "Decision healthy",
        source: "synthetic" as const,
        createdAt: new Date("2026-03-01T12:00:00Z"),
        createdBy: "analyst-1",
      };

      const mockForecast = {
        id: "fc_1",
        orgId: "org_treasury",
        method: "hour_of_week",
        params: {},
        asOf: new Date("2026-03-01T12:00:00Z"),
        horizon: 24,
        points: [
          {
            ts: new Date("2026-03-01T13:00:00Z"),
            mean: Money.fromMinor(1_000_000_00n, "USD"),
            meanMinor: "100000000",
            bandLowerMinor: "85000000",
            bandUpperMinor: "115000000",
          },
        ],
        residualQuantiles: { mase: 0.82 },
        backtest: { mase: 0.82, pinball: 0.05, sampleSize: 45 },
        source: "synthetic" as const,
        createdAt: new Date("2026-03-01T12:00:00Z"),
        createdBy: "analyst-1",
      };

      vi.spyOn(decisionsRepo, "list").mockResolvedValue([mockDecision]);
      vi.spyOn(forecastsRepo, "get").mockResolvedValue(mockForecast);

      const req = createRequest("http://localhost:3000/api/dashboard/summary");
      const res = await summaryHandler(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.decision.availableCashMinor).toBe("5000000000");
      expect(json.data.decision.allocations[0].name).toBe("Treasury 3M");
      expect(json.data.decision.backtest.mase).toBe(0.82);
      expect(json.data.forecast.points[0].bandLowerMinor).toBe("85000000");
      expect(json.data.decision.source).toBe("synthetic");
    });
  });

  describe("POST /api/dashboard/run", () => {
    it("enforces minimum role analyst and forbids viewers", async () => {
      const req = createRequest("http://localhost:3000/api/dashboard/run", {
        method: "POST",
        token: "valid-viewer-token",
        body: { source: "synthetic" },
      });

      const res = await runHandler(req);
      expect(res.status).toBe(403);
    });

    it("returns 400 VALIDATION_ERROR when organisation has no configured instruments", async () => {
      vi.spyOn(instrumentsRepo, "list").mockResolvedValue([]);

      const req = createRequest("http://localhost:3000/api/dashboard/run", {
        method: "POST",
        body: { source: "synthetic" },
      });

      const res = await runHandler(req);
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.message).toContain("No yield instruments configured");
    });

    it("persists forecast, decision, and audit entries with source: 'synthetic'", async () => {
      const mockInstrument = {
        id: "inst_overnight",
        orgId: "org_treasury",
        name: "Overnight Repo",
        annualRateBps: 480,
        settlementLagHours: 0,
        penaltyBps: 0,
        capacity: Money.fromMinor(100_000_000_00n, "USD"),
        capacityMinor: "10000000000",
        minHoldHours: 0,
        createdAt: new Date(),
        createdBy: "admin",
      };

      vi.spyOn(instrumentsRepo, "list").mockResolvedValue([mockInstrument]);

      const createForecastSpy = vi.spyOn(forecastsRepo, "create").mockResolvedValue({
        id: "fc_run_123",
        orgId: "org_treasury",
        method: "hour_of_week",
        params: {},
        asOf: new Date(),
        horizon: 24,
        points: [],
        residualQuantiles: {},
        backtest: { mase: 0.81, pinball: 0.05, sampleSize: 35 },
        source: "synthetic",
        createdAt: new Date(),
        createdBy: "analyst-1",
      });

      const createDecisionSpy = vi.spyOn(decisionsRepo, "create").mockResolvedValue({
        id: "dec_run_123",
        orgId: "org_treasury",
        forecastId: "fc_run_123",
        confidence: 0.99,
        reserve: Money.fromMinor(12_000_000_00n, "USD"),
        reserveMinor: "1200000000",
        surplus: Money.fromMinor(38_000_000_00n, "USD"),
        surplusMinor: "3800000000",
        availableCash: Money.fromMinor(50_000_000_00n, "USD"),
        availableCashMinor: "5000000000",
        deployedTotalMinor: "0",
        operationalFloorMinor: "1000000000",
        horizonHours: 24,
        alpha: 0.01,
        expectedCumulativeFlowMinor: "150000000",
        worstCaseResidualShortfallMinor: "-350000000",
        backtest: { mase: 0.81, sampleSize: 35 },
        allocations: [
          {
            instrumentId: "inst_overnight",
            name: "Overnight Repo",
            amount: Money.fromMinor(38_000_000_00n, "USD"),
            amountMinor: "3800000000",
            annualRateBps: 480,
            settlementLagHours: 0,
            penaltyBps: 0,
            capacityMinor: "10000000000",
          },
        ],
        status: "HEALTHY",
        expectedNetYield: Money.fromMinor(40_000_00n, "USD"),
        expectedNetYieldMinor: "4000000",
        explanation: "Decision run successfully",
        source: "synthetic",
        createdAt: new Date(),
        createdBy: "analyst-1",
      });

      const auditSpy = vi.spyOn(auditRepo, "append").mockResolvedValue({
        id: "audit_run_1",
        orgId: "org_treasury",
        actorUid: "analyst-1",
        action: "decision.create",
        refPath: "orgs/org_treasury/decisions/dec_run_123",
        afterHash: "hash",
        ts: new Date(),
        createdAt: new Date(),
      });

      const req = createRequest("http://localhost:3000/api/dashboard/run", {
        method: "POST",
        body: {
          source: "synthetic",
          seed: "test-seed-456",
          horizonHours: 24,
        },
      });

      const res = await runHandler(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.decision.id).toBe("dec_run_123");
      expect(json.data.decision.source).toBe("synthetic");
      expect(json.data.forecast.id).toBe("fc_run_123");

      expect(createForecastSpy).toHaveBeenCalledTimes(1);
      expect(createForecastSpy).toHaveBeenCalledWith("org_treasury", expect.objectContaining({
        source: "synthetic",
      }), "analyst-1");

      expect(createDecisionSpy).toHaveBeenCalledTimes(1);
      expect(createDecisionSpy).toHaveBeenCalledWith("org_treasury", expect.objectContaining({
        source: "synthetic",
        forecastId: "fc_run_123",
      }), "analyst-1");

      expect(auditSpy).toHaveBeenCalled();
    });

    it("rate limits rapid re-runs and returns 429 with Retry-After header", async () => {
      const mockInstrument = {
        id: "inst_1",
        orgId: "org_treasury",
        name: "Liquid Cash",
        annualRateBps: 450,
        settlementLagHours: 0,
        penaltyBps: 0,
        capacity: Money.fromMinor(100_000_000_00n, "USD"),
        capacityMinor: "10000000000",
        minHoldHours: 0,
        createdAt: new Date(),
        createdBy: "admin",
      };
      vi.spyOn(instrumentsRepo, "list").mockResolvedValue([mockInstrument]);
      vi.spyOn(forecastsRepo, "create").mockResolvedValue({ id: "fc_1", points: [] } as unknown as ForecastRecord);
      vi.spyOn(decisionsRepo, "create").mockResolvedValue({ id: "dec_1", allocations: [] } as unknown as DecisionRecord);
      vi.spyOn(auditRepo, "append").mockResolvedValue({} as unknown as AuditRecord);

      const req1 = createRequest("http://localhost:3000/api/dashboard/run", {
        method: "POST",
        body: { source: "synthetic" },
      });
      const res1 = await runHandler(req1);
      expect(res1.status).toBe(200);

      // Immediate second call should be rate limited
      const req2 = createRequest("http://localhost:3000/api/dashboard/run", {
        method: "POST",
        body: { source: "synthetic" },
      });
      const res2 = await runHandler(req2);
      expect(res2.status).toBe(429);

      const json2 = await res2.json();
      expect(json2.ok).toBe(false);
      expect(json2.error.code).toBe("RATE_LIMITED");
      expect(res2.headers.get("Retry-After")).toBeDefined();
    });
  });
});
