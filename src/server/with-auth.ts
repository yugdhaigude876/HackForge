import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireOrgMember,
  requireUser,
  type OrgRole,
  type OrgAuthContext,
  AuthError,
  UnauthenticatedError,
  ForbiddenError,
} from "./auth";
import { auditRepo } from "./repositories/audit";
import { canonicalJsonHash } from "./repositories/common";

export type ApiErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "INTERNAL"
  | "NOT_FOUND"
  | "RATE_LIMITED";

export interface ApiErrorPayload {
  ok: false;
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

/**
 * Redacts sensitive tokens, full email addresses, and raw user IDs from logs.
 */
export function redactMessage(message: string): string {
  if (typeof message !== "string") return String(message);
  return message
    // Redact Bearer tokens: Bearer <token>
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[REDACTED_TOKEN]")
    // Redact JWT strings: eyJ...
    .replace(/eyJ[A-Za-z0-9._-]{10,}/g, "[REDACTED_JWT]")
    // Redact email addresses: u***@domain.com
    .replace(/\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*(@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g, "$1***$2")
    // Truncate/redact UIDs: uid=xxx -> uid=xxx... (or hash)
    .replace(/\b(uid[:=]\s*["']?)([A-Za-z0-9_-]{8,})(["']?)/gi, (_m, p1, p2, p3) => `${p1}${p2.slice(0, 6)}...${p3}`);
}

export function createErrorResponse(
  status: number,
  code: ApiErrorCode,
  message: string,
  details?: unknown,
  requestId?: string
): NextResponse<ApiErrorPayload> {
  const response = NextResponse.json(
    {
      ok: false as const,
      error: {
        code,
        message,
        ...(details !== undefined ? { details } : {}),
        ...(requestId ? { requestId } : {}),
      },
    },
    { status }
  );

  if (requestId) {
    response.headers.set("x-request-id", requestId);
  }

  return response;
}

const OrgIdHeaderSchema = z
  .string()
  .trim()
  .min(1, "Header 'x-org-id' cannot be empty")
  .max(64, "Header 'x-org-id' must be at most 64 characters")
  .regex(/^[a-zA-Z0-9_-]+$/, "Header 'x-org-id' must contain only alphanumeric characters, underscores, or hyphens");

export interface WithAuthOptions {
  minRole?: OrgRole;
}

export type AuthenticatedHandler<T = unknown> = (
  request: NextRequest,
  context: OrgAuthContext,
  routeProps?: T
) => Promise<NextResponse> | NextResponse;

// Rate-bounded audit log deduplication map for auth denials (1 denial per uid per minute)
const lastDeniedAuditByUid = new Map<string, number>();

export function _resetDeniedAuditTracker(): void {
  lastDeniedAuditByUid.clear();
}

async function logAuthDeniedBounded(
  orgId: string,
  uid: string,
  reason: string,
  path: string
): Promise<void> {
  const now = Date.now();
  const lastTime = lastDeniedAuditByUid.get(uid) ?? 0;
  if (now - lastTime < 60_000) {
    return; // Rate-bounded: at most 1 audit write per uid per minute
  }
  lastDeniedAuditByUid.set(uid, now);

  try {
    const afterHash = canonicalJsonHash({
      event: "auth.denied",
      orgId,
      reason,
      path,
      timestamp: new Date(now).toISOString(),
    });

    await auditRepo.append(orgId, {
      actorUid: uid,
      action: "auth.denied",
      refPath: path,
      afterHash,
    });
  } catch (err) {
    console.warn(`[withAuth] Failed to write auth.denied audit entry: ${redactMessage(String(err))}`);
  }
}

/**
 * Route protection wrapper verifying:
 * 1. Bearer ID token presence & cryptographic validity via Firebase Admin SDK.
 * 2. Organisation membership & minimum role via x-org-id header (never trusted from request body).
 * 3. Ignored cookies for authentication (prevents CSRF vulnerabilities).
 * 4. Request ID tracking & correlation (x-request-id).
 * 5. Bounded audit logging of authorization denials.
 * 6. Consistent, typed error envelope on failures ({ ok: false, error: { code, message } }).
 */
export function withAuth<T = unknown>(
  handler: AuthenticatedHandler<T>,
  options: WithAuthOptions = {}
): (request: NextRequest, routeProps?: T) => Promise<NextResponse> {
  const minRole = options.minRole ?? "analyst";

  return async function authenticatedRoute(
    request: NextRequest,
    routeProps?: T
  ): Promise<NextResponse> {
    const requestId =
      request.headers.get("x-request-id") ||
      (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);

    let candidateUid: string | null = null;
    let candidateOrgId: string | null = null;

    try {
      // 1. Extract & validate organisation ID from headers
      const rawOrgId = request.headers.get("x-org-id");
      if (!rawOrgId) {
        return createErrorResponse(
          400,
          "VALIDATION_ERROR",
          "Missing required 'x-org-id' header.",
          undefined,
          requestId
        );
      }

      const orgIdResult = OrgIdHeaderSchema.safeParse(rawOrgId);
      if (!orgIdResult.success) {
        return createErrorResponse(
          400,
          "VALIDATION_ERROR",
          "Invalid 'x-org-id' header format.",
          orgIdResult.error.issues,
          requestId
        );
      }
      const orgId = orgIdResult.data;
      candidateOrgId = orgId;

      // 2. Authenticate user & verify organisation membership/role
      // Note: We authenticate the user first to extract uid for audit correlation
      const user = await requireUser(request);
      candidateUid = user.uid;

      const authContext = await requireOrgMember(request, orgId, minRole);

      // 3. Delegate to route handler
      const response = await handler(request, authContext, routeProps);
      if (!response.headers.has("x-request-id")) {
        response.headers.set("x-request-id", requestId);
      }
      return response;
    } catch (error) {
      if (error instanceof UnauthenticatedError) {
        return createErrorResponse(401, "UNAUTHENTICATED", error.message, undefined, requestId);
      }

      if (error instanceof ForbiddenError) {
        if (candidateOrgId && candidateUid) {
          // Fire bounded audit log asynchronously without blocking response
          logAuthDeniedBounded(candidateOrgId, candidateUid, error.message, request.nextUrl.pathname);
        }
        return createErrorResponse(403, "FORBIDDEN", error.message, undefined, requestId);
      }

      if (error instanceof AuthError) {
        return createErrorResponse(error.status, error.code, error.message, undefined, requestId);
      }

      // Log server-side only with redactor without leaking stack traces or credentials to clients
      console.error(
        `[withAuth unhandled error reqId=${requestId}]:`,
        redactMessage(error instanceof Error ? error.stack || error.message : String(error))
      );

      return createErrorResponse(
        500,
        "INTERNAL",
        "An internal server error occurred.",
        undefined,
        requestId
      );
    }
  };
}
