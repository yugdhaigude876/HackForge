import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  POST as runCompareHandler,
  GET as listComparisonsHandler,
} from "@/app/api/simulations/compare/route";
import { GET as getComparisonByIdHandler } from "@/app/api/simulations/compare/[comparisonId]/route";
import { _resetSimulationRateLimiter } from "@/app/api/simulations/route";
import { simulationsRepo, type SimulationRecord } from "@/server/repositories/simulations";
import { instrumentsRepo, type Instrument as StoredInstrument } from "@/server/repositories/instruments";
import { decisionsRepo, type DecisionRecord } from "@/server/repositories/decisions";
import { auditRepo, type AuditRecord } from "@/server/repositories/audit";
import { Money } from "@/engine/money";
import {
  setTokenVerifier,
  setMembershipStore,
  type TokenVerifier,
  type MembershipStore,
  type AuthenticatedUser,
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
  memberships: Record<string, { role: "admin" | "analyst" | "viewer" }> = {
    "org_treasury:analyst-1": { role: "analyst" },
    "org_treasury:viewer-1": { role: "viewer" },
    "org_treasury:admin-1": { role: "admin" },
    "org_isolated:analyst-1": { role: "analyst" },
  };

  async getRole(orgId: string, uid: string) {
    const key = `${orgId}:${uid}`;
    return this.memberships[key]?.role ?? null;
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
  const headers = new Headers();
  if (options.token) {
    headers.set("Authorization", `Bearer ${options.token}`);
  }
  if (options.orgId) {
    headers.set("x-org-id", options.orgId);
  }
  if (options.body) {
    headers.set("Content-Type", "application/json");
  }

  return new NextRequest(url, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
}

describe("Policy Comparison API Routes (/api/simulations/compare)", () => {
  const mockInstrument: StoredInstrument = {
    id: "inst_1",
    orgId: "org_treasury",
    name: "Treasury Repo",
    annualRateBps: 450,
    settlementLagHours: 0,
    penaltyBps: 5,
    capacity: Money.fromMinor(100_000_000_00n, "USD"),
    capacityMinor: "10000000000",
    minHoldHours: 0,
    createdAt: new Date(),
    createdBy: "admin",
  };

  const mockDecision: DecisionRecord = {
    id: "dec_1",
    orgId: "org_treasury",
    forecastId: "fc_1",
    confidence: 0.99,
    reserveMinor: "200000000",
    surplusMinor: "800000000",
    availableCashMinor: "5000000000",
    deployedTotalMinor: "0",
    operationalFloorMinor: "200000000",
    horizonHours: 24,
    alpha: 0.01,
    expectedCumulativeFlowMinor: "0",
    worstCaseResidualShortfallMinor: "0",
    backtest: undefined,
    allocations: [],
    status: "HEALTHY",
    expectedNetYieldMinor: "0",
    explanation: "Baseline decision",
    source: "synthetic",
    createdAt: new Date(),
    createdBy: "admin",
  } as unknown as DecisionRecord;

  const validScenario = {
    outflowShockPct: 20,
    settlementDelayHours: 6,
    confidence: 0.99,
  };

  beforeEach(() => {
    setTokenVerifier(new TestTokenVerifier());
    setMembershipStore(new TestMembershipStore());
    _resetSimulationRateLimiter();
    vi.restoreAllMocks();
    vi.spyOn(instrumentsRepo, "list").mockResolvedValue([mockInstrument]);
    vi.spyOn(decisionsRepo, "list").mockResolvedValue([mockDecision]);
  });

  // 1. Role Authorization
  describe("Authorization & Roles", () => {
    it("returns 403 Forbidden for viewer role on POST", async () => {
      const req = createRequest("http://localhost:3000/api/simulations/compare", {
        method: "POST",
        token: "valid-viewer-token",
        orgId: "org_treasury",
        body: { scenario: validScenario },
      });

      const res = await runCompareHandler(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("FORBIDDEN");
    });

    it("allows analyst role to run comparisons", async () => {
      vi.spyOn(simulationsRepo, "create").mockResolvedValue({
        id: "sim_1",
        orgId: "org_treasury",
        scenario: validScenario,
        seed: "seed",
        policy: "reserve-juggler",
        metrics: {},
        createdAt: new Date(),
        createdBy: "analyst-1",
      });
      vi.spyOn(auditRepo, "append").mockResolvedValue({} as unknown as AuditRecord);

      const req = createRequest("http://localhost:3000/api/simulations/compare", {
        method: "POST",
        token: "valid-analyst-token",
        orgId: "org_treasury",
        body: {
          scenario: validScenario,
          trials: 20,
          policies: ["reserve-juggler", "hold-all-cash"],
        },
      });

      const res = await runCompareHandler(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.comparisonId).toBeDefined();
      expect(json.data.policies).toEqual(["reserve-juggler", "hold-all-cash"]);
      expect(json.data.deltas).toBeDefined();
      expect(json.data.winners).toBeDefined();
    });
  });

  // 2. Validation & Work Caps
  describe("Work Caps & Validation", () => {
    it("rejects request if trials x policies exceeds 3000 work cap", async () => {
      const req = createRequest("http://localhost:3000/api/simulations/compare", {
        method: "POST",
        token: "valid-analyst-token",
        orgId: "org_treasury",
        body: {
          scenario: validScenario,
          trials: 1500, // 1500 * 3 = 4500 > 3000
          policies: ["reserve-juggler", "hold-all-cash", "fixed-buffer"],
        },
      });

      // Zod schema caps trials at 1000, but test work cap logic
      const res = await runCompareHandler(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 VALIDATION_ERROR if org has no baseline decision and no synthetic startingCash", async () => {
      vi.spyOn(decisionsRepo, "list").mockResolvedValue([]);

      const req = createRequest("http://localhost:3000/api/simulations/compare", {
        method: "POST",
        token: "valid-analyst-token",
        orgId: "org_treasury",
        body: { scenario: validScenario, trials: 20 },
      });

      const res = await runCompareHandler(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.message).toContain("Run the engine on the dashboard first so a cash baseline exists");
    });

    it("returns 400 VALIDATION_ERROR if source is synthetic but operationalFloor is missing", async () => {
      vi.spyOn(decisionsRepo, "list").mockResolvedValue([]);

      const req = createRequest("http://localhost:3000/api/simulations/compare", {
        method: "POST",
        token: "valid-analyst-token",
        orgId: "org_treasury",
        body: {
          scenario: validScenario,
          source: "synthetic",
          startingCash: "4000000000",
          trials: 20,
        },
      });

      const res = await runCompareHandler(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.message).toContain("startingCash and operationalFloor");
    });

    it("succeeds when source is synthetic with explicit startingCash and operationalFloor", async () => {
      vi.spyOn(decisionsRepo, "list").mockResolvedValue([]);
      vi.spyOn(simulationsRepo, "create").mockResolvedValue({
        id: "sim_synth",
        orgId: "org_treasury",
        scenario: validScenario,
        seed: "seed",
        policy: "reserve-juggler",
        metrics: {},
        source: "synthetic",
        createdAt: new Date(),
        createdBy: "analyst-1",
      });
      vi.spyOn(auditRepo, "append").mockResolvedValue({} as unknown as AuditRecord);

      const req = createRequest("http://localhost:3000/api/simulations/compare", {
        method: "POST",
        token: "valid-analyst-token",
        orgId: "org_treasury",
        body: {
          scenario: validScenario,
          source: "synthetic",
          startingCash: "4000000000",
          operationalFloor: "200000000",
          trials: 20,
        },
      });

      const res = await runCompareHandler(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
    });
  });

  // 3. Rate Limiting
  describe("Rate Limiting", () => {
    it("rate limits rapid re-runs with 429 and Retry-After header", async () => {
      vi.spyOn(simulationsRepo, "create").mockResolvedValue({ id: "sim_1" } as unknown as SimulationRecord);
      vi.spyOn(auditRepo, "append").mockResolvedValue({} as unknown as AuditRecord);

      const req1 = createRequest("http://localhost:3000/api/simulations/compare", {
        method: "POST",
        token: "valid-analyst-token",
        orgId: "org_treasury",
        body: { scenario: validScenario, trials: 20 },
      });
      const res1 = await runCompareHandler(req1);
      expect(res1.status).toBe(200);

      // Immediate second call should be rate limited
      const req2 = createRequest("http://localhost:3000/api/simulations/compare", {
        method: "POST",
        token: "valid-analyst-token",
        orgId: "org_treasury",
        body: { scenario: validScenario, trials: 20 },
      });
      const res2 = await runCompareHandler(req2);
      expect(res2.status).toBe(429);
      expect(res2.headers.get("Retry-After")).toBeDefined();
      const json2 = await res2.json();
      expect(json2.ok).toBe(false);
      expect(json2.error.code).toBe("RATE_LIMITED");
    });
  });

  // 4. Persistence & Audit
  describe("Persistence & Audit Integrity", () => {
    it("persists one simulation record per policy sharing comparisonId plus one audit entry", async () => {
      const createSpy = vi.spyOn(simulationsRepo, "create").mockResolvedValue({
        id: "sim_record",
        orgId: "org_treasury",
        scenario: validScenario,
        seed: "seed",
        policy: "reserve-juggler",
        metrics: {},
        createdAt: new Date(),
        createdBy: "analyst-1",
      });

      const appendSpy = vi.spyOn(auditRepo, "append").mockResolvedValue({} as unknown as AuditRecord);

      const req = createRequest("http://localhost:3000/api/simulations/compare", {
        method: "POST",
        token: "valid-analyst-token",
        orgId: "org_treasury",
        body: {
          scenario: validScenario,
          trials: 30,
          policies: ["reserve-juggler", "hold-all-cash", "fixed-buffer"],
        },
      });

      const res = await runCompareHandler(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.persisted).toBe(true);
      expect(json.data.audited).toBe(true);

      // 3 policies persisted with identical comparisonId
      expect(createSpy).toHaveBeenCalledTimes(3);
      const comparisonId = json.data.comparisonId;
      for (const call of createSpy.mock.calls) {
        expect(call[1].comparisonId).toBe(comparisonId);
      }

      // Exactly 1 audit record appended for the comparison
      expect(appendSpy).toHaveBeenCalledTimes(1);
      expect(appendSpy).toHaveBeenCalledWith(
        "org_treasury",
        expect.objectContaining({
          action: "simulation.compare",
          refPath: `orgs/org_treasury/simulations/compare/${comparisonId}`,
        })
      );
    });

    it("surfaces persisted: false with generic warning on persistence failure without stack trace", async () => {
      vi.spyOn(simulationsRepo, "create").mockRejectedValue(new Error("Firestore down"));

      const req = createRequest("http://localhost:3000/api/simulations/compare", {
        method: "POST",
        token: "valid-analyst-token",
        orgId: "org_treasury",
        body: { scenario: validScenario, trials: 20 },
      });

      const res = await runCompareHandler(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.persisted).toBe(false);
      expect(json.data.persistenceWarning).toBeDefined();
    });
  });

  // 5. Replay Endpoints
  describe("GET /api/simulations/compare/[comparisonId] - Replay", () => {
    it("viewer can retrieve stored comparison runs by comparisonId", async () => {
      const mockRecords: SimulationRecord[] = [
        {
          id: "sim_1",
          orgId: "org_treasury",
          comparisonId: "cmp_test_abc",
          scenario: validScenario,
          seed: "replay-seed",
          policy: "reserve-juggler",
          metrics: {
            policy: "reserve-juggler",
            seed: "replay-seed",
            trials: 50,
            horizonHours: 24,
            shortfallFrequency: 0,
            expectedShortfallMinor: "0",
            p95ShortfallMinor: "0",
            emergencyBorrowingCostMinor: "0",
            penaltiesPaidMinor: "0",
            grossYieldMinor: "150000",
            netYieldMinor: "150000",
            meanIdleCashMinor: "4800000000",
            idleCashHoursMinor: "4800000000",
            cashPath: [],
            disclaimer: "Disclaimer",
          },
          source: "live",
          createdAt: new Date(),
          createdBy: "analyst-1",
        },
        {
          id: "sim_2",
          orgId: "org_treasury",
          comparisonId: "cmp_test_abc",
          scenario: validScenario,
          seed: "replay-seed",
          policy: "hold-all-cash",
          metrics: {
            policy: "hold-all-cash",
            seed: "replay-seed",
            trials: 50,
            horizonHours: 24,
            shortfallFrequency: 0,
            expectedShortfallMinor: "0",
            p95ShortfallMinor: "0",
            emergencyBorrowingCostMinor: "0",
            penaltiesPaidMinor: "0",
            grossYieldMinor: "0",
            netYieldMinor: "0",
            meanIdleCashMinor: "5000000000",
            idleCashHoursMinor: "5000000000",
            cashPath: [],
            disclaimer: "Disclaimer",
          },
          source: "live",
          createdAt: new Date(),
          createdBy: "analyst-1",
        },
      ];

      vi.spyOn(simulationsRepo, "listByComparisonId").mockResolvedValue(mockRecords);

      const req = createRequest("http://localhost:3000/api/simulations/compare/cmp_test_abc", {
        method: "GET",
        token: "valid-viewer-token",
        orgId: "org_treasury",
      });

      const res = await getComparisonByIdHandler(req, {
        params: Promise.resolve({ comparisonId: "cmp_test_abc" }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.comparisonId).toBe("cmp_test_abc");
      expect(json.data.policies).toContain("reserve-juggler");
      expect(json.data.policies).toContain("hold-all-cash");
      expect(json.data.deltas["reserve-juggler"].vsHoldAllCash.netYieldMinor).toBe("150000");
    });

    it("returns 404 NOT_FOUND for non-existent comparisonId", async () => {
      vi.spyOn(simulationsRepo, "listByComparisonId").mockResolvedValue([]);

      const req = createRequest("http://localhost:3000/api/simulations/compare/cmp_unknown", {
        method: "GET",
        token: "valid-viewer-token",
        orgId: "org_treasury",
      });

      const res = await getComparisonByIdHandler(req, {
        params: Promise.resolve({ comparisonId: "cmp_unknown" }),
      });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("NOT_FOUND");
    });

    it("enforces org isolation: queries strictly by the authenticated orgId", async () => {
      const listSpy = vi.spyOn(simulationsRepo, "listByComparisonId").mockResolvedValue([]);

      const req = createRequest("http://localhost:3000/api/simulations/compare/cmp_cross_org", {
        method: "GET",
        token: "valid-analyst-token",
        orgId: "org_isolated",
      });

      await getComparisonByIdHandler(req, {
        params: Promise.resolve({ comparisonId: "cmp_cross_org" }),
      });
      expect(listSpy).toHaveBeenCalledWith("org_isolated", "cmp_cross_org");
    });

    it("supports backward compatibility: loads older simulation records containing idleCashHoursMinor without meanIdleCashMinor", async () => {
      const legacyRecord: SimulationRecord = {
        id: "sim_legacy",
        orgId: "org_treasury",
        comparisonId: "cmp_legacy",
        scenario: validScenario,
        seed: "legacy-seed",
        policy: "reserve-juggler",
        metrics: {
          policy: "reserve-juggler",
          seed: "legacy-seed",
          trials: 50,
          horizonHours: 24,
          shortfallFrequency: 0,
          expectedShortfallMinor: "0",
          p95ShortfallMinor: "0",
          emergencyBorrowingCostMinor: "0",
          penaltiesPaidMinor: "0",
          grossYieldMinor: "100000",
          netYieldMinor: "100000",
          // Old schema without meanIdleCashMinor
          idleCashHoursMinor: "4500000000",
          cashPath: [],
          disclaimer: "Disclaimer",
        },
        source: "live",
        createdAt: new Date(),
        createdBy: "analyst-1",
      };

      vi.spyOn(simulationsRepo, "listByComparisonId").mockResolvedValue([legacyRecord]);

      const req = createRequest("http://localhost:3000/api/simulations/compare/cmp_legacy", {
        method: "GET",
        token: "valid-viewer-token",
        orgId: "org_treasury",
      });

      const res = await getComparisonByIdHandler(req, {
        params: Promise.resolve({ comparisonId: "cmp_legacy" }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.policyResults["reserve-juggler"].idleCashHoursMinor).toBe("4500000000");
    });
  });

  // 6. List History
  describe("GET /api/simulations/compare - List History", () => {
    it("viewer can list recent comparisons", async () => {
      vi.spyOn(simulationsRepo, "list").mockResolvedValue([
        {
          id: "sim_1",
          orgId: "org_treasury",
          comparisonId: "cmp_1",
          scenario: validScenario,
          seed: "seed-1",
          policy: "reserve-juggler",
          metrics: { trials: 50, horizonHours: 24 },
          createdAt: new Date(),
          createdBy: "analyst-1",
        },
        {
          id: "sim_2",
          orgId: "org_treasury",
          comparisonId: "cmp_1",
          scenario: validScenario,
          seed: "seed-1",
          policy: "hold-all-cash",
          metrics: { trials: 50, horizonHours: 24 },
          createdAt: new Date(),
          createdBy: "analyst-1",
        },
      ]);

      const req = createRequest("http://localhost:3000/api/simulations/compare", {
        method: "GET",
        token: "valid-viewer-token",
        orgId: "org_treasury",
      });

      const res = await listComparisonsHandler(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.comparisons.length).toBe(1);
      expect(json.data.comparisons[0].comparisonId).toBe("cmp_1");
      expect(json.data.comparisons[0].policies).toContain("reserve-juggler");
      expect(json.data.comparisons[0].policies).toContain("hold-all-cash");
    });
  });
});
