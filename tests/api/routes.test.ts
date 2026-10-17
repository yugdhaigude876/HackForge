/**
 * Reserve Juggler - API Route Handlers Integration Test Suite
 *
 * Verifies end-to-end request parsing, Zod validation, HTTP status codes (200, 400, 401, 403, 500),
 * Token verification, Organisation role authorization, Money serialization,
 * and core engine orchestration:
 * - POST /api/engine/generate
 * - POST /api/engine/forecast
 * - POST /api/engine/decision
 */

import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as generateHandler } from "@/app/api/engine/generate/route";
import { POST as forecastHandler } from "@/app/api/engine/forecast/route";
import { POST as decisionHandler } from "@/app/api/engine/decision/route";
import {
  setTokenVerifier,
  setMembershipStore,
  resetAuthOverrides,
  type TokenVerifier,
  type MembershipStore,
  type AuthenticatedUser,
  type OrgRole,
} from "@/server/auth";

class TestTokenVerifier implements TokenVerifier {
  tokens: Record<string, AuthenticatedUser> = {
    "valid-analyst-token": { uid: "analyst-1", email: "analyst@bank.internal" },
    "valid-admin-token": { uid: "admin-1", email: "admin@bank.internal" },
    "valid-viewer-token": { uid: "viewer-1", email: "viewer@bank.internal" },
    "outsider-token": { uid: "outsider-1", email: "outsider@evil.com" },
  };

  async verifyIdToken(token: string, checkRevoked = true): Promise<AuthenticatedUser> {
    if (token === "expired-token") throw new Error("Firebase ID token has expired.");
    if (token === "revoked-token" && checkRevoked) throw new Error("Firebase ID token has been revoked.");
    const user = this.tokens[token];
    if (!user) throw new Error("Invalid token signature.");
    return user;
  }
}

class TestMembershipStore implements MembershipStore {
  memberships: Record<string, Record<string, OrgRole>> = {
    org_treasury: {
      "analyst-1": "analyst",
      "admin-1": "admin",
      "viewer-1": "viewer",
    },
  };

  async getRole(orgId: string, uid: string): Promise<OrgRole | null> {
    return this.memberships[orgId]?.[uid] ?? null;
  }
}

