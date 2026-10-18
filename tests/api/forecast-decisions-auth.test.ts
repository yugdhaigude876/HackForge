import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as getForecastHandler, POST as postForecastHandler } from "@/app/api/forecast/route";
import { POST as postDecisionHandler } from "@/app/api/decisions/route";
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
    "valid-viewer-token": { uid: "viewer-1", email: "viewer@bank.internal" },
    "outsider-token": { uid: "outsider-1", email: "outsider@evil.com" },
  };

  async verifyIdToken(token: string): Promise<AuthenticatedUser> {
    const user = this.tokens[token];
    if (!user) throw new Error("Invalid token signature.");
    return user;
  }
}

class TestMembershipStore implements MembershipStore {
  memberships: Record<string, Record<string, OrgRole>> = {
    org_treasury: {
      "analyst-1": "analyst",
      "viewer-1": "viewer",
    },
  };

  async getRole(orgId: string, uid: string): Promise<OrgRole | null> {
    return this.memberships[orgId]?.[uid] ?? null;
  }
}

function makeRequest(
  url: string,
  method: "GET" | "POST",
  options?: {
    token?: string | null;
    orgId?: string | null;
    body?: unknown;
  }
): NextRequest {
  const headers = new Headers();
  if (options?.token !== null) {
    headers.set("Authorization", `Bearer ${options?.token ?? "valid-analyst-token"}`);
  }
  if (options?.orgId !== null) {
    headers.set("x-org-id", options?.orgId ?? "org_treasury");
  }
  if (method === "POST") {
    headers.set("Content-Type", "application/json");
  }

  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method,
    headers,
    ...(method === "POST" && options?.body !== undefined
      ? { body: JSON.stringify(options.body) }
      : {}),
  });
}

describe("Auth and Rate Limiting on /api/forecast & /api/decisions", () => {
  beforeEach(() => {
    resetAuthOverrides();
    setTokenVerifier(new TestTokenVerifier());
    setMembershipStore(new TestMembershipStore());
  });

  describe("GET /api/forecast", () => {
    it("returns 400 when x-org-id is missing", async () => {
      const req = makeRequest("http://localhost:3000/api/forecast", "GET", { orgId: null });
      const res = await getForecastHandler(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(["BAD_REQUEST", "VALIDATION_ERROR"]).toContain(json.error.code);
    });

    it("returns 401 when Authorization is missing", async () => {
      const req = makeRequest("http://localhost:3000/api/forecast", "GET", { token: null });
      const res = await getForecastHandler(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("UNAUTHENTICATED");
    });

    it("returns 403 when user is not a member of the org", async () => {
      const req = makeRequest("http://localhost:3000/api/forecast", "GET", { token: "outsider-token" });
      const res = await getForecastHandler(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("FORBIDDEN");
    });

    it("allows viewer role to access GET /api/forecast", async () => {
      const req = makeRequest("http://localhost:3000/api/forecast", "GET", { token: "valid-viewer-token" });
      const res = await getForecastHandler(req);
      // May return 200 with forecast or empty
      expect([200, 404]).toContain(res.status);
    });
  });

  describe("POST /api/forecast", () => {
    it("returns 400 when x-org-id is missing", async () => {
      const req = makeRequest("http://localhost:3000/api/forecast", "POST", {
        orgId: null,
        body: { horizon: 24 },
      });
      const res = await postForecastHandler(req);
      expect(res.status).toBe(400);
    });

    it("returns 401 when unauthenticated", async () => {
      const req = makeRequest("http://localhost:3000/api/forecast", "POST", {
        token: null,
        body: { horizon: 24 },
      });
      const res = await postForecastHandler(req);
      expect(res.status).toBe(401);
    });

    it("returns 403 when user is only a viewer (requires analyst)", async () => {
      const req = makeRequest("http://localhost:3000/api/forecast", "POST", {
        token: "valid-viewer-token",
        body: { horizon: 24 },
      });
      const res = await postForecastHandler(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("FORBIDDEN");
    });
  });

  describe("POST /api/decisions (POST alias)", () => {
    it("returns 400 when x-org-id is missing", async () => {
      const req = makeRequest("http://localhost:3000/api/decisions", "POST", {
        orgId: null,
        body: { forecastId: "fc-1" },
      });
      const res = await postDecisionHandler(req);
      expect(res.status).toBe(400);
    });

    it("returns 401 when unauthenticated", async () => {
      const req = makeRequest("http://localhost:3000/api/decisions", "POST", {
        token: null,
        body: { forecastId: "fc-1" },
      });
      const res = await postDecisionHandler(req);
      expect(res.status).toBe(401);
    });

    it("returns 403 when user has insufficient role (viewer instead of analyst)", async () => {
      const req = makeRequest("http://localhost:3000/api/decisions", "POST", {
        token: "valid-viewer-token",
        body: { forecastId: "fc-1" },
      });
      const res = await postDecisionHandler(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("FORBIDDEN");
    });
  });
});
