import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/server/repositories/audit", () => ({ auditRepo: { append: vi.fn(async () => ({})) } }));

import { POST as replayPost } from "@/app/api/engine/replay/route";
import { GET as datasetGet } from "@/app/api/engine/dataset/route";
import { getAllDatasetRecords, getDatasetLength } from "@/server/dataset";
import {
  setTokenVerifier,
  setMembershipStore,
  resetAuthOverrides,
  type TokenVerifier,
  type MembershipStore,
} from "@/server/auth";
import { MemoryRateLimiterStore, resetRateLimiterOverrides, setRateLimiterStore } from "@/server/rate-limiter";

const verifier: TokenVerifier = {
  verifyIdToken: async () => ({ uid: "analyst-1", email: "a@bank.internal" }),
};
const members: MembershipStore = { getRole: async () => "analyst" };

const authed = (url: string, init: { method: "GET" | "POST"; body?: unknown }) =>
  new NextRequest(new URL(url, "http://localhost:3000"), {
    method: init.method,
    headers: {
      Authorization: "Bearer t",
      "x-org-id": "org_a",
      ...(init.method === "POST" ? { "Content-Type": "application/json" } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });

beforeEach(() => {
  resetAuthOverrides();
  setTokenVerifier(verifier);
  setMembershipStore(members);
  setRateLimiterStore(new MemoryRateLimiterStore());
  return () => resetRateLimiterOverrides();
});

describe("server dataset: full 8,760 hours from the bundled asset (not the 168 h sample fallback)", () => {
  it("getAllDatasetRecords returns every hour in order", () => {
    const rows = getAllDatasetRecords();
    expect(rows).toHaveLength(8760);
    expect(getDatasetLength()).toBe(8760);
    expect(rows[0].timestamp).toBe("2026-01-01T00:00:00Z");
    expect(rows[8759].timestamp).toBe("2026-12-31T23:00:00Z");
  });

  it("replay can run past 168 hours and from a later start hour", async () => {
    const res = await replayPost(authed("/api/engine/replay", { method: "POST", body: { startHour: 100, maxHours: 400, policy: "reserve-juggler" } }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.frames).toHaveLength(400);
    expect(json.data.frames[0].hourIndex).toBe(100);
    expect(json.data.frames[399].hourIndex).toBe(499);
  });

  it("dataset route reports all 8,760 hours in its summary", async () => {
    const res = await datasetGet(authed("/api/engine/dataset?summaryOnly=true", { method: "GET" }));
    expect(res.status).toBe(200);
    expect((await res.json()).data.summary.totalHours).toBe(8760);
  });
});
