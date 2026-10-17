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
}

export interface ApiSuccessResult<T> {
  ok: true;
  data: T;
  status: number;
}

export interface ApiErrorResult {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  status: number;
}

export type ApiResponse<T> = ApiSuccessResult<T> | ApiErrorResult;

/**
 * Client-side fetch helper for protected Reserve Juggler engine routes.
 */
export async function apiFetch<T = unknown>(
  path: string,
  init?: RequestInit,
  options?: ApiFetchOptions
): Promise<ApiResponse<T>> {
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

  // 4. Initial request
  let res = await fetch(path, {
    ...init,
    headers,
  });

  // 5. Retry once with a forced refreshed token on 401
  if (res.status === 401) {
    const freshToken = await tokenGetter(true);
    if (freshToken) {
      const retryHeaders = new Headers(headers);
      retryHeaders.set("Authorization", `Bearer ${freshToken}`);
      res = await fetch(path, {
        ...init,
        headers: retryHeaders,
      });
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

  if (res.ok) {
    return {
      ok: true,
      data: responseData as T,
      status: res.status,
    };
  }

  if (
    typeof responseData === "object" &&
    responseData !== null &&
    "error" in responseData
  ) {
    const err = (responseData as { error: { code?: string; message?: string; details?: unknown } }).error;
    return {
      ok: false,
      error: {
        code: err.code || (res.status === 401 ? "UNAUTHENTICATED" : res.status === 403 ? "FORBIDDEN" : "INTERNAL"),
        message: err.message || res.statusText || "Request failed",
        details: err.details,
      },
      status: res.status,
    };
  }

  return {
    ok: false,
    error: {
      code: res.status === 401 ? "UNAUTHENTICATED" : res.status === 403 ? "FORBIDDEN" : "INTERNAL",
      message: res.statusText || "Request failed",
    },
    status: res.status,
  };
}
