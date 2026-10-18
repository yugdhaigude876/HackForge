import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { z } from "zod";
import {
  parseJsonBody,
  validatePathId,
  validatePaginationLimit,
  IdValidationError,
  MAX_BODY_SIZE_BYTES,
} from "@/server/request-guards";

describe("Request Guards (src/server/request-guards.ts)", () => {
  describe("parseJsonBody", () => {
    const TestSchema = z.object({
      name: z.string(),
      count: z.number().int().positive(),
    }).strict();

    it("rejects non-application/json content type with 415", async () => {
      const req = new NextRequest("http://localhost/api/test", {
        method: "POST",
        headers: {
          "content-type": "text/plain",
        },
        body: JSON.stringify({ name: "Alice", count: 5 }),
      });

      const result = await parseJsonBody(req, TestSchema);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.response.status).toBe(415);
        const data = await result.response.json();
        expect(data.error.code).toBe("VALIDATION_ERROR");
        expect(data.error.message).toContain("Content-Type must be application/json");
      }
    });

    it("rejects request if content-length header exceeds 64 KB with 413", async () => {
      const req = new NextRequest("http://localhost/api/test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(MAX_BODY_SIZE_BYTES + 100),
        },
        body: JSON.stringify({ name: "Large", count: 1 }),
      });

      const result = await parseJsonBody(req, TestSchema);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.response.status).toBe(413);
        const data = await result.response.json();
        expect(data.error.code).toBe("VALIDATION_ERROR");
        expect(data.error.message).toContain("Payload Too Large");
      }
    });

    it("rejects request if actual body text exceeds 64 KB with 413", async () => {
      const hugeName = "A".repeat(MAX_BODY_SIZE_BYTES + 50);
      const req = new NextRequest("http://localhost/api/test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: hugeName, count: 1 }),
      });

      const result = await parseJsonBody(req, TestSchema);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.response.status).toBe(413);
      }
    });

    it("rejects malformed JSON body with 400", async () => {
      const req = new NextRequest("http://localhost/api/test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: "{ invalid json...",
      });

      const result = await parseJsonBody(req, TestSchema);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.response.status).toBe(400);
        const data = await result.response.json();
        expect(data.error.message).toContain("Invalid JSON in request body");
      }
    });

    it("rejects untrusted/unknown keys under strict schema with 400", async () => {
      const req = new NextRequest("http://localhost/api/test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "Bob", count: 10, maliciousExtraKey: "attack" }),
      });

      const result = await parseJsonBody(req, TestSchema);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.response.status).toBe(400);
        const data = await result.response.json();
        expect(data.error.code).toBe("VALIDATION_ERROR");
        expect(JSON.stringify(data.error.details)).toContain("unrecognized_keys");
      }
    });

    it("parses valid payload successfully", async () => {
      const req = new NextRequest("http://localhost/api/test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "ValidPayload", count: 42 }),
      });

      const result = await parseJsonBody(req, TestSchema);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ name: "ValidPayload", count: 42 });
      }
    });
  });

  describe("validatePathId", () => {
    it("accepts valid alphanumeric IDs, underscores, and hyphens", () => {
      expect(validatePathId("org_demo_123", "orgId")).toBe("org_demo_123");
      expect(validatePathId("cmp-abc-XYZ", "comparisonId")).toBe("cmp-abc-XYZ");
      expect(validatePathId("123456")).toBe("123456");
    });

    it("rejects path traversal attempts (../)", () => {
      expect(() => validatePathId("../etc/passwd")).toThrow(IdValidationError);
      expect(() => validatePathId("..")).toThrow(IdValidationError);
      expect(() => validatePathId("./foo")).toThrow(IdValidationError);
    });

    it("rejects empty IDs", () => {
      expect(() => validatePathId("")).toThrow(IdValidationError);
      expect(() => validatePathId(null)).toThrow(IdValidationError);
      expect(() => validatePathId(undefined)).toThrow(IdValidationError);
    });

    it("rejects over-long IDs exceeding 64 characters", () => {
      const overLong = "a".repeat(65);
      expect(() => validatePathId(overLong)).toThrow(IdValidationError);
    });

    it("rejects unicode or invalid punctuation", () => {
      expect(() => validatePathId("id_ümlaut")).toThrow(IdValidationError);
      expect(() => validatePathId("id$hack")).toThrow(IdValidationError);
      expect(() => validatePathId("id/subpath")).toThrow(IdValidationError);
      expect(() => validatePathId("id?param=1")).toThrow(IdValidationError);
    });
  });

  describe("validatePaginationLimit", () => {
    it("returns default limit when parameter is absent", () => {
      const sp = new URLSearchParams("");
      const result = validatePaginationLimit(sp, 20, 100);
      expect(result).toEqual({ limit: 20 });
    });

    it("clamps valid limits between default and max", () => {
      const sp1 = new URLSearchParams("limit=50");
      expect(validatePaginationLimit(sp1, 20, 100)).toEqual({ limit: 50 });

      const sp2 = new URLSearchParams("limit=1000");
      expect(validatePaginationLimit(sp2, 20, 100)).toEqual({ limit: 100 });
    });

    it("rejects non-numeric and non-integer limits with 400", async () => {
      const sp1 = new URLSearchParams("limit=abc");
      const res1 = validatePaginationLimit(sp1);
      expect("errorResponse" in res1).toBe(true);
      if ("errorResponse" in res1) {
        expect(res1.errorResponse.status).toBe(400);
      }

      const sp2 = new URLSearchParams("limit=-5");
      const res2 = validatePaginationLimit(sp2);
      expect("errorResponse" in res2).toBe(true);
      if ("errorResponse" in res2) {
        expect(res2.errorResponse.status).toBe(400);
      }
    });
  });
});
