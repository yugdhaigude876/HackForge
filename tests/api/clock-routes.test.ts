import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";

const auditCalls: Array<Record<string, unknown>> = [];
vi.mock("@/server/repositories/audit", () => ({
  auditRepo: {
    append: vi.fn(async (_orgId: string, entry: Record<string, unknown>) => {
      auditCalls.push(entry);
      return { id: "audit-1", ...entry };
    }),
  },
}));
vi.mock("@/server/dataset", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/dataset")>();
  return { ...actual, getDatasetLength: () => 30 };
});

import { POST as advancePost } from "@/app/api/clock/advance/route";
import { POST as controlPost, GET as controlGet } from "@/app/api/clock/control/route";
import { GET as cronGet } from "@/app/api/cron/tick/route";
import {
  setTokenVerifier,
  setMembershipStore,
  resetAuthOverrides,
  type TokenVerifier,
  type MembershipStore,
  type AuthenticatedUser,
  type OrgRole,
} from "@/server/auth";
import { MemoryClockStore, setClockStore } from "@/server/clock-service";
import { MemoryRateLimiterStore, resetRateLimiterOverrides, setRateLimiterStore } from "@/server/rate-limiter";

class Verifier implements TokenVerifier {
  tokens: Record<string, AuthenticatedUser> = {
    analyst: { uid: "analyst-1", email: "a@bank.internal" },
    analyst2: { uid: "analyst-2", email: "a2@bank.internal" },
    admin: { uid: "admin-1", email: "ad@bank.internal" },
    viewer: { uid: "viewer-1", email: "v@bank.internal" },
    other: { uid: "other-1", email: "o@other.internal" },
  };
  async verifyIdToken(token: string) {
    const u = this.tokens[token];
    if (!u) throw new Error("bad token");
    return u;
  }
}

class Members implements MembershipStore {
  data: Record<string, Record<string, OrgRole>> = {
    org_a: { "analyst-1": "analyst", "analyst-2": "analyst", "admin-1": "admin", "viewer-1": "viewer" },
    org_b: { "other-1": "analyst" },
  };
  async getRole(orgId: string, uid: string) {
    return this.data[orgId]?.[uid] ?? null;
  }
}

