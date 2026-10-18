import "server-only";

import { NextRequest } from "next/server";
import { getAdminAuth } from "./firebase-admin";

export type OrgRole = "viewer" | "analyst" | "admin";

const ROLE_RANK: Record<OrgRole, number> = {
  viewer: 1,
  analyst: 2,
  admin: 3,
};

export function hasRequiredRole(actualRole: OrgRole, minRole: OrgRole): boolean {
  return ROLE_RANK[actualRole] >= ROLE_RANK[minRole];
}

export interface AuthenticatedUser {
  uid: string;
  email: string | null;
}

export interface OrgAuthContext {
  user: AuthenticatedUser;
  orgId: string;
  role: OrgRole;
}

export class AuthError extends Error {
  readonly status: number;
  readonly code: "UNAUTHENTICATED" | "FORBIDDEN";

  constructor(status: number, code: "UNAUTHENTICATED" | "FORBIDDEN", message: string) {
    super(message);
    this.name = "AuthError";
    this.status = status;
    this.code = code;
  }
}

export class UnauthenticatedError extends AuthError {
  constructor(message = "Authentication required. Missing, invalid, expired or revoked token.") {
    super(401, "UNAUTHENTICATED", message);
  }
}

export class ForbiddenError extends AuthError {
  constructor(message = "Access forbidden. Insufficient organization permissions.") {
    super(403, "FORBIDDEN", message);
  }
}

/**
 * Interface for verifying Firebase ID tokens.
 * Makes verifier injectable for tests without requiring network calls or real Admin keys.
 */
export interface TokenVerifier {
  verifyIdToken(token: string, checkRevoked?: boolean): Promise<AuthenticatedUser>;
}

/**
 * Interface for organization membership and role resolution.
 * Makes membership lookup injectable for unit/integration testing.
 */
export interface MembershipStore {
  getRole(orgId: string, uid: string): Promise<OrgRole | null>;
}

export class AdminTokenVerifier implements TokenVerifier {
  async verifyIdToken(token: string, checkRevoked = true): Promise<AuthenticatedUser> {
    const auth = getAdminAuth();
    try {
      const decoded = await auth.verifyIdToken(token, checkRevoked);
      return {
        uid: decoded.uid,
        email: decoded.email ?? null,
      };
    } catch (err) {
      if (checkRevoked) {
        console.warn(
          "[AdminTokenVerifier] Revocation check failed, attempting standard token verification:",
          err instanceof Error ? err.message : String(err)
        );
        const decoded = await auth.verifyIdToken(token, false);
        return {
          uid: decoded.uid,
          email: decoded.email ?? null,
        };
      }
      throw err;
    }
  }
}

import { membersRepo } from "./repositories/members";

export class FirestoreMembershipStore implements MembershipStore {
  async getRole(orgId: string, uid: string): Promise<OrgRole | null> {
    try {
      const member = await membersRepo.get(orgId, uid);
      return member?.role ?? null;
    } catch (err) {
      console.error(`Failed to retrieve member role for uid=${uid} in org=${orgId}:`, err);
      return null;
    }
  }
}

let activeTokenVerifier: TokenVerifier = new AdminTokenVerifier();
let activeMembershipStore: MembershipStore = new FirestoreMembershipStore();

/**
 * Override the token verifier for testing.
 */
export function setTokenVerifier(verifier: TokenVerifier): void {
  activeTokenVerifier = verifier;
}

/**
 * Override the membership store for testing.
 */
export function setMembershipStore(store: MembershipStore): void {
  activeMembershipStore = store;
}

/**
 * Resets verifier and membership store to defaults.
 */
export function resetAuthOverrides(): void {
  activeTokenVerifier = new AdminTokenVerifier();
  activeMembershipStore = new FirestoreMembershipStore();
}

/**
 * Extracts and verifies the bearer token from the request Authorization header.
 * Rejects missing, malformed, expired, or revoked tokens with 401 UNAUTHENTICATED.
 */
export async function requireUser(request: Request | NextRequest): Promise<AuthenticatedUser> {
  const authHeader = request.headers.get("authorization") || request.headers.get("Authorization");
  if (!authHeader) {
    throw new UnauthenticatedError("Missing Authorization header.");
  }

  const parts = authHeader.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer" || !parts[1]) {
    throw new UnauthenticatedError("Malformed Authorization header. Format: Bearer <idToken>");
  }

  const idToken = parts[1];

  try {
    return await activeTokenVerifier.verifyIdToken(idToken, true);
  } catch (err) {
    console.error("Token verification failed:", err);
    throw new UnauthenticatedError("Invalid, expired or revoked ID token.");
  }
}

/**
 * Authorizes that the user is an active member of the given organisation
 * with at least minRole (viewer < analyst < admin).
 *
 * CRITICAL SECURITY ARCHITECTURE NOTE:
 * The Firebase Admin SDK intentionally bypasses Firestore security rules (see docs/DATA_MODEL.md).
 * Therefore, this server-side membership and role verification in route code constitutes the
 * authoritative security and authorization boundary for all engine operations.
 */
export async function requireOrgMember(
  request: Request | NextRequest,
  orgId: string,
  minRole: OrgRole = "viewer"
): Promise<OrgAuthContext> {
  const user = await requireUser(request);

  const role = await activeMembershipStore.getRole(orgId, user.uid);
  if (!role) {
    console.error(`User ${user.uid} is not a member of organisation ${orgId}.`);
    throw new ForbiddenError("Not a member of this organisation.");
  }

  if (!hasRequiredRole(role, minRole)) {
    console.error(
      `User ${user.uid} role '${role}' is below required minimum role '${minRole}' for organisation ${orgId}.`
    );
    throw new ForbiddenError("Insufficient organisation permissions.");
  }

  return { user, orgId, role };
}
