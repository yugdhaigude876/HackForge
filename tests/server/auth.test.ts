import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  requireUser,
  requireOrgMember,
  setTokenVerifier,
  setMembershipStore,
  resetAuthOverrides,
  UnauthenticatedError,
  ForbiddenError,
  type TokenVerifier,
  type MembershipStore,
  type AuthenticatedUser,
  type OrgRole,
} from "@/server/auth";

class FakeTokenVerifier implements TokenVerifier {
  tokens: Record<string, AuthenticatedUser> = {
    "valid-token-1": { uid: "user-123", email: "user@example.com" },
    "valid-token-2": { uid: "user-456", email: "viewer@example.com" },
  };

  async verifyIdToken(token: string, checkRevoked = true): Promise<AuthenticatedUser> {
    if (token === "revoked-token" && checkRevoked) {
      throw new Error("Token has been revoked.");
    }
    if (token === "expired-token") {
      throw new Error("Token has expired.");
    }
    const found = this.tokens[token];
    if (!found) {
      throw new Error("Invalid token signature.");
    }
    return found;
  }
}

class FakeMembershipStore implements MembershipStore {
  memberships: Record<string, Record<string, OrgRole>> = {
    org_alpha: {
      "user-123": "admin",
      "user-456": "viewer",
    },
  };

  async getRole(orgId: string, uid: string): Promise<OrgRole | null> {
    return this.memberships[orgId]?.[uid] ?? null;
  }
}

describe("Server Auth: requireUser and requireOrgMember", () => {
  beforeEach(() => {
    resetAuthOverrides();
    setTokenVerifier(new FakeTokenVerifier());
    setMembershipStore(new FakeMembershipStore());
  });

  it("throws UnauthenticatedError when Authorization header is missing", async () => {
    const req = new NextRequest("http://localhost:3000/api/test");
    await expect(requireUser(req)).rejects.toThrow(UnauthenticatedError);
    await expect(requireUser(req)).rejects.toThrow("Missing Authorization header.");
  });

  it("throws UnauthenticatedError when Authorization header is not Bearer", async () => {
    const req = new NextRequest("http://localhost:3000/api/test", {
      headers: { Authorization: "Basic abcdef" },
    });
    await expect(requireUser(req)).rejects.toThrow(UnauthenticatedError);
    await expect(requireUser(req)).rejects.toThrow("Malformed Authorization header");
  });

  it("throws UnauthenticatedError when token is invalid, expired, or revoked", async () => {
    const invalidReq = new NextRequest("http://localhost:3000/api/test", {
      headers: { Authorization: "Bearer bogus-token" },
    });
    await expect(requireUser(invalidReq)).rejects.toThrow("Invalid, expired or revoked ID token");

    const expiredReq = new NextRequest("http://localhost:3000/api/test", {
      headers: { Authorization: "Bearer expired-token" },
    });
    await expect(requireUser(expiredReq)).rejects.toThrow("Invalid, expired or revoked ID token.");

    const revokedReq = new NextRequest("http://localhost:3000/api/test", {
      headers: { Authorization: "Bearer revoked-token" },
    });
    await expect(requireUser(revokedReq)).rejects.toThrow("Invalid, expired or revoked ID token.");
  });

  it("returns verified user when valid Bearer token is provided", async () => {
    const req = new NextRequest("http://localhost:3000/api/test", {
      headers: { Authorization: "Bearer valid-token-1" },
    });
    const user = await requireUser(req);
    expect(user.uid).toBe("user-123");
    expect(user.email).toBe("user@example.com");
  });

  it("throws ForbiddenError when user is not a member of the organisation", async () => {
    const req = new NextRequest("http://localhost:3000/api/test", {
      headers: { Authorization: "Bearer valid-token-1" },
    });
    await expect(requireOrgMember(req, "org_nonexistent", "viewer")).rejects.toThrow(ForbiddenError);
    await expect(requireOrgMember(req, "org_nonexistent", "viewer")).rejects.toThrow(
      "Not a member of this organisation."
    );
  });

  it("throws ForbiddenError when user role is below minRole", async () => {
    // user-456 is viewer in org_alpha, but route requires analyst
    const req = new NextRequest("http://localhost:3000/api/test", {
      headers: { Authorization: "Bearer valid-token-2" },
    });
    await expect(requireOrgMember(req, "org_alpha", "analyst")).rejects.toThrow(ForbiddenError);
    await expect(requireOrgMember(req, "org_alpha", "analyst")).rejects.toThrow(
      "Insufficient organisation permissions."
    );
  });

  it("authorizes when user role meets or exceeds minRole", async () => {
    // user-123 is admin in org_alpha, which exceeds analyst
    const req = new NextRequest("http://localhost:3000/api/test", {
      headers: { Authorization: "Bearer valid-token-1" },
    });
    const authContext = await requireOrgMember(req, "org_alpha", "analyst");
    expect(authContext.user.uid).toBe("user-123");
    expect(authContext.orgId).toBe("org_alpha");
    expect(authContext.role).toBe("admin");
  });
});
