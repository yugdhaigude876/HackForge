import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as replayRouteHandler } from "@/app/api/engine/replay/route";
import {
  setTokenVerifier,
  setMembershipStore,
  type TokenVerifier,
  type MembershipStore,
  type AuthenticatedUser,
  type OrgRole,
} from "@/server/auth";
import {
  MemoryRateLimiterStore,
  setRateLimiterStore,
  setRateLimiterClock,
  resetRateLimiterOverrides,
} from "@/server/rate-limiter";

class TestTokenVerifier implements TokenVerifier {
  tokens: Record<string, AuthenticatedUser> = {
    "valid-viewer-token": { uid: "viewer-1", email: "viewer@bank.internal" },
    "valid-analyst-token": { uid: "analyst-1", email: "analyst@bank.internal" },
  };

  async verifyIdToken(token: string): Promise<AuthenticatedUser> {
    const user = this.tokens[token];
    if (!user) throw new Error("Invalid or expired token");
    return user;
  }
}

class TestMembershipStore implements MembershipStore {
  memberships: Record<string, Record<string, OrgRole>> = {
    org_treasury: {
      "viewer-1": "viewer",
      "analyst-1": "analyst",
    },
  };

  async getRole(orgId: string, uid: string): Promise<OrgRole | null> {
    return this.memberships[orgId]?.[uid] ?? null;
  }
}

function createReplayRequest(options: {
  token?: string;
  orgId?: string;
  body?: unknown;
}): NextRequest {
  const headers = new Headers();
  headers.set("content-type", "application/json");
  if (options.token) {
    headers.set("authorization", `Bearer ${options.token}`);
  }
  if (options.orgId) {
    headers.set("x-org-id", options.orgId);
  }

  const body = options.body !== undefined
    ? JSON.stringify(options.body)
    : JSON.stringify({
        maxHours: 24,
        policy: "reserve-juggler",
        initialCashUsd: 50_000_000,
        operationalFloorUsd: 5_000_000,
      });

  return new NextRequest("http://localhost:3000/api/engine/replay", {
    method: "POST",
    headers,
    body,
  });
}

describe("POST /api/engine/replay Security & Authentication", () => {
  let memStore: MemoryRateLimiterStore;
  let mockTime: number;

  beforeEach(() => {
    mockTime = 1_000_000;
    setTokenVerifier(new TestTokenVerifier());
    setMembershipStore(new TestMembershipStore());
    memStore = new MemoryRateLimiterStore();
    setRateLimiterStore(memStore);
    setRateLimiterClock(() => mockTime);
  });

  afterEach(() => {
    resetRateLimiterOverrides();
  });

  it("returns 401 UNAUTHENTICATED when called with orgId but missing token", async () => {
    const req = createReplayRequest({ orgId: "org_treasury" });
    const res = await replayRouteHandler(req);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("UNAUTHENTICATED");
  });

  it("returns 400 BAD_REQUEST when called without x-org-id header", async () => {
    const req = createReplayRequest({ token: "valid-viewer-token" });
    const res = await replayRouteHandler(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 401 UNAUTHENTICATED when called with invalid token", async () => {
    const req = createReplayRequest({
      token: "invalid-token",
      orgId: "org_treasury",
    });
    const res = await replayRouteHandler(req);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("UNAUTHENTICATED");
  });

  it("succeeds with 200 for authenticated user with minimum viewer role", async () => {
    const req = createReplayRequest({
      token: "valid-viewer-token",
      orgId: "org_treasury",
    });
    const res = await replayRouteHandler(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.summary).toBeDefined();
    expect(Array.isArray(json.data.frames)).toBe(true);
    expect(json.data.frames.length).toBeGreaterThan(0);
  });

  it("returns 429 when rate limit is exceeded for engine.replay", async () => {
    // Engine replay route has limits (e.g. 5 or 10 per minute)
    let lastRes: Response | null = null;
    for (let i = 0; i < 20; i++) {
      const req = createReplayRequest({
        token: "valid-viewer-token",
        orgId: "org_treasury",
      });
      lastRes = await replayRouteHandler(req);
      if (lastRes.status === 429) {
        break;
      }
    }

    expect(lastRes).not.toBeNull();
    if (!lastRes) throw new Error("Expected response from replay route");
    expect(lastRes.status).toBe(429);
    const json = await lastRes.json();
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("RATE_LIMITED");
  });
});
