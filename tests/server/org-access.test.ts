import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// In-memory stand-ins for the Firestore repositories
const members = new Map<string, string>(); // `${org}/${uid}` -> role
const invites = new Map<string, { email: string; role: string; claimedBy: string | null; createdAt: Date }>();
const audits: Array<Record<string, unknown>> = [];

vi.mock("@/server/repositories/members", () => ({
  membersRepo: {
    putRole: vi.fn(async (org: string, uid: string, role: string) => {
      members.set(`${org}/${uid}`, role);
      return { orgId: org, uid, role };
    }),
    list: vi.fn(async (org: string) => [...members.keys()].filter((k) => k.startsWith(`${org}/`)).map((k) => ({ uid: k.split("/")[1] }))),
    get: vi.fn(async () => null),
  },
}));
vi.mock("@/server/repositories/invites", async () => {
  const actual = await vi.importActual<typeof import("@/server/repositories/invites")>("@/server/repositories/invites");
  const key = (org: string, email: string) => `${org}/${actual.normalizeEmail(email)}`;
  return {
    ...actual,
    invitesRepo: {
      get: vi.fn(async (org: string, email: string) => {
        const i = invites.get(key(org, email));
        return i ? { ...i, createdBy: "admin", claimedAt: null } : null;
      }),
      put: vi.fn(async (org: string, input: { email: string; role: string; createdBy: string }) => {
        const email = actual.normalizeEmail(input.email);
        invites.set(key(org, email), { email, role: input.role, claimedBy: null, createdAt: new Date() });
        return { email, role: input.role, createdBy: input.createdBy, createdAt: new Date(), claimedBy: null, claimedAt: null };
      }),
      markClaimed: vi.fn(async (org: string, email: string, uid: string) => {
        const i = invites.get(key(org, email));
        if (i) i.claimedBy = uid;
      }),
      list: vi.fn(async (org: string) =>
        [...invites.entries()].filter(([k]) => k.startsWith(`${org}/`)).map(([, v]) => ({ ...v, createdBy: "admin", claimedAt: null }))
      ),
      remove: vi.fn(async (org: string, email: string) => void invites.delete(key(org, email))),
    },
  };
});
vi.mock("@/server/repositories/audit", () => ({
  auditRepo: { append: vi.fn(async (_o: string, e: Record<string, unknown>) => void audits.push(e)) },
}));

import { parseBootstrapEmails, resolveJoin } from "@/server/org-access";
import { inviteKey, invitesRepo, normalizeEmail } from "@/server/repositories/invites";
import { membersRepo } from "@/server/repositories/members";
import { POST as joinPost } from "@/app/api/org/join/route";
import { GET as invitesGet, POST as invitesPost, DELETE as invitesDelete } from "@/app/api/org/invites/route";
import {
  resetAuthOverrides,
  setMembershipStore,
  setTokenVerifier,
  type AuthenticatedUser,
  type MembershipStore,
  type OrgRole,
} from "@/server/auth";
import { MemoryRateLimiterStore, resetRateLimiterOverrides, setRateLimiterStore } from "@/server/rate-limiter";

