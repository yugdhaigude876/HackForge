import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { classifyAuthFailure, resetAuthOverrides, setTokenVerifier, setMembershipStore } from "@/server/auth";
import { GET as controlGet } from "@/app/api/clock/control/route";

describe("classifyAuthFailure", () => {
  it("separates expired, revoked, wrong-project, misconfigured and generic failures", () => {
    expect(classifyAuthFailure(Object.assign(new Error("x"), { code: "auth/id-token-expired" }))).toBe("token-expired");
    expect(classifyAuthFailure(Object.assign(new Error("x"), { code: "auth/id-token-revoked" }))).toBe("token-revoked");
    expect(classifyAuthFailure(new Error('Firebase ID token has incorrect "aud" (audience) claim.'))).toBe("wrong-project");
    expect(classifyAuthFailure(new Error('Firebase ID token has incorrect "iss" (issuer) claim.'))).toBe("wrong-project");
    const cfg = new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.");
    cfg.name = "MissingFirebaseAdminConfigError";
    expect(classifyAuthFailure(cfg)).toBe("server-misconfigured");
    expect(classifyAuthFailure(new Error("Decoding Firebase ID token failed."))).toBe("invalid-token");
    expect(classifyAuthFailure("weird")).toBe("invalid-token");
  });
});

describe("401 responses explain why, without leaking details", () => {
  beforeEach(() => {
    resetAuthOverrides();
    setMembershipStore({ getRole: async () => "analyst" });
  });

  it("returns details.reason for a rejected token and never echoes the raw error or token", async () => {
    setTokenVerifier({
      verifyIdToken: async () => {
        throw new Error('Firebase ID token has incorrect "aud" (audience) claim. SECRET-TOKEN-ABC');
      },
    });
    const res = await controlGet(
      new NextRequest("http://localhost:3000/api/clock/control", {
        headers: { Authorization: "Bearer SECRET-TOKEN-ABC", "x-org-id": "org_a" },
      })
    );
    expect(res.status).toBe(401);
    const text = JSON.stringify(await res.json());
    expect(text).toContain('"reason":"wrong-project"');
    expect(text).not.toContain("SECRET-TOKEN-ABC");
    expect(text).not.toContain("incorrect");
  });
});
