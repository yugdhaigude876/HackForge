import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  enforceRateLimit,
  MemoryRateLimiterStore,
  setRateLimiterStore,
  setRateLimiterClock,
  resetRateLimiterOverrides,
  RateLimiterStore,
} from "@/server/rate-limiter";

describe("Durable Rate Limiter (src/server/rate-limiter.ts)", () => {
  let memStore: MemoryRateLimiterStore;
  let mockTime: number;

  beforeEach(() => {
    mockTime = 1_000_000;
    memStore = new MemoryRateLimiterStore();
    setRateLimiterStore(memStore);
    setRateLimiterClock(() => mockTime);
  });

  afterEach(() => {
    resetRateLimiterOverrides();
  });

  it("permits requests within limits and decrements remaining count", async () => {
    const orgId = "org_test";
    const uid = "user_1";

    const res1 = await enforceRateLimit({
      routeKey: "dashboard.run", // limits: user: 5, org: 10
      orgId,
      uid,
    });
    expect(res1).toBeNull(); // Allowed

    const res2 = await enforceRateLimit({
      routeKey: "dashboard.run",
      orgId,
      uid,
    });
    expect(res2).toBeNull(); // Allowed
  });

  it("enforces per-user limit and returns 429 with Retry-After header", async () => {
    const orgId = "org_test";
    const uid = "user_spammy";

    // dashboard.run user limit is 5 per minute
    for (let i = 0; i < 5; i++) {
      const res = await enforceRateLimit({
        routeKey: "dashboard.run",
        orgId,
        uid,
      });
      expect(res).toBeNull();
    }

    // 6th request from user_spammy should be rate-limited
    const rateLimitedRes = await enforceRateLimit({
      routeKey: "dashboard.run",
      orgId,
      uid,
    });

    expect(rateLimitedRes).not.toBeNull();
    expect(rateLimitedRes?.status).toBe(429);
    expect(rateLimitedRes?.headers.get("Retry-After")).toBeDefined();

    const data = await rateLimitedRes?.json();
    expect(data.error.code).toBe("RATE_LIMITED");
    expect(data.error.details.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("isolates users within the same organisation (per-user isolation)", async () => {
    const orgId = "org_shared";
    const userA = "user_a";
    const userB = "user_b";

    // User A exhausts user limit (5 requests)
    for (let i = 0; i < 5; i++) {
      await enforceRateLimit({
        routeKey: "dashboard.run",
        orgId,
        uid: userA,
      });
    }

    // User A is blocked
    const userABlocked = await enforceRateLimit({
      routeKey: "dashboard.run",
      orgId,
      uid: userA,
    });
    expect(userABlocked?.status).toBe(429);

    // User B in the same org is still permitted!
    const userBAllowed = await enforceRateLimit({
      routeKey: "dashboard.run",
      orgId,
      uid: userB,
    });
    expect(userBAllowed).toBeNull();
  });

  it("enforces per-organisation limit across multiple users", async () => {
    const orgId = "org_busy";

    // dashboard.run org limit is 10.
    // 2 users each make 5 requests = 10 total org requests.
    for (let i = 0; i < 5; i++) {
      await enforceRateLimit({ routeKey: "dashboard.run", orgId, uid: "user_1" });
      await enforceRateLimit({ routeKey: "dashboard.run", orgId, uid: "user_2" });
    }

    // A 3rd user in org_busy attempts a request -> blocked by org limit!
    const user3Res = await enforceRateLimit({
      routeKey: "dashboard.run",
      orgId,
      uid: "user_3",
    });
    expect(user3Res?.status).toBe(429);
  });

  it("resets limit window after duration elapses", async () => {
    const orgId = "org_reset";
    const uid = "user_reset";

    for (let i = 0; i < 5; i++) {
      await enforceRateLimit({ routeKey: "dashboard.run", orgId, uid });
    }

    // Blocked at t = 1,000,000
    const blocked = await enforceRateLimit({ routeKey: "dashboard.run", orgId, uid });
    expect(blocked?.status).toBe(429);

    // Advance clock past 60s window (60,001 ms)
    mockTime += 60_001;

    // Allowed again in new window
    const allowedAfterWindow = await enforceRateLimit({ routeKey: "dashboard.run", orgId, uid });
    expect(allowedAfterWindow).toBeNull();
  });

  it("fails closed with 503 when the rate limiter store is unavailable", async () => {
    const brokenStore: RateLimiterStore = {
      checkAndIncrement: async () => {
        throw new Error("Firestore connection timed out");
      },
    };
    setRateLimiterStore(brokenStore);

    const failClosedRes = await enforceRateLimit({
      routeKey: "dashboard.run",
      orgId: "org_fail",
      uid: "user_fail",
      failClosed: true,
    });

    expect(failClosedRes).not.toBeNull();
    expect(failClosedRes?.status).toBe(503);
    const data = await failClosedRes?.json();
    expect(data.error.code).toBe("INTERNAL");
    expect(data.error.message).toContain("Rate limiter service unavailable");
  });
});