const store: MembershipStore = { getRole: async (org, uid) => (members.get(`${org}/${uid}`) as OrgRole) ?? null };
const deps = (bootstrap?: string) => ({ membership: store, invites: invitesRepo, members: membersRepo, bootstrapAdminEmails: bootstrap });
const user = (over: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({ uid: "u1", email: "new.person@bank.com", emailVerified: true, ...over });

beforeEach(() => {
  members.clear();
  invites.clear();
  audits.length = 0;
});

describe("invite keys and emails", () => {
  it("normalises emails and derives a stable path-safe key", () => {
    expect(normalizeEmail("  Alex@Bank.COM ")).toBe("alex@bank.com");
    expect(inviteKey("Alex@Bank.com")).toBe(inviteKey(" alex@bank.com "));
    expect(inviteKey("a@b.com")).not.toBe(inviteKey("c@d.com"));
    expect(inviteKey("a@b.com")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(parseBootstrapEmails(" A@x.com, b@x.com ,,")).toEqual(new Set(["a@x.com", "b@x.com"]));
  });
});

describe("resolveJoin", () => {
  it("returns the existing role without changing anything", async () => {
    members.set("org_a/u1", "viewer");
    expect(await resolveJoin("org_a", user(), deps())).toEqual({ status: "member", role: "viewer" });
  });

  it("denies a verified user with no invitation (nobody gets in by default)", async () => {
    expect(await resolveJoin("org_a", user(), deps())).toEqual({ status: "denied", reason: "no-invitation" });
    expect(members.size).toBe(0);
  });

  it("denies unverified or missing email even when an invite exists", async () => {
    invites.set("org_a/new.person@bank.com", { email: "new.person@bank.com", role: "admin", claimedBy: null, createdAt: new Date() });
    expect(await resolveJoin("org_a", user({ emailVerified: false }), deps())).toEqual({ status: "denied", reason: "email-not-verified" });
    expect(await resolveJoin("org_a", user({ email: null }), deps())).toEqual({ status: "denied", reason: "no-email" });
    expect(members.size).toBe(0);
  });

  it("turns a matching invite into membership with the invited role and marks it claimed", async () => {
    invites.set("org_a/new.person@bank.com", { email: "new.person@bank.com", role: "analyst", claimedBy: null, createdAt: new Date() });
    const res = await resolveJoin("org_a", user({ email: "New.Person@Bank.com" }), deps());
    expect(res).toEqual({ status: "joined", role: "analyst", via: "invite" });
    expect(members.get("org_a/u1")).toBe("analyst");
    expect(invites.get("org_a/new.person@bank.com")?.claimedBy).toBe("u1");
  });

  it("an invite claimed by someone else cannot be reused by another account", async () => {
    invites.set("org_a/new.person@bank.com", { email: "new.person@bank.com", role: "admin", claimedBy: "other", createdAt: new Date() });
    expect(await resolveJoin("org_a", user(), deps())).toEqual({ status: "denied", reason: "no-invitation" });
    expect(members.has("org_a/u1")).toBe(false);
  });

  it("an invite is scoped to its organisation", async () => {
    invites.set("org_a/new.person@bank.com", { email: "new.person@bank.com", role: "admin", claimedBy: null, createdAt: new Date() });
    expect(await resolveJoin("org_b", user(), deps())).toEqual({ status: "denied", reason: "no-invitation" });
  });

  it("bootstraps the first admin from ORG_ADMIN_EMAILS, only for a verified email", async () => {
    expect(await resolveJoin("org_a", user(), deps("new.person@bank.com"))).toEqual({ status: "joined", role: "admin", via: "bootstrap" });
    members.clear();
    expect(await resolveJoin("org_a", user({ emailVerified: false }), deps("new.person@bank.com"))).toEqual({ status: "denied", reason: "email-not-verified" });
    expect(await resolveJoin("org_a", user({ email: "someone@else.com" }), deps("new.person@bank.com"))).toEqual({ status: "denied", reason: "no-invitation" });
  });
});

describe("routes", () => {
  const tokens: Record<string, AuthenticatedUser> = {
    admin: { uid: "admin-1", email: "admin@bank.com", emailVerified: true },
    newbie: { uid: "u1", email: "new.person@bank.com", emailVerified: true },
    stranger: { uid: "u9", email: "stranger@evil.com", emailVerified: true },
  };

  beforeEach(() => {
    resetAuthOverrides();
    setTokenVerifier({
      verifyIdToken: async (t: string) => {
        const u = tokens[t];
        if (!u) throw new Error("bad");
        return u;
      },
    });
    setMembershipStore(store);
    setRateLimiterStore(new MemoryRateLimiterStore());
    members.set("org_a/admin-1", "admin");
    return () => resetRateLimiterOverrides();
  });

  const req = (url: string, method: string, token: string | null, body?: unknown, org: string | null = "org_a") =>
    new NextRequest(new URL(url, "http://localhost:3000"), {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(org ? { "x-org-id": org } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  it("join: 400 without org, 401 without a valid token, 403 with no invitation", async () => {
    expect((await joinPost(req("/api/org/join", "POST", "newbie", undefined, null))).status).toBe(400);
    expect((await joinPost(req("/api/org/join", "POST", null))).status).toBe(401);
    expect((await joinPost(req("/api/org/join", "POST", "bad"))).status).toBe(401);
    const denied = await joinPost(req("/api/org/join", "POST", "stranger"));
    expect(denied.status).toBe(403);
    expect((await denied.json()).error.details.reason).toBe("no-invitation");
  });

  it("an admin invites an email, the person joins on first sign-in, and the join is audited", async () => {
    const invite = await invitesPost(req("/api/org/invites", "POST", "admin", { email: "New.Person@Bank.com", role: "analyst" }));
    expect(invite.status).toBe(200);
    const join = await joinPost(req("/api/org/join", "POST", "newbie"));
    expect(join.status).toBe(200);
    expect((await join.json()).data).toEqual({ status: "joined", role: "analyst" });
    expect(members.get("org_a/u1")).toBe("analyst");
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["invite.create", "member.join"]));
    // Joining again is a no-op that reports membership
    const again = await joinPost(req("/api/org/join", "POST", "newbie"));
    expect((await again.json()).data).toEqual({ status: "member", role: "analyst" });
  });

  it("only admins can list, create or remove invitations", async () => {
    members.set("org_a/u1", "analyst");
    expect((await invitesGet(req("/api/org/invites", "GET", "newbie"))).status).toBe(403);
    expect((await invitesPost(req("/api/org/invites", "POST", "newbie", { email: "x@y.com", role: "admin" }))).status).toBe(403);
    expect((await invitesDelete(req("/api/org/invites", "DELETE", "newbie", { email: "x@y.com" }))).status).toBe(403);
    expect((await invitesGet(req("/api/org/invites", "GET", "stranger"))).status).toBe(403);
  });

  it("validates invite bodies strictly", async () => {
    for (const bad of [{ email: "nope", role: "admin" }, { email: "a@b.com", role: "owner" }, { email: "a@b.com", role: "admin", extra: 1 }, {}]) {
      expect((await invitesPost(req("/api/org/invites", "POST", "admin", bad))).status).toBe(400);
    }
  });

  it("lists invitations with a claimed flag and never exposes other orgs", async () => {
    await invitesPost(req("/api/org/invites", "POST", "admin", { email: "a@b.com", role: "viewer" }));
    const list = await invitesGet(req("/api/org/invites", "GET", "admin"));
    const data = (await list.json()).data;
    expect(data.invites).toHaveLength(1);
    expect(data.invites[0]).toMatchObject({ email: "a@b.com", role: "viewer", claimed: false });
    expect(data.memberCount).toBe(1);
    invites.set("org_b/z@z.com", { email: "z@z.com", role: "admin", claimedBy: null, createdAt: new Date() });
    const again = await invitesGet(req("/api/org/invites", "GET", "admin"));
    expect((await again.json()).data.invites.map((i: { email: string }) => i.email)).not.toContain("z@z.com");
  });

  it("removing an invitation stops it from granting access", async () => {
    await invitesPost(req("/api/org/invites", "POST", "admin", { email: "new.person@bank.com", role: "admin" }));
    expect((await invitesDelete(req("/api/org/invites", "DELETE", "admin", { email: "new.person@bank.com" }))).status).toBe(200);
    expect((await joinPost(req("/api/org/join", "POST", "newbie"))).status).toBe(403);
  });
});
