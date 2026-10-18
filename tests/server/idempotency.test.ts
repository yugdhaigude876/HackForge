import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import {
  checkIdempotency,
  recordIdempotency,
  MemoryIdempotencyStore,
  setIdempotencyStore,
  resetIdempotencyStore,
} from "@/server/idempotency";

describe("Idempotency Handling (src/server/idempotency.ts)", () => {
  let memStore: MemoryIdempotencyStore;

  beforeEach(() => {
    memStore = new MemoryIdempotencyStore();
    setIdempotencyStore(memStore);
  });

  afterEach(() => {
    resetIdempotencyStore();
  });

  it("returns null response when no Idempotency-Key header is provided", async () => {
    const req = new NextRequest("http://localhost/api/engine/decision", {
      method: "POST",
    });

    const result = await checkIdempotency(req, "org_demo");
    expect(result.key).toBeNull();
    expect(result.response).toBeNull();
  });

  it("rejects invalid characters or excessively long Idempotency-Key with 400", async () => {
    const req = new NextRequest("http://localhost/api/engine/decision", {
      method: "POST",
      headers: {
        "Idempotency-Key": "invalid key with spaces!!",
      },
    });

    const result = await checkIdempotency(req, "org_demo");
    expect(result.key).toBe("invalid key with spaces!!");
    expect(result.response).not.toBeNull();
    expect(result.response?.status).toBe(400);

    const data = await result.response?.json();
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toContain("Invalid 'Idempotency-Key'");
  });

  it("allows execution on first use of a key and caches response", async () => {
    const orgId = "org_demo";
    const idempotencyKey = "key_first_run_123";

    const req1 = new NextRequest("http://localhost/api/engine/decision", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
    });

    // 1. Initial check: cache miss
    const check1 = await checkIdempotency(req1, orgId);
    expect(check1.key).toBe(idempotencyKey);
    expect(check1.response).toBeNull();

    // 2. Record the successful execution response
    const mockPayload = { ok: true, data: { decisionId: "dec_101", reserve: "500000" } };
    await recordIdempotency(orgId, idempotencyKey, 200, mockPayload);

    // 3. Second request with the same key: replay from cache!
    const req2 = new NextRequest("http://localhost/api/engine/decision", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
    });

    const check2 = await checkIdempotency(req2, orgId);
    expect(check2.key).toBe(idempotencyKey);
    expect(check2.response).not.toBeNull();
    expect(check2.response?.status).toBe(200);
    expect(check2.response?.headers.get("Idempotency-Replayed")).toBe("true");

    const replayedData = await check2.response?.json();
    expect(replayedData).toEqual(mockPayload);
  });

  it("isolates idempotency keys across organisations", async () => {
    const key = "shared_key_name";
    await recordIdempotency("org_alpha", key, 200, { org: "alpha" });

    // Request from org_beta with the same key name should not hit org_alpha cache
    const reqBeta = new NextRequest("http://localhost/api/engine/decision", {
      headers: { "Idempotency-Key": key },
    });
    const checkBeta = await checkIdempotency(reqBeta, "org_beta");
    expect(checkBeta.response).toBeNull();
  });
});
