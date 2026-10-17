import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as listDecisionsHandler } from "@/app/api/decisions/route";
import { GET as getDecisionByIdHandler } from "@/app/api/decisions/[id]/route";
import { decisionsRepo, type DecisionRecord } from "@/server/repositories/decisions";
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

describe("Decisions Read Endpoints (GET /api/decisions and GET /api/decisions/[id])", () => {
  beforeEach(() => {
    setTokenVerifier(new TestTokenVerifier());
    setMembershipStore(new TestMembershipStore());
    vi.restoreAllMocks();
  });

  describe("GET /api/decisions (List)", () => {
    it("enforces role viewer: succeeds for viewer", async () => {
      const mockDecisions: DecisionRecord[] = [
        {
          id: "dec_2",
          orgId: "org_bank_a",
          forecastId: "fc_1",
          confidence: 0.99,
          reserve: Money.fromMinor(10_000_000n, "USD"),
          reserveMinor: "10000000",
          surplus: Money.fromMinor(20_000_000n, "USD"),
          surplusMinor: "20000000",
          allocations: [],
          status: "HEALTHY",
          expectedNetYield: Money.zero("USD"),
          expectedNetYieldMinor: "0",
          explanation: "Recent run",
          createdAt: new Date("2026-03-02T10:00:00Z"),
          createdBy: "analyst-1",
        },
        {
          id: "dec_1",
          orgId: "org_bank_a",
          forecastId: "none",
          confidence: 0.95,
          reserve: Money.fromMinor(15_000_000n, "USD"),
          reserveMinor: "15000000",
          surplus: Money.fromMinor(15_000_000n, "USD"),
          surplusMinor: "15000000",
          allocations: [],
          status: "HEALTHY",
          expectedNetYield: Money.zero("USD"),
          expectedNetYieldMinor: "0",
          explanation: "Older run",
          createdAt: new Date("2026-03-01T10:00:00Z"),
          createdBy: "analyst-1",
        },
      ];

      const listSpy = vi.spyOn(decisionsRepo, "list").mockResolvedValue(mockDecisions);

      const req = createGetRequest("http://localhost:3000/api/decisions?limit=20");
      const res = await listDecisionsHandler(req);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data).toHaveLength(2);
      expect(json.data[0].id).toBe("dec_2");

      expect(listSpy).toHaveBeenCalledTimes(1);
      expect(listSpy).toHaveBeenCalledWith("org_bank_a", { limit: 20 });
    });

    it("enforces role viewer: rejects outsider with 403 Forbidden", async () => {
      const req = createGetRequest(
        "http://localhost:3000/api/decisions",
        "outsider-token",
        "org_bank_a"
      );
      const res = await listDecisionsHandler(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("FORBIDDEN");
    });

    it("enforces org isolation: queries with authenticated orgId only", async () => {
      const listSpy = vi.spyOn(decisionsRepo, "list").mockResolvedValue([]);

      const req = createGetRequest(
        "http://localhost:3000/api/decisions",
        "valid-analyst-token",
        "org_bank_b"
      );
      const res = await listDecisionsHandler(req);
      expect(res.status).toBe(200);

      expect(listSpy).toHaveBeenCalledWith("org_bank_b", { limit: 20 });
    });

    it("clamps limit parameter to maximum of 100", async () => {
      const listSpy = vi.spyOn(decisionsRepo, "list").mockResolvedValue([]);

      const req = createGetRequest("http://localhost:3000/api/decisions?limit=500");
      const res = await listDecisionsHandler(req);
      expect(res.status).toBe(200);

      expect(listSpy).toHaveBeenCalledWith("org_bank_a", { limit: 100 });
    });

    it("rejects invalid limit query values with 400 VALIDATION_ERROR", async () => {
      const req = createGetRequest("http://localhost:3000/api/decisions?limit=-5");
      const res = await listDecisionsHandler(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("GET /api/decisions/[id] (Detail)", () => {
    it("returns decision when found in organisation", async () => {
      const mockDecision: DecisionRecord = {
        id: "dec_target_123",
        orgId: "org_bank_a",
        forecastId: "none",
        confidence: 0.99,
        reserve: Money.fromMinor(10_000_000n, "USD"),
        reserveMinor: "10000000",
        surplus: Money.fromMinor(20_000_000n, "USD"),
        surplusMinor: "20000000",
        allocations: [],
        status: "HEALTHY",
        expectedNetYield: Money.zero("USD"),
        expectedNetYieldMinor: "0",
        explanation: "Detail test",
        createdAt: new Date(),
        createdBy: "analyst-1",
      };

      const getSpy = vi.spyOn(decisionsRepo, "get").mockResolvedValue(mockDecision);

      const req = createGetRequest("http://localhost:3000/api/decisions/dec_target_123");
      const res = await getDecisionByIdHandler(req, {
        params: Promise.resolve({ id: "dec_target_123" }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.id).toBe("dec_target_123");
      expect(getSpy).toHaveBeenCalledWith("org_bank_a", "dec_target_123");
    });

    it("returns 404 NOT_FOUND when decision does not exist", async () => {
      vi.spyOn(decisionsRepo, "get").mockResolvedValue(null);

      const req = createGetRequest("http://localhost:3000/api/decisions/dec_non_existent");
      const res = await getDecisionByIdHandler(req, {
        params: Promise.resolve({ id: "dec_non_existent" }),
      });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("NOT_FOUND");
    });

    it("returns 400 VALIDATION_ERROR on malformed decision ID", async () => {
      const req = createGetRequest("http://localhost:3000/api/decisions/bad!id@#");
      const res = await getDecisionByIdHandler(req, {
        params: Promise.resolve({ id: "bad!id@#" }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });
  });
});
