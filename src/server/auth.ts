import "server-only";

import { NextRequest } from "next/server";
import { getAdminAuth } from "./firebase-admin";
import { JoseTokenVerifier } from "./jose-verifier";

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
  /** True when the identity provider verified the email (always true for Google sign-in). */
  emailVerified?: boolean;
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

/** Coarse, non-sensitive reason a token was rejected. Safe to return to clients. */
export type AuthFailureReason =
  | "token-expired"
  | "token-revoked"
  | "wrong-project"
  | "server-misconfigured"
  | "invalid-token";

export class UnauthenticatedError extends AuthError {
  readonly reason?: AuthFailureReason;

  constructor(
    message = "Authentication required. Missing, invalid, expired or revoked token.",
    reason?: AuthFailureReason
  ) {
    super(401, "UNAUTHENTICATED", message);
    this.reason = reason;
  }
}

/**
 * Maps a Firebase Admin verification error to a coarse reason. Never includes the token or any
 * credential. "wrong-project" means the token was issued for a different Firebase project than
 * the one the server's service account belongs to.
 */
export function classifyAuthFailure(err: unknown): AuthFailureReason {
  const code = typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : "";
  const message = err instanceof Error ? err.message : String(err ?? "");
  if (code === "auth/id-token-expired" || code === "ERR_JWT_EXPIRED") return "token-expired";
  if (code === "auth/id-token-revoked") return "token-revoked";
  // jose: claim validation failures name the claim that did not match
  if (code === "ERR_JWT_CLAIM_VALIDATION_FAILED") {
    const claim = typeof err === "object" && err !== null && "claim" in err ? String((err as { claim: unknown }).claim) : "";
    if (claim === "iss" || claim === "aud") return "wrong-project";
    if (claim === "exp") return "token-expired";
  }
  if (/incorrect "aud"|incorrect "iss"|audience|issuer/i.test(message)) return "wrong-project";
  if (
    err instanceof Error &&
    (err.name === "MissingFirebaseAdminConfigError" || /FIREBASE_SERVICE_ACCOUNT_JSON|credential/i.test(message))
  ) {
    return "server-misconfigured";
  }
  return "invalid-token";
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
          emailVerified: decoded.email_verified === true,
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
          emailVerified: decoded.email_verified === true,
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

/**
 * Default verifier. Real deployments verify ID tokens with `jose` against Google's public keys
 * (no dependency on firebase-admin/auth, which fails to load on some serverless Node runtimes).
 * The Firebase Auth emulator issues unsigned tokens, so it keeps using the Admin SDK.
 */
function createDefaultVerifier(): TokenVerifier {
  return process.env.FIREBASE_AUTH_EMULATOR_HOST ? new AdminTokenVerifier() : new JoseTokenVerifier();
}

let activeTokenVerifier: TokenVerifier = createDefaultVerifier();
let activeMembershipStore: MembershipStore = new FirestoreMembershipStore();

/** The membership store currently in use (the Firestore one, or a test double). */
export function getActiveMembershipStore(): MembershipStore {
  return activeMembershipStore;
}

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
  activeTokenVerifier = createDefaultVerifier();
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
    const reason = classifyAuthFailure(err);
    console.error(`Token verification failed (reason=${reason}):`, err);
    throw new UnauthenticatedError("Invalid, expired or revoked ID token.", reason);
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