function req(
  url: string,
  method: "GET" | "POST",
  opts: { token?: string | null; org?: string | null; body?: unknown; headers?: Record<string, string> } = {}
) {
  const headers = new Headers(opts.headers);
  if (opts.token !== null) headers.set("Authorization", `Bearer ${opts.token ?? "analyst"}`);
  if (opts.org !== null) headers.set("x-org-id", opts.org ?? "org_a");
  if (method === "POST") headers.set("Content-Type", "application/json");
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method,
    headers,
    ...(method === "POST" && opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
}

const control = (body: unknown, o: Parameters<typeof req>[2] = {}) =>
  controlPost(req("/api/clock/control", "POST", { ...o, body }));
const advance = (body: unknown, o: Parameters<typeof req>[2] = {}) =>
  advancePost(req("/api/clock/advance", "POST", { ...o, body }));

let store: MemoryClockStore;

beforeEach(() => {
  auditCalls.length = 0;
  resetAuthOverrides();
  setTokenVerifier(new Verifier());
  setMembershipStore(new Members());
  store = new MemoryClockStore();
  setClockStore(store);
  setRateLimiterStore(new MemoryRateLimiterStore());
});

afterEach(() => {
  resetRateLimiterOverrides();
  vi.unstubAllEnvs();
});

describe("POST /api/clock/control", () => {
  it("rejects unauthenticated and non-member callers", async () => {
    expect((await control({ action: "start" }, { token: null })).status).toBe(401);
    expect((await control({ action: "start" }, { token: "other" })).status).toBe(403);
    expect((await control({ action: "start" }, { org: null })).status).toBe(400);
  });

  it("forbids viewers", async () => {
    expect((await control({ action: "start" }, { token: "viewer" })).status).toBe(403);
  });

  it("starts the clock for an analyst and audits the action", async () => {
    const res = await control({ action: "start" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.clock.status).toBe("running");
    expect(json.data.clock.lease.ownerUid).toBe("analyst-1");
    expect(auditCalls.map((c) => c.action)).toContain("clock.start");
  });

  it("returns a typed 409 CONFLICT when another analyst holds the lease", async () => {
    await control({ action: "start" });
    const res = await control({ action: "start" }, { token: "analyst2" });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error.code).toBe("CONFLICT");
    expect(json.error.details.clockCode).toBe("LEASE_HELD");
  });

  it("validates the body strictly", async () => {
    expect((await control({ action: "explode" })).status).toBe(400);
    expect((await control({ action: "start", extra: 1 })).status).toBe(400);
    expect((await control({ action: "setSpeed", speedHoursPerMinute: 99999 })).status).toBe(400);
  });

  it("reset needs admin and confirm", async () => {
    expect((await control({ action: "reset", confirm: true }, { token: "analyst" })).status).toBe(403);
    expect((await control({ action: "reset" }, { token: "admin" })).status).toBe(400);
    const ok = await control({ action: "reset", confirm: true }, { token: "admin" });
    expect(ok.status).toBe(200);
    expect(auditCalls.map((c) => c.action)).toContain("clock.reset");
  });

  it("rejects non-JSON content types with 415", async () => {
    const r = new NextRequest("http://localhost:3000/api/clock/control", {
      method: "POST",
      headers: { Authorization: "Bearer analyst", "x-org-id": "org_a", "Content-Type": "text/plain" },
      body: "start",
    });
    expect((await controlPost(r)).status).toBe(415);
  });

  it("is rate limited per user", async () => {
    let limited = 0;
    for (let i = 0; i < 40; i++) {
      const res = await control({ action: "setSpeed", speedHoursPerMinute: 12 });
      if (res.status === 429) limited++;
    }
    expect(limited).toBeGreaterThan(0);
  });
});

describe("GET /api/clock/control", () => {
  it("lets viewers read the clock and isolates organisations", async () => {
    const ok = await controlGet(req("/api/clock/control", "GET", { token: "viewer" }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).data.clock.status).toBe("stopped");
    const denied = await controlGet(req("/api/clock/control", "GET", { token: "viewer", org: "org_b" }));
    expect(denied.status).toBe(403);
  });
});

describe("POST /api/clock/advance", () => {
  it("rejects unauthenticated, viewers and other-org users", async () => {
    expect((await advance({}, { token: null })).status).toBe(401);
    expect((await advance({}, { token: "viewer" })).status).toBe(403);
    expect((await advance({}, { token: "other" })).status).toBe(403);
  });

  it("returns 409 when the clock is not running", async () => {
    const res = await advance({ steps: 1 });
    expect(res.status).toBe(409);
    expect((await res.json()).error.details.clockCode).toBe("NOT_RUNNING");
  });

  it("advances the driver's clock and returns a slim payload without the full tick", async () => {
    await control({ action: "start" });
    const res = await advance({ steps: 3, expectedHourIndex: 0 });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.applied).toBe(3);
    expect(json.data.clock.appliedHours).toBe(3);
    expect(json.data.latest.hourIndex).toBe(2);
    expect(json.data.portfolio).toBeUndefined();
    expect(store.streams.get("org_a")?.size).toBe(3);
  });

  it("returns 409 for a stale expectedHourIndex and leaves state unchanged", async () => {
    await control({ action: "start" });
    await advance({ steps: 2, expectedHourIndex: 0 });
    const res = await advance({ steps: 2, expectedHourIndex: 0 });
    expect(res.status).toBe(409);
    expect((await res.json()).error.details.clockCode).toBe("STALE_INDEX");
    expect(store.clocks.get("org_a")?.appliedHours).toBe(2);
  });

  it("only the lease holder can advance", async () => {
    await control({ action: "start" });
    const res = await advance({ steps: 1 }, { token: "analyst2" });
    expect(res.status).toBe(409);
    expect((await res.json()).error.details.clockCode).toBe("LEASE_HELD");
  });

  it("validates steps and rejects unknown fields", async () => {
    await control({ action: "start" });
    expect((await advance({ steps: 0 })).status).toBe(400);
    expect((await advance({ steps: 25 })).status).toBe(400);
    expect((await advance({ steps: 1, hacker: true })).status).toBe(400);
  });

  it("keeps organisations isolated", async () => {
    await control({ action: "start" });
    await advance({ steps: 2 });
    expect(store.streams.get("org_b")).toBeUndefined();
  });

  it("never leaks stack traces for unexpected errors", async () => {
    await control({ action: "start" });
    vi.spyOn(store, "runTransaction").mockRejectedValueOnce(new Error("secret internal path /srv/app"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await advance({ steps: 1 });
    spy.mockRestore();
    expect(res.status).toBe(500);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain("secret internal path");
    expect(text).toContain("INTERNAL");
  });
});

describe("GET /api/cron/tick", () => {
  const cronReq = (auth?: string) =>
    new NextRequest("http://localhost:3000/api/cron/tick", {
      method: "GET",
      headers: auth ? { authorization: auth } : {},
    });

  it("is disabled (503) when CRON_SECRET is not set", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await cronGet(cronReq("Bearer x"))).status).toBe(503);
  });

  it("rejects a missing or wrong secret", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect((await cronGet(cronReq())).status).toBe(401);
    expect((await cronGet(cronReq("Bearer nope"))).status).toBe(401);
  });

  it("advances only running clocks that are due and skips clocks driven by a live client lease", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    // org_a: running with an active client lease -> skipped
    await control({ action: "start" });
    const res = await cronGet(cronReq("Bearer s3cret"));
    expect(res.status).toBe(200);
    const json = await res.json();
    const a = json.data.summary.find((s: { orgId: string }) => s.orgId === "org_a");
    expect(a.applied).toBe(0);
    expect(a.skipped).toMatch(/client session/);
    // a stopped org is not listed at all
    expect(json.data.summary.find((s: { orgId: string }) => s.orgId === "org_b")).toBeUndefined();
  });

  it("advances an unleased running clock by the hours due, capped at 24", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const now = Date.now();
    store.clocks.set("org_c", {
      appliedHours: 0,
      status: "running",
      speedHoursPerMinute: 1440,
      datasetHash: "x",
      datasetLength: 30,
      lease: null,
      startedAtMs: now - 120_000,
      lastTickAtMs: now - 120_000,
      version: 1,
      updatedAtMs: now,
    });
    const res = await cronGet(cronReq("Bearer s3cret"));
    const json = await res.json();
    const c = json.data.summary.find((s: { orgId: string }) => s.orgId === "org_c");
    expect(c.applied).toBe(24);
    expect(store.clocks.get("org_c")?.appliedHours).toBe(24);
  });
});
