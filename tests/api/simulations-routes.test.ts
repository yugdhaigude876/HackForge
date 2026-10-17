import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  POST as runSimulationHandler,
  GET as listSimulationsHandler,
  _resetSimulationRateLimiter,
} from "@/app/api/simulations/route";
import { GET as getSimulationByIdHandler } from "@/app/api/simulations/[id]/route";
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

describe("Stress Simulations API Routes (Phase 18)", () => {
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

  beforeEach(() => {
    setTokenVerifier(new TestTokenVerifier());
    setMembershipStore(new TestMembershipStore());
    _resetSimulationRateLimiter();
    vi.restoreAllMocks();
    vi.spyOn(decisionsRepo, "list").mockResolvedValue([mockDecision]);
  });

  const validScenario = {
    outflowShockPct: 20,
    settlementDelayHours: 12,
    confidence: 0.99,
  };

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

  // -------------------------------------------------------------------------
  // 1. POST /api/simulations: Role & Auth Enforcement
  // -------------------------------------------------------------------------

  describe("POST /api/simulations - Authorization & Role Checks", () => {
    it("returns 403 Forbidden for viewer role", async () => {
      const req = createRequest("http://localhost:3000/api/simulations", {
        method: "POST",
        token: "valid-viewer-token",
        orgId: "org_treasury",
        body: { scenario: validScenario, policy: "reserve-juggler" },
      });

      const res = await runSimulationHandler(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("FORBIDDEN");
    });

    it("returns 401 when token is missing", async () => {
      const req = createRequest("http://localhost:3000/api/simulations", {
        method: "POST",
        orgId: "org_treasury",
        body: { scenario: validScenario },
      });

      const res = await runSimulationHandler(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("UNAUTHENTICATED");
    });
  });

  // -------------------------------------------------------------------------
  // 2. POST /api/simulations: Input Validation & Bounds
  // -------------------------------------------------------------------------

  describe("POST /api/simulations - Parameter Validation", () => {
    it("rejects outflowShockPct > 50 with VALIDATION_ERROR", async () => {
      const req = createRequest("http://localhost:3000/api/simulations", {
        method: "POST",
        token: "valid-analyst-token",
        orgId: "org_treasury",
        body: {
          scenario: { ...validScenario, outflowShockPct: 75 }, // max 50
        },
      });

      const res = await runSimulationHandler(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects settlementDelayHours > 72 with VALIDATION_ERROR", async () => {
      const req = createRequest("http://localhost:3000/api/simulations", {
        method: "POST",
        token: "valid-analyst-token",
        orgId: "org_treasury",
        body: {
          scenario: { ...validScenario, settlementDelayHours: 96 }, // max 72
        },
      });

      const res = await runSimulationHandler(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects confidence < 0.50 with VALIDATION_ERROR", async () => {
      const req = createRequest("http://localhost:3000/api/simulations", {
        method: "POST",
        token: "valid-analyst-token",
        orgId: "org_treasury",
        body: {
          scenario: { ...validScenario, confidence: 0.25 }, // min 0.50
        },
      });

      const res = await runSimulationHandler(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects horizonHours > 168 with VALIDATION_ERROR", async () => {
      const req = createRequest("http://localhost:3000/api/simulations", {
        method: "POST",
        token: "valid-analyst-token",
        orgId: "org_treasury",
        body: {
          scenario: validScenario,
          horizonHours: 200, // max 168
        },
      });

      const res = await runSimulationHandler(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects trials > 2000 with VALIDATION_ERROR", async () => {
      const req = createRequest("http://localhost:3000/api/simulations", {
        method: "POST",
        token: "valid-analyst-token",
        orgId: "org_treasury",
        body: {
          scenario: validScenario,
          trials: 5000, // max 2000
        },
      });

      const res = await runSimulationHandler(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });
  });

  // -------------------------------------------------------------------------
  // 3. POST /api/simulations: Missing Prerequisites & Execution
  // -------------------------------------------------------------------------

  describe("POST /api/simulations - Prerequisites & Execution", () => {
    it("returns 400 VALIDATION_ERROR if org has no configured instruments", async () => {
      vi.spyOn(instrumentsRepo, "list").mockResolvedValue([]);

      const req = createRequest("http://localhost:3000/api/simulations", {
        method: "POST",
        token: "valid-analyst-token",
        orgId: "org_treasury",
        body: { scenario: validScenario },
      });

      const res = await runSimulationHandler(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.message).toContain("No configured instruments found");
    });

    it("returns 400 VALIDATION_ERROR if org has no baseline decision and no synthetic starting cash", async () => {
      vi.spyOn(instrumentsRepo, "list").mockResolvedValue([mockInstrument]);
      vi.spyOn(decisionsRepo, "list").mockResolvedValue([]);

      const req = createRequest("http://localhost:3000/api/simulations", {
        method: "POST",
        token: "valid-analyst-token",
        orgId: "org_treasury",
        body: { scenario: validScenario },
      });

      const res = await runSimulationHandler(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.message).toContain("Run the engine on the dashboard first so a cash baseline exists");
    });

    it("returns 400 VALIDATION_ERROR if source is synthetic but operationalFloor is missing when no stored decision exists", async () => {
      vi.spyOn(instrumentsRepo, "list").mockResolvedValue([mockInstrument]);
      vi.spyOn(decisionsRepo, "list").mockResolvedValue([]);

      const req = createRequest("http://localhost:3000/api/simulations", {
        method: "POST",
        token: "valid-analyst-token",
        orgId: "org_treasury",
        body: {
          scenario: validScenario,
          source: "synthetic",
          startingCash: "5000000000",
          // operationalFloor missing
        },
      });

      const res = await runSimulationHandler(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.message).toContain("Run the engine on the dashboard first");
    });

    it("succeeds without stored decision when source is synthetic and startingCash and operationalFloor are explicitly provided", async () => {
      vi.spyOn(instrumentsRepo, "list").mockResolvedValue([mockInstrument]);
      vi.spyOn(decisionsRepo, "list").mockResolvedValue([]);
      vi.spyOn(simulationsRepo, "create").mockResolvedValue({
        id: "sim_synth",
        orgId: "org_treasury",
        scenario: validScenario,
        seed: "synth-seed",
        policy: "reserve-juggler",
        metrics: {},
        source: "synthetic",
        createdAt: new Date(),
        createdBy: "analyst-1",
      });
      vi.spyOn(auditRepo, "append").mockResolvedValue({} as unknown as AuditRecord);

      const req = createRequest("http://localhost:3000/api/simulations", {
        method: "POST",
        token: "valid-analyst-token",
        orgId: "org_treasury",
        body: {
          scenario: validScenario,
          source: "synthetic",
          startingCash: "5000000000",
          operationalFloor: "200000000",
        },
      });

      const res = await runSimulationHandler(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.source).toBe("synthetic");
    });

    it("executes simulation, writes to simulationsRepo and auditRepo on success", async () => {
      vi.spyOn(instrumentsRepo, "list").mockResolvedValue([mockInstrument]);

      const createSimSpy = vi.spyOn(simulationsRepo, "create").mockResolvedValue({
        id: "sim_test_123",
        orgId: "org_treasury",
        scenario: validScenario,
        seed: "test-seed",
        policy: "reserve-juggler",
        metrics: {},
        source: "synthetic",
        createdAt: new Date(),
        createdBy: "analyst-1",
      });

      const appendAuditSpy = vi.spyOn(auditRepo, "append").mockResolvedValue({} as unknown as AuditRecord);

      const req = createRequest("http://localhost:3000/api/simulations", {
        method: "POST",
        token: "valid-analyst-token",
        orgId: "org_treasury",
        body: {
          scenario: validScenario,
          policy: "reserve-juggler",
          horizonHours: 24,
          trials: 50,
          seed: "unit-test-seed",
        },
      });

      const res = await runSimulationHandler(req);
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.ok).toBe(true);
      expect(json.data.id).toBe("sim_test_123");
      expect(json.data.trials).toBe(50);
      expect(json.data.horizonHours).toBe(24);
      expect(json.data.persisted).toBe(true);
      expect(json.data.audited).toBe(true);
      expect(typeof json.data.shortfallFrequency).toBe("number");
      expect(typeof json.data.expectedShortfallMinor).toBe("string");
      expect(Array.isArray(json.data.cashPath)).toBe(true);
      expect(json.data.cashPath.length).toBe(25);
      expect(json.data.disclaimer).toBeDefined();

      expect(createSimSpy).toHaveBeenCalledTimes(1);
      expect(appendAuditSpy).toHaveBeenCalledTimes(1);
      expect(appendAuditSpy).toHaveBeenCalledWith(
        "org_treasury",
        expect.objectContaining({
          action: "simulation.create",
          actorUid: "analyst-1",
          refPath: "orgs/org_treasury/simulations/sim_test_123",
        })
      );
    });

    it("rate limits rapid re-runs and returns 429 with Retry-After header", async () => {
      vi.spyOn(instrumentsRepo, "list").mockResolvedValue([mockInstrument]);
      vi.spyOn(simulationsRepo, "create").mockResolvedValue({ id: "sim_1" } as unknown as SimulationRecord);
      vi.spyOn(auditRepo, "append").mockResolvedValue({} as unknown as AuditRecord);

      const req1 = createRequest("http://localhost:3000/api/simulations", {
        method: "POST",
        token: "valid-analyst-token",
        orgId: "org_treasury",
        body: { scenario: validScenario, trials: 20 },
      });
      const res1 = await runSimulationHandler(req1);
      expect(res1.status).toBe(200);

      // Immediate second call should be rate limited
      const req2 = createRequest("http://localhost:3000/api/simulations", {
        method: "POST",
        token: "valid-analyst-token",
        orgId: "org_treasury",
        body: { scenario: validScenario, trials: 20 },
      });
      const res2 = await runSimulationHandler(req2);
      expect(res2.status).toBe(429);
      expect(res2.headers.get("Retry-After")).toBeDefined();
      const json2 = await res2.json();
      expect(json2.ok).toBe(false);
      expect(json2.error.code).toBe("RATE_LIMITED");
    });

    it("surfaces persisted: false with a generic warning when simulationsRepo fails", async () => {
      vi.spyOn(instrumentsRepo, "list").mockResolvedValue([mockInstrument]);
      vi.spyOn(simulationsRepo, "create").mockRejectedValue(new Error("Firestore write failed"));

      const req = createRequest("http://localhost:3000/api/simulations", {
        method: "POST",
        token: "valid-analyst-token",
        orgId: "org_treasury",
        body: { scenario: validScenario, trials: 20 },
      });

      const res = await runSimulationHandler(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.persisted).toBe(false);
      expect(json.data.warning).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // 4. GET /api/simulations & GET /api/simulations/[id]
  // -------------------------------------------------------------------------

  describe("GET /api/simulations - List & Retrieve", () => {
    it("viewer can list simulations with pagination limit", async () => {
      vi.spyOn(simulationsRepo, "list").mockResolvedValue([
        {
          id: "sim_rec_1",
          orgId: "org_treasury",
          scenario: validScenario,
          seed: "seed_1",
          policy: "reserve-juggler",
          metrics: { shortfallFrequency: 0 },
          source: "synthetic",
          createdAt: new Date(),
          createdBy: "analyst-1",
        },
      ]);

      const req = createRequest("http://localhost:3000/api/simulations?limit=10", {
        token: "valid-viewer-token",
        orgId: "org_treasury",
      });

      const res = await listSimulationsHandler(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
      expect(json.data[0].id).toBe("sim_rec_1");
    });

    it("viewer can get a simulation by ID", async () => {
      vi.spyOn(simulationsRepo, "get").mockResolvedValue({
        id: "sim_rec_1",
        orgId: "org_treasury",
        scenario: validScenario,
        seed: "seed_1",
        policy: "reserve-juggler",
        metrics: { shortfallFrequency: 0 },
        source: "synthetic",
        createdAt: new Date(),
        createdBy: "analyst-1",
      });

      const req = createRequest("http://localhost:3000/api/simulations/sim_rec_1", {
        token: "valid-viewer-token",
        orgId: "org_treasury",
      });

      const res = await getSimulationByIdHandler(req, {
        params: Promise.resolve({ id: "sim_rec_1" }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.id).toBe("sim_rec_1");
    });

    it("returns 404 for unknown simulation ID", async () => {
      vi.spyOn(simulationsRepo, "get").mockResolvedValue(null);

      const req = createRequest("http://localhost:3000/api/simulations/unknown_sim", {
        token: "valid-viewer-token",
        orgId: "org_treasury",
      });

      const res = await getSimulationByIdHandler(req, {
        params: Promise.resolve({ id: "unknown_sim" }),
      });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("NOT_FOUND");
    });
  });
});
