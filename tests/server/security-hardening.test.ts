import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { withAuth, redactMessage, _resetDeniedAuditTracker } from "@/server/with-auth";
import {
  setTokenVerifier,
  setMembershipStore,
  resetAuthOverrides,
  TokenVerifier,
  MembershipStore,
} from "@/server/auth";
import { auditRepo, type AuditRecord } from "@/server/repositories/audit";

describe("Security Hardening (src/server/with-auth.ts)", () => {
  let mockTokenVerifier: TokenVerifier;
  let mockMembershipStore: MembershipStore;

  beforeEach(() => {
    _resetDeniedAuditTracker();
    mockTokenVerifier = {
      verifyIdToken: vi.fn().mockResolvedValue({
        uid: "user_valid_12345",
        email: "alice@reservejuggler.internal",
      }),
    };
    mockMembershipStore = {
      getRole: vi.fn().mockResolvedValue("analyst"),
    };
    setTokenVerifier(mockTokenVerifier);
    setMembershipStore(mockMembershipStore);
  });

  afterEach(() => {
    resetAuthOverrides();
    vi.restoreAllMocks();
  });

  describe("Cookie Authentication Ignored (CSRF Immunity)", () => {
    it("strictly ignores cookies and rejects requests without Authorization header (401)", async () => {
      const handler = withAuth(async () => NextResponse.json({ ok: true }));

      // Request includes cookies but no Authorization header
      const req = new NextRequest("http://localhost/api/engine/decision", {
        method: "POST",
        headers: {
          "x-org-id": "org_demo",
          Cookie: "session=attacker_session_cookie; auth_token=secret_val",
        },
      });

      const res = await handler(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error.code).toBe("UNAUTHENTICATED");
      expect(data.error.message).toContain("Missing Authorization header");
    });
  });

  describe("Request ID Correlation (x-request-id)", () => {
    it("propagates incoming x-request-id to response header and error payload", async () => {
      const incomingReqId = "custom-req-id-789";
      const handler = withAuth(async () => NextResponse.json({ ok: true }));

      // Bad x-org-id header to trigger validation error
      const req = new NextRequest("http://localhost/api/engine/decision", {
        headers: {
          "x-request-id": incomingReqId,
          "x-org-id": "invalid org with spaces!!",
        },
      });

      const res = await handler(req);
      expect(res.headers.get("x-request-id")).toBe(incomingReqId);

      const data = await res.json();
      expect(data.error.requestId).toBe(incomingReqId);
    });

    it("generates a UUID x-request-id if none was provided by client", async () => {
      const handler = withAuth(async () => NextResponse.json({ ok: true }));
      const req = new NextRequest("http://localhost/api/engine/decision", {
        headers: {
          "x-org-id": "invalid!!",
        },
      });

      const res = await handler(req);
      const generatedId = res.headers.get("x-request-id");
      expect(generatedId).toBeDefined();
      expect(typeof generatedId).toBe("string");
      expect(generatedId?.length).toBeGreaterThan(10);
    });
  });

  describe("Generic Error Handling (Zero Stack Leaks)", () => {
    it("routes unexpected internal exceptions through generic INTERNAL envelope without echoing error.message", async () => {
      const handler = withAuth(async () => {
        throw new Error("Sensitive database table user_credentials leaked!");
      });

      const req = new NextRequest("http://localhost/api/engine/decision", {
        headers: {
          Authorization: "Bearer valid_token",
          "x-org-id": "org_demo",
        },
      });

      const res = await handler(req);
      expect(res.status).toBe(500);

      const data = await res.json();
      expect(data.error.code).toBe("INTERNAL");
      expect(data.error.message).toBe("An internal server error occurred.");
      // Ensure the sensitive internal text was NOT leaked
      expect(JSON.stringify(data)).not.toContain("Sensitive database table");
    });
  });

  describe("Log Redaction Utility", () => {
    it("redacts bearer tokens, JWT strings, email addresses, and truncates uids", () => {
      const sensitiveLog =
        "User uid=user_admin_987654 with email analyst.jane@acme-bank.com sent Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.signature";

      const redacted = redactMessage(sensitiveLog);

      // Bearer token redacted
      expect(redacted).not.toContain("Bearer eyJ");
      expect(redacted).toContain("Bearer [REDACTED_TOKEN]");

      // Email address obfuscated
      expect(redacted).not.toContain("analyst.jane@acme-bank.com");
      expect(redacted).toContain("a***@acme-bank.com");

      // UID truncated
      expect(redacted).not.toContain("user_admin_987654");
      expect(redacted).toContain("user_a...");
    });
  });

  describe("Bounded Audit for Authorization Denials (auth.denied)", () => {
    it("records an audit entry for role denial and de-duplicates within 1 minute", async () => {
      const appendSpy = vi.spyOn(auditRepo, "append").mockResolvedValue({
        id: "aud_denied_1",
        createdAt: new Date(),
      } as unknown as AuditRecord);

      // User has viewer role, but handler requires analyst
      mockMembershipStore.getRole = vi.fn().mockResolvedValue("viewer");

      const handler = withAuth(
        async () => NextResponse.json({ ok: true }),
        { minRole: "analyst" }
      );

      const makeReq = () =>
        new NextRequest("http://localhost/api/engine/decision", {
          headers: {
            Authorization: "Bearer valid_token",
            "x-org-id": "org_demo",
          },
        });

      // 1. First forbidden request
      const res1 = await handler(makeReq());
      expect(res1.status).toBe(403);
      expect(appendSpy).toHaveBeenCalledTimes(1);
      expect(appendSpy).toHaveBeenCalledWith(
        "org_demo",
        expect.objectContaining({
          actorUid: "user_valid_12345",
          action: "auth.denied",
        })
      );

      // 2. Rapid second forbidden request from same user within 1 minute
      const res2 = await handler(makeReq());
      expect(res2.status).toBe(403);
      // Audit write should be bounded (de-duplicated), not flooded!
      expect(appendSpy).toHaveBeenCalledTimes(1);
    });
  });
});
