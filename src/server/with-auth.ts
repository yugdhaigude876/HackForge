import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireOrgMember,
  type OrgRole,
  type OrgAuthContext,
  AuthError,
  UnauthenticatedError,
  ForbiddenError,
} from "./auth";

export type ApiErrorCode = "UNAUTHENTICATED" | "FORBIDDEN" | "VALIDATION_ERROR" | "INTERNAL";

export interface ApiErrorPayload {
  ok: false;
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
}

export function createErrorResponse(
  status: number,
  code: ApiErrorCode,
  message: string,
  details?: unknown
): NextResponse<ApiErrorPayload> {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code,
        message,
        ...(details !== undefined ? { details } : {}),
      },
    },
    { status }
  );
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

export type AuthenticatedHandler = (
  request: NextRequest,
  context: OrgAuthContext
) => Promise<NextResponse> | NextResponse;

/**
 * Route protection wrapper verifying:
 * 1. Bearer ID token presence & cryptographic validity via Firebase Admin SDK.
 * 2. Organisation membership & minimum role via x-org-id header (never trusted from request body).
 * 3. Consistent, typed error envelope on failures ({ ok: false, error: { code, message } }).
 */
export function withAuth(
  handler: AuthenticatedHandler,
  options: WithAuthOptions = {}
): (request: NextRequest) => Promise<NextResponse> {
  const minRole = options.minRole ?? "analyst";

  return async function authenticatedRoute(request: NextRequest): Promise<NextResponse> {
    try {
      // 1. Extract & validate organisation ID from headers
      const rawOrgId = request.headers.get("x-org-id");
      if (!rawOrgId) {
        return createErrorResponse(
          400,
          "VALIDATION_ERROR",
          "Missing required 'x-org-id' header."
        );
      }

      const orgIdResult = OrgIdHeaderSchema.safeParse(rawOrgId);
      if (!orgIdResult.success) {
        return createErrorResponse(
          400,
          "VALIDATION_ERROR",
          "Invalid 'x-org-id' header format.",
          orgIdResult.error.issues
        );
      }
      const orgId = orgIdResult.data;

      // 2. Authenticate user & verify organisation membership/role
      const authContext = await requireOrgMember(request, orgId, minRole);

      // 3. Delegate to route handler
      return await handler(request, authContext);
    } catch (error) {
      if (error instanceof UnauthenticatedError) {
        return createErrorResponse(401, "UNAUTHENTICATED", error.message);
      }

      if (error instanceof ForbiddenError) {
        return createErrorResponse(403, "FORBIDDEN", error.message);
      }

      if (error instanceof AuthError) {
        return createErrorResponse(error.status, error.code, error.message);
      }

      // Log server-side only without leaking stack traces to clients
      console.error("[withAuth unhandled error]:", error);

      return createErrorResponse(
        500,
        "INTERNAL",
        "An internal server error occurred."
      );
    }
  };
}
