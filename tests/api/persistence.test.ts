import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as forecastHandler } from "@/app/api/engine/forecast/route";
import { POST as decisionHandler } from "@/app/api/engine/decision/route";
import { forecastsRepo } from "@/server/repositories/forecasts";
import { decisionsRepo } from "@/server/repositories/decisions";
import { auditRepo } from "@/server/repositories/audit";
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
    },
  };

  async getRole(orgId: string, uid: string): Promise<OrgRole | null> {
    return this.memberships[orgId]?.[uid] ?? null;
  }
}

function createJsonRequest(url: string, body: unknown, token = "valid-analyst-token", orgId = "org_treasury"): NextRequest {
  const headers = new Headers({
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    "x-org-id": orgId,
  });

  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("Persistence and Audit Integration in Engine Routes", () => {
  beforeEach(() => {
    setTokenVerifier(new TestTokenVerifier());
    setMembershipStore(new TestMembershipStore());
    vi.restoreAllMocks();
  });

  describe("Forecast Route Persistence", () => {
    it("persists forecast and writes audit entry with stable SHA-256 hash", async () => {
      const mockForecastDoc = {
        id: "fc_mock_123",
        orgId: "org_treasury",
        method: "hour_of_week",
        params: {},
        asOf: new Date("2026-03-01T00:00:00.000Z"),
        horizon: 24,
        points: [],
        residualQuantiles: { mase: 0.85 },
        backtest: { mase: 0.85, pinball: 0.1, skillVsBaseline: 0.15 },
        createdAt: new Date(),
        createdBy: "analyst-1",
      };

      const createSpy = vi.spyOn(forecastsRepo, "create").mockResolvedValue(mockForecastDoc);
      const auditSpy = vi.spyOn(auditRepo, "append").mockResolvedValue({
        id: "audit_123",
        orgId: "org_treasury",
        actorUid: "analyst-1",
        action: "forecast.create",
        refPath: "orgs/org_treasury/forecasts/fc_mock_123",
        afterHash: "mock-hash",
        ts: new Date(),
        createdAt: new Date(),
      });

      const req = createJsonRequest("http://localhost:3000/api/engine/forecast", {
        method: "hour_of_week",
        horizonHours: 24,
        lookbackHours: 168,
      });

      const res = await forecastHandler(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.id).toBe("fc_mock_123");
      expect(json.persisted).toBe(true);
      expect(json.audited).toBe(true);
      expect(json.predictions).toBeDefined();

      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(createSpy).toHaveBeenCalledWith("org_treasury", expect.objectContaining({
        method: "hour_of_week",
        horizon: 24,
      }), "analyst-1");

      expect(auditSpy).toHaveBeenCalledTimes(1);
      const auditCall = auditSpy.mock.calls[0];
      expect(auditCall[0]).toBe("org_treasury");
      expect(auditCall[1].action).toBe("forecast.create");
      expect(auditCall[1].actorUid).toBe("analyst-1");
      expect(auditCall[1].refPath).toBe("orgs/org_treasury/forecasts/fc_mock_123");
      // SHA-256 hash length is 64 hex characters
      expect(auditCall[1].afterHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("surfaces persisted: false with a generic warning when repo write fails", async () => {
      vi.spyOn(forecastsRepo, "create").mockRejectedValue(new Error("Database write timeout"));
      const auditSpy = vi.spyOn(auditRepo, "append");

      const req = createJsonRequest("http://localhost:3000/api/engine/forecast", {
        method: "hour_of_week",
        horizonHours: 24,
        lookbackHours: 168,
      });

      const res = await forecastHandler(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.persisted).toBe(false);
      expect(json.audited).toBe(false);
      expect(json.warning).toBe("Result computed successfully but could not be persisted to the organisation store.");
      expect(json.predictions).toBeDefined();
      expect(auditSpy).not.toHaveBeenCalled();
    });

    it("surfaces audited: false when document write succeeds but audit write fails", async () => {
      const mockForecastDoc = {
        id: "fc_mock_456",
        orgId: "org_treasury",
        method: "hour_of_week",
        params: {},
        asOf: new Date("2026-03-01T00:00:00.000Z"),
        horizon: 24,
        points: [],
        residualQuantiles: {},
        backtest: { mase: 0.8, pinball: 0.05 },
        createdAt: new Date(),
        createdBy: "analyst-1",
      };

      vi.spyOn(forecastsRepo, "create").mockResolvedValue(mockForecastDoc);
      vi.spyOn(auditRepo, "append").mockRejectedValue(new Error("Audit append failed"));

      const req = createJsonRequest("http://localhost:3000/api/engine/forecast", {
        method: "hour_of_week",
        horizonHours: 24,
        lookbackHours: 168,
      });

      const res = await forecastHandler(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.id).toBe("fc_mock_456");
      expect(json.persisted).toBe(true);
      expect(json.audited).toBe(false);
    });
  });

  describe("Decision Route Persistence", () => {
    it("persists decision and writes audit entry with canonical SHA-256 hash", async () => {
      const mockDecisionDoc = {
        id: "dec_mock_789",
        orgId: "org_treasury",
        forecastId: "none",
        confidence: 0.99,
        reserve: Money.fromMinor(10_000_000_00n, "USD"),
        reserveMinor: "1000000000",
        surplus: Money.fromMinor(20_000_000_00n, "USD"),
        surplusMinor: "2000000000",
        allocations: [],
        status: "HEALTHY",
        expectedNetYield: Money.zero("USD"),
        expectedNetYieldMinor: "0",
        explanation: "Decision evaluated",
        createdAt: new Date(),
        createdBy: "analyst-1",
      };

      const createSpy = vi.spyOn(decisionsRepo, "create").mockResolvedValue(mockDecisionDoc);
      const auditSpy = vi.spyOn(auditRepo, "append").mockResolvedValue({
        id: "audit_dec_1",
        orgId: "org_treasury",
        actorUid: "analyst-1",
        action: "decision.create",
        refPath: "orgs/org_treasury/decisions/dec_mock_789",
        afterHash: "hash",
        ts: new Date(),
        createdAt: new Date(),
      });

      const req = createJsonRequest("http://localhost:3000/api/engine/decision", {
        availableCash: "30000000.00",
        operationalFloor: "5000000.00",
        expectedCumulativeFlow: "2000000.00",
        worstCaseResidualShortfall: "-4000000.00",
        sampleSize: 35,
        mase: 0.82,
      });

      const res = await decisionHandler(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.id).toBe("dec_mock_789");
      expect(json.persisted).toBe(true);
      expect(json.audited).toBe(true);

      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(createSpy).toHaveBeenCalledWith("org_treasury", expect.objectContaining({
        status: "HEALTHY",
        confidence: 0.99,
      }), "analyst-1");

      expect(auditSpy).toHaveBeenCalledTimes(1);
      const auditCall = auditSpy.mock.calls[0];
      expect(auditCall[0]).toBe("org_treasury");
      expect(auditCall[1].action).toBe("decision.create");
      expect(auditCall[1].actorUid).toBe("analyst-1");
      expect(auditCall[1].refPath).toBe("orgs/org_treasury/decisions/dec_mock_789");
      expect(auditCall[1].afterHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("surfaces persisted: false with a generic warning when decision repo fails", async () => {
      vi.spyOn(decisionsRepo, "create").mockRejectedValue(new Error("Firestore offline"));

      const req = createJsonRequest("http://localhost:3000/api/engine/decision", {
        availableCash: "30000000.00",
        operationalFloor: "5000000.00",
        expectedCumulativeFlow: "2000000.00",
        worstCaseResidualShortfall: "-4000000.00",
        sampleSize: 35,
        mase: 0.82,
      });

      const res = await decisionHandler(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.persisted).toBe(false);
      expect(json.audited).toBe(false);
      expect(json.warning).toBe("Decision evaluated successfully but could not be persisted to the organisation store.");
      expect(json.decision).toBeDefined();
    });
  });
});
