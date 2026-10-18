/**
 * Reserve Juggler - Authenticated API Client
 *
 * Attaches Firebase ID token (Authorization: Bearer) and x-org-id headers.
 * Retries once with a forced token refresh on 401.
 * In mock mode / no token: returns typed UNAUTHENTICATED without calling the protected endpoint.
 */

import { getFirebaseAuth } from "./firebase/client";

export const DEFAULT_ORG_ID = process.env.NEXT_PUBLIC_DEFAULT_ORG_ID || "org_demo";

export type TokenProvider = (forceRefresh?: boolean) => Promise<string | null>;

let registeredTokenProvider: TokenProvider | null = null;

/**
 * Registers a global token provider (e.g. from AuthContext) for client-side API requests.
 */
export function setGlobalTokenProvider(provider: TokenProvider | null): void {
  registeredTokenProvider = provider;
}

export function getGlobalTokenProvider(): TokenProvider | null {
  return registeredTokenProvider;
}

export interface ApiFetchOptions {
  orgId?: string;
  getToken?: TokenProvider;
  timeoutMs?: number;
}

export interface ApiSuccessResult<T> {
  ok: true;
  data: T;
  status: number;
  requestId?: string;
}

export interface ApiErrorResult {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
  status: number;
  requestId?: string;
}

export type ApiResponse<T> = ApiSuccessResult<T> | ApiErrorResult;

export const DEFAULT_API_TIMEOUT_MS = 30_000;

/**
 * Client-side fetch helper for protected Reserve Juggler engine routes.
 * Enforces a 30-second timeout via AbortController, returning a typed TIMEOUT result.
 * Only retries on 401 with forced token refresh (no retry for non-idempotent timeouts or 5xx).
 */
export async function apiFetch<T = unknown>(
  path: string,
  init?: RequestInit,
  options?: ApiFetchOptions
): Promise<ApiResponse<T>> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_API_TIMEOUT_MS;
  const tokenGetter: TokenProvider =
    options?.getToken ??
    registeredTokenProvider ??
    (async (forceRefresh = false) => {
      const auth = getFirebaseAuth();
      if (auth?.currentUser) {
        return await auth.currentUser.getIdToken(forceRefresh);
      }
      return null;
    });

  // 1. Acquire current token
  const token = await tokenGetter(false);

  // 2. Fail-fast if no token (mock mode or unauthenticated user): do not call protected endpoint
  if (!token) {
    return {
      ok: false,
      status: 401,
      error: {
        code: "UNAUTHENTICATED",
        message: "No authentication token available. Please sign in with a real account.",
      },
    };
  }

  const orgId = options?.orgId || DEFAULT_ORG_ID;

  // 3. Prepare headers
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("x-org-id", orgId);
  if (!headers.has("Content-Type") && init?.body && typeof init.body === "string") {
    headers.set("Content-Type", "application/json");
  }

  // 4. Initial request with timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers,
      signal: controller.signal,
    });
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if ((err as Error)?.name === "AbortError" || controller.signal.aborted) {
      return {
        ok: false,
        status: 408,
        error: {
          code: "TIMEOUT",
          message: `Request timed out after ${timeoutMs}ms`,
        },
      };
    }
    return {
      ok: false,
      status: 500,
      error: {
        code: "INTERNAL",
        message: err instanceof Error ? err.message : "Network error",
      },
    };
  } finally {
    clearTimeout(timeoutId);
  }

  // 5. Retry once with a forced refreshed token on 401
  if (res.status === 401) {
    const freshToken = await tokenGetter(true);
    if (freshToken) {
      const retryHeaders = new Headers(headers);
      retryHeaders.set("Authorization", `Bearer ${freshToken}`);

      const retryController = new AbortController();
      const retryTimeoutId = setTimeout(() => retryController.abort(), timeoutMs);

      try {
        res = await fetch(path, {
          ...init,
          headers: retryHeaders,
          signal: retryController.signal,
        });
      } catch (err: unknown) {
        clearTimeout(retryTimeoutId);
        if ((err as Error)?.name === "AbortError" || retryController.signal.aborted) {
          return {
            ok: false,
            status: 408,
            error: {
              code: "TIMEOUT",
              message: `Retry request timed out after ${timeoutMs}ms`,
            },
          };
        }
        return {
          ok: false,
          status: 500,
          error: {
            code: "INTERNAL",
            message: err instanceof Error ? err.message : "Network error on retry",
          },
        };
      } finally {
        clearTimeout(retryTimeoutId);
      }
    }
  }


  // 6. Parse response envelope
  let responseData: unknown = null;
  const contentType = res.headers.get("content-type");
  if (contentType && contentType.includes("application/json")) {
    try {
      responseData = await res.json();
    } catch {
      responseData = null;
    }
  }

  const headerRequestId = res.headers.get("x-request-id") || res.headers.get("x-vercel-id") || undefined;

  if (res.ok) {
    return {
      ok: true,
      data: responseData as T,
      status: res.status,
      requestId: headerRequestId,
    };
  }

  if (
    typeof responseData === "object" &&
    responseData !== null &&
    "error" in responseData
  ) {
    const err = (responseData as { error: { code?: string; message?: string; details?: unknown; requestId?: string } }).error;
    const reqId = err.requestId || headerRequestId;
    // Surface the server's coarse rejection reason (never a secret) so a failed sign-in is diagnosable on screen.
    const reason = (err.details as { reason?: unknown } | undefined)?.reason;
    const baseMessage = err.message || res.statusText || "Request failed";
    return {
      ok: false,
      error: {
        code: err.code || (res.status === 401 ? "UNAUTHENTICATED" : res.status === 403 ? "FORBIDDEN" : "INTERNAL"),
        message: typeof reason === "string" ? `${baseMessage} (reason: ${reason})` : baseMessage,
        details: err.details,
        requestId: reqId,
      },
      status: res.status,
      requestId: reqId,
    };
  }

  return {
    ok: false,
    error: {
      code: res.status === 401 ? "UNAUTHENTICATED" : res.status === 403 ? "FORBIDDEN" : "INTERNAL",
      message: res.statusText || "Request failed",
      requestId: headerRequestId,
    },
    status: res.status,
    requestId: headerRequestId,
  };
}
