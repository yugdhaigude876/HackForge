import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiFetch, setGlobalTokenProvider, type TokenProvider } from "@/lib/api-client";

describe("apiFetch client helper", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setGlobalTokenProvider(null);
  });

  it("returns UNAUTHENTICATED without calling fetch when no token is available (mock/signed-out)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await apiFetch("/api/engine/decision", {}, {
      getToken: async () => null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.error.code).toBe("UNAUTHENTICATED");
      expect(result.error.message).toContain("No authentication token available");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("attaches Authorization and x-org-id headers and returns successful response", async () => {
    const fakeResponseData = { success: true, count: 42 };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fakeResponseData), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await apiFetch("/api/engine/generate", {
      method: "POST",
      body: JSON.stringify({ seed: "test" }),
    }, {
      orgId: "org_hedge_fund",
      getToken: async () => "jwt-valid-token-123",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0];
    expect(calledUrl).toBe("/api/engine/generate");

    const headers = new Headers(calledInit?.headers);
    expect(headers.get("Authorization")).toBe("Bearer jwt-valid-token-123");
    expect(headers.get("x-org-id")).toBe("org_hedge_fund");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe(200);
      expect(result.data).toEqual(fakeResponseData);
    }
  });

  it("retries once with forced token refresh when receiving a 401 response", async () => {
    const tokenGetter = vi
      .fn<TokenProvider>()
      .mockResolvedValueOnce("expired-token")
      .mockResolvedValueOnce("fresh-token");

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: false,
            error: { code: "UNAUTHENTICATED", message: "Token expired." },
          }),
          { status: 401, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, recovered: true }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

    const result = await apiFetch("/api/engine/forecast", { method: "POST" }, {
      orgId: "org_test",
      getToken: tokenGetter,
    });

    // 1st token fetch with forceRefresh=false, 2nd with forceRefresh=true
    expect(tokenGetter).toHaveBeenCalledTimes(2);
    expect(tokenGetter).toHaveBeenNthCalledWith(1, false);
    expect(tokenGetter).toHaveBeenNthCalledWith(2, true);

    // Fetch was called twice
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [, firstInit] = fetchSpy.mock.calls[0];
    const [, secondInit] = fetchSpy.mock.calls[1];

    expect(new Headers(firstInit?.headers).get("Authorization")).toBe("Bearer expired-token");
    expect(new Headers(secondInit?.headers).get("Authorization")).toBe("Bearer fresh-token");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe(200);
      expect(result.data).toEqual({ success: true, recovered: true });
    }
  });
});
