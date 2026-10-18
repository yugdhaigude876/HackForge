import { describe, it, expect, vi } from "vitest";
import { GET as healthGet } from "@/app/api/health/route";
import { GET as readyGet } from "@/app/api/ready/route";
import * as adminModule from "@/server/firebase-admin";

describe("Health and Readiness Endpoints", () => {
  describe("GET /api/health", () => {
    it("returns ok: true, version, and time with zero secrets or dependency details", async () => {
      const res = await healthGet();
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toHaveProperty("ok", true);
      expect(data).toHaveProperty("version", "0.2.0");
      expect(data).toHaveProperty("time");
      expect(new Date(data.time).getTime()).not.toBeNaN();

      // Ensure no unexpected fields, database names, credentials or dependencies are leaked
      const keys = Object.keys(data);
      expect(keys.sort()).toEqual(["ok", "time", "version"]);
    });
  });

  describe("GET /api/ready", () => {
    it("returns HTTP 200 ready when Admin SDK reaches Firestore", async () => {
      // Mock Admin Firestore probe
      const mockCollection = {
        limit: () => ({
          get: vi.fn().mockResolvedValue({ empty: true }),
        }),
      };
      const mockFirestore = {
        collection: () => mockCollection,
      } as unknown as ReturnType<typeof adminModule.getAdminFirestore>;

      vi.spyOn(adminModule, "getAdminFirestore").mockReturnValue(mockFirestore);

      const res = await readyGet();
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toEqual({ ok: true, status: "ready" });
      expect(Object.keys(data).sort()).toEqual(["ok", "status"]);
    });

    it("returns HTTP 503 degraded without leaking error details when Admin SDK fails", async () => {
      const mockCollection = {
        limit: () => ({
          get: vi.fn().mockRejectedValue(new Error("Firebase private_key auth connection refused")),
        }),
      };
      const mockFirestore = {
        collection: () => mockCollection,
      } as unknown as ReturnType<typeof adminModule.getAdminFirestore>;

      vi.spyOn(adminModule, "getAdminFirestore").mockReturnValue(mockFirestore);

      const res = await readyGet();
      expect(res.status).toBe(503);

      const data = await res.json();
      expect(data).toEqual({ ok: false, status: "degraded" });
      // Crucial: no error text or private key stack trace leaked!
      expect(JSON.stringify(data)).not.toContain("private_key");
      expect(JSON.stringify(data)).not.toContain("connection refused");
    });
  });
});