function createJsonRequest(
  url: string,
  body: unknown,
  options?: { token?: string | null; orgId?: string | null }
): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = options?.token !== undefined ? options.token : "valid-analyst-token";
  const orgId = options?.orgId !== undefined ? options.orgId : "org_treasury";

  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (orgId) headers["x-org-id"] = orgId;

  return new NextRequest(url, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("API Security & Authorization: Token and Org Authorization", () => {
  const BASE_URL = "http://localhost:3000/api/engine/generate";
  const validPayload = {
    seed: "auth-security-test-seed",
    startDate: "2026-03-01T00:00:00Z",
    endDate: "2026-03-01T02:00:00Z",
  };

  beforeEach(() => {
    resetAuthOverrides();
    setTokenVerifier(new TestTokenVerifier());
    setMembershipStore(new TestMembershipStore());
  });

  it("returns 401 UNAUTHENTICATED when Authorization header is missing", async () => {
    const req = createJsonRequest(BASE_URL, validPayload, { token: null });
    const res = await generateHandler(req);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("UNAUTHENTICATED");
    expect(json.error.message).toContain("Missing Authorization header");
  });

  it("returns 401 UNAUTHENTICATED when Authorization header is malformed", async () => {
    const req = new NextRequest(BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "NotABearerToken",
        "x-org-id": "org_treasury",
      },
      body: JSON.stringify(validPayload),
    });
    const res = await generateHandler(req);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("UNAUTHENTICATED");
  });

  it("returns 401 UNAUTHENTICATED when token is invalid, expired, or revoked", async () => {
    const expiredReq = createJsonRequest(BASE_URL, validPayload, { token: "expired-token" });
    const expiredRes = await generateHandler(expiredReq);
    expect(expiredRes.status).toBe(401);
    const expiredJson = await expiredRes.json();
    expect(expiredJson.error.code).toBe("UNAUTHENTICATED");

    const revokedReq = createJsonRequest(BASE_URL, validPayload, { token: "revoked-token" });
    const revokedRes = await generateHandler(revokedReq);
    expect(revokedRes.status).toBe(401);
    const revokedJson = await revokedRes.json();
    expect(revokedJson.error.code).toBe("UNAUTHENTICATED");

    const invalidReq = createJsonRequest(BASE_URL, validPayload, { token: "bogus-signature" });
    const invalidRes = await generateHandler(invalidReq);
    expect(invalidRes.status).toBe(401);
  });

  it("returns 403 FORBIDDEN when user has valid token but is not a member of org", async () => {
    const req = createJsonRequest(BASE_URL, validPayload, { token: "outsider-token" });
    const res = await generateHandler(req);

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("FORBIDDEN");
    expect(json.error.message).toBe("Not a member of this organisation.");
  });

  it("returns 403 FORBIDDEN when user is viewer but route requires analyst", async () => {
    const req = createJsonRequest(BASE_URL, validPayload, { token: "valid-viewer-token" });
    const res = await generateHandler(req);

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("FORBIDDEN");
    expect(json.error.message).toBe("Insufficient organisation permissions.");
  });

  it("returns 200 when user role is analyst or admin", async () => {
    const analystReq = createJsonRequest(BASE_URL, validPayload, { token: "valid-analyst-token" });
    const analystRes = await generateHandler(analystReq);
    expect(analystRes.status).toBe(200);

    const adminReq = createJsonRequest(BASE_URL, validPayload, { token: "valid-admin-token" });
    const adminRes = await generateHandler(adminReq);
    expect(adminRes.status).toBe(200);
  });

  it("returns 400 VALIDATION_ERROR when x-org-id header is missing", async () => {
    const req = createJsonRequest(BASE_URL, validPayload, { orgId: null });
    const res = await generateHandler(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(json.error.message).toContain("Missing required 'x-org-id' header");
  });

  it("returns 400 VALIDATION_ERROR when x-org-id contains invalid characters", async () => {
    const req = createJsonRequest(BASE_URL, validPayload, { orgId: "org/invalid;drop table" });
    const res = await generateHandler(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("API Route: POST /api/engine/generate", () => {
  const BASE_URL = "http://localhost:3000/api/engine/generate";

  beforeEach(() => {
    resetAuthOverrides();
    setTokenVerifier(new TestTokenVerifier());
    setMembershipStore(new TestMembershipStore());
  });

  it("returns 200 and generates transactions with deterministic seed and date range", async () => {
    const req = createJsonRequest(BASE_URL, {
      seed: "hackathon-unit-test-1",
      startDate: "2026-03-01T00:00:00Z",
      endDate: "2026-03-01T03:00:00Z",
      transactionsPerHour: 10,
    });

    const res = await generateHandler(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.count).toBeGreaterThan(0);
    expect(json.transactions).toHaveLength(json.count);
    expect(json.timespan.startDate).toBe("2026-03-01T00:00:00.000Z");
    expect(json.timespan.endDate).toBe("2026-03-01T03:00:00.000Z");

    // Verify Money serialization conforms to DATA_MODEL.md
    const firstTx = json.transactions[0];
    expect(firstTx).toHaveProperty("id");
    expect(firstTx).toHaveProperty("type");
    expect(firstTx).toHaveProperty("amount");
    expect(typeof firstTx.amount.amountMinor).toMatch(/^(number|string)$/);
    expect(firstTx.amount.currency).toBe("USD");
  });

  it("guarantees 100% seeded reproducibility across consecutive calls", async () => {
    const payload = {
      seed: "deterministic-seed-xyz",
      startDate: "2026-03-01T00:00:00Z",
      endDate: "2026-03-01T02:00:00Z",
    };

    const res1 = await generateHandler(createJsonRequest(BASE_URL, payload));
    const json1 = await res1.json();

    const res2 = await generateHandler(createJsonRequest(BASE_URL, payload));
    const json2 = await res2.json();

    expect(json1.count).toBe(json2.count);
    expect(json1.transactions).toEqual(json2.transactions);
  });

  it("returns 400 with structured Zod errors when seed is missing", async () => {
    const req = createJsonRequest(BASE_URL, {
      startDate: "2026-03-01T00:00:00Z",
      endDate: "2026-03-01T02:00:00Z",
    });

    const res = await generateHandler(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(json.error.details).toBeInstanceOf(Array);
    expect(json.error.details.some((d: { path?: string[] }) => d.path?.includes("seed"))).toBe(true);
  });

  it("returns 400 when startDate is after endDate", async () => {
    const req = createJsonRequest(BASE_URL, {
      seed: "test-seed",
      startDate: "2026-03-02T00:00:00Z",
      endDate: "2026-03-01T00:00:00Z",
    });

    const res = await generateHandler(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(json.error.details[0].message).toContain("startDate must be before or equal to endDate");
  });

  it("returns 400 on invalid JSON syntax in request body", async () => {
    const req = new NextRequest(BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer valid-analyst-token",
        "x-org-id": "org_treasury",
      },
      body: "{ not-a-valid-json ",
    });

    const res = await generateHandler(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(json.error.message).toBe("Invalid JSON in request body");
  });
});

describe("API Route: POST /api/engine/forecast", () => {
  const BASE_URL = "http://localhost:3000/api/engine/forecast";

  beforeEach(() => {
    resetAuthOverrides();
    setTokenVerifier(new TestTokenVerifier());
    setMembershipStore(new TestMembershipStore());
  });

  it("returns 200 with Hour-of-Week EWMA smoothing forecast and rolling backtest", async () => {
    const req = createJsonRequest(BASE_URL, {
      method: "hour_of_week",
      horizonHours: 12,
      lookbackHours: 168,
      stepHours: 24,
      startDate: "2026-02-01T00:00:00Z",
      endDate: "2026-02-21T00:00:00Z",
      lambda: 0.3,
    });

    const res = await forecastHandler(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.method).toBe("hour_of_week");
    expect(json.horizonHours).toBe(12);
    expect(json.predictions).toHaveLength(12);

    // Verify Money serialization on predictions
    const firstPred = json.predictions[0];
    expect(typeof firstPred.amountMinor).toMatch(/^(number|string)$/);
    expect(firstPred.currency).toBe("USD");

    // Verify backtest metrics
    expect(json.backtest).toBeDefined();
    expect(json.backtest.windowCount).toBeGreaterThan(0);
    expect(typeof json.backtest.metrics.maeDollars).toBe("number");
    expect(typeof json.backtest.metrics.mase).toBe("number");
    expect(typeof json.backtest.metrics.pinballLoss95).toBe("number");
  });

  it("supports naive and seasonal_naive forecasters", async () => {
    const reqNaive = createJsonRequest(BASE_URL, {
      method: "naive",
      horizonHours: 6,
      startDate: "2026-02-01T00:00:00Z",
      endDate: "2026-02-15T00:00:00Z",
    });

    const resNaive = await forecastHandler(reqNaive);
    expect(resNaive.status).toBe(200);
    const jsonNaive = await resNaive.json();
    expect(jsonNaive.method).toBe("naive");
    expect(jsonNaive.predictions).toHaveLength(6);

    const reqSeasonal = createJsonRequest(BASE_URL, {
      method: "seasonal_naive",
      horizonHours: 6,
      seasonalLag: 168,
      startDate: "2026-02-01T00:00:00Z",
      endDate: "2026-02-21T00:00:00Z",
    });

    const resSeasonal = await forecastHandler(reqSeasonal);
    expect(resSeasonal.status).toBe(200);
    const jsonSeasonal = await resSeasonal.json();
    expect(jsonSeasonal.method).toBe("seasonal_naive");
    expect(jsonSeasonal.predictions).toHaveLength(6);
  });

  it("returns 400 for unknown forecasting method", async () => {
    const req = createJsonRequest(BASE_URL, {
      method: "deep_neural_transformer",
    });

    const res = await forecastHandler(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(json.error.details.some((d: { path?: string[] }) => d.path?.includes("method"))).toBe(true);
  });

  it("returns 400 for invalid horizon (e.g. horizon > 720)", async () => {
    const req = createJsonRequest(BASE_URL, {
      horizonHours: 1000,
    });

    const res = await forecastHandler(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(json.error.details.some((d: { path?: string[] }) => d.path?.includes("horizonHours"))).toBe(true);
  });

  it("returns 400 when start date is after end date", async () => {
    const req = createJsonRequest(BASE_URL, {
      startDate: "2026-03-10T00:00:00Z",
      endDate: "2026-03-01T00:00:00Z",
    });

    const res = await forecastHandler(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("API Route: POST /api/engine/decision", () => {
  const BASE_URL = "http://localhost:3000/api/engine/decision";

  beforeEach(() => {
    resetAuthOverrides();
    setTokenVerifier(new TestTokenVerifier());
    setMembershipStore(new TestMembershipStore());
  });

  const sampleInstruments = [
    {
      id: "treasury-repo",
      name: "Overnight Treasury Repo",
      apy: 0.052,
      capacity: 50_000_000,
      withdrawalPenalty: 0.0005,
      settlementLagHours: 0,
    },
    {
      id: "short-term-cd",
      name: "7-Day Commercial Paper",
      apy: 0.056,
      capacity: 30_000_000,
      withdrawalPenalty: 0.002,
      settlementLagHours: 4,
    },
  ];

  it("returns 200 with HEALTHY status and optimized allocations when C >= R", async () => {
    const req = createJsonRequest(BASE_URL, {
      availableCash: "150000000.00",
      operationalFloor: "20000000.00",
      expectedCumulativeFlow: "5000000.00",
      worstCaseResidualShortfall: "-10000000.00",
      sampleSize: 45,
      mase: 0.85,
      instruments: sampleInstruments,
    });

    const res = await decisionHandler(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.decision.status).toBe("HEALTHY");

    expect(json.decision.requiredReserve.amountMinor).toBe(25_000_000_00);
    expect(json.decision.deployableSurplus.amountMinor).toBe(125_000_000_00);
    expect(json.decision.allocations.length).toBeGreaterThan(0);
    expect(json.decision.liquidationPlan.orders).toHaveLength(0);
  });

  it("returns 200 with UNDER_RESERVED status and optimal liquidation plan when C < R", async () => {
    const activeHoldings = [
      {
        instrument: sampleInstruments[0],
        currentAmount: "30000000.00",
      },
      {
        instrument: sampleInstruments[1],
        currentAmount: "20000000.00",
      },
    ];

    const req = createJsonRequest(BASE_URL, {
      availableCash: "10000000.00",
      operationalFloor: "30000000.00",
      expectedCumulativeFlow: "-15000000.00",
      worstCaseResidualShortfall: "-10000000.00",
      sampleSize: 50,
      mase: 0.9,
      holdings: activeHoldings,
      instruments: sampleInstruments,
    });

    const res = await decisionHandler(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.decision.status).toBe("UNDER_RESERVED");

    expect(json.decision.reserveGap.amountMinor).toBe(45_000_000_00);
    expect(json.decision.deployableSurplus.amountMinor).toBe(0);
    expect(json.decision.allocations).toHaveLength(0);

    const plan = json.decision.liquidationPlan;
    expect(plan.orders.length).toBeGreaterThan(0);
    expect(plan.orders[0].instrumentId).toBe("treasury-repo");
    expect(plan.totalNetRecoveredCash.amountMinor).toBeGreaterThan(0);
  });

  it("returns 200 with LOW_CONFIDENCE status when sampleSize < 30 or MASE > 1.2", async () => {
    const req = createJsonRequest(BASE_URL, {
      availableCash: "100000000.00",
      operationalFloor: "20000000.00",
      expectedCumulativeFlow: "0.00",
      worstCaseResidualShortfall: "-5000000.00",
      sampleSize: 15,
      mase: 1.65,
      instruments: sampleInstruments,
    });

    const res = await decisionHandler(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.decision.status).toBe("LOW_CONFIDENCE");
    expect(json.decision.deployableSurplus.amountMinor).toBe(0);
    expect(json.decision.allocations).toHaveLength(0);
    expect(json.decision.warnings.length).toBeGreaterThan(0);
    expect(json.decision.warnings.some((w: string) => w.includes("sample size"))).toBe(true);
  });

  it("runs the full end-to-end pipeline automatically when parameters are omitted", async () => {
    const req = createJsonRequest(BASE_URL, {
      availableCash: "80000000.00",
      operationalFloor: "15000000.00",
      seed: "auto-pipeline-seed-456",
      instruments: sampleInstruments,
    });

    const res = await decisionHandler(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(["HEALTHY", "UNDER_RESERVED", "LOW_CONFIDENCE"]).toContain(
      json.decision.status
    );
    expect(json.decision.requiredReserve).toBeDefined();
    expect(json.decision.coverageRatio).toBeGreaterThan(0);
  });

  it("returns 400 when required fields like availableCash are missing", async () => {
    const req = createJsonRequest(BASE_URL, {
      operationalFloor: "10000000.00",
    });

    const res = await decisionHandler(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(json.error.details.some((d: { path?: string[] }) => d.path?.includes("availableCash"))).toBe(true);
  });

  it("returns 400 when negative cash is provided", async () => {
    const req = createJsonRequest(BASE_URL, {
      availableCash: "-500000.00",
      operationalFloor: "10000000.00",
    });

    const res = await decisionHandler(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(json.error.details[0].message).toContain("non-negative");
  });
});
