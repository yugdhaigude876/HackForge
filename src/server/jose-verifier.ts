import "server-only";

import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { AuthenticatedUser, TokenVerifier } from "./auth";

/**
 * Firebase ID token verifier built on `jose` (standard JWT verification against Google's public
 * keys). It does not load `firebase-admin/auth`, which fails to load on some serverless Node
 * runtimes (ERR_REQUIRE_ESM from its ESM-only dependencies) and made every request unauthenticated.
 *
 * Checks, per https://firebase.google.com/docs/auth/admin/verify-id-tokens:
 *   - RS256 signature against the securetoken JWKS
 *   - iss == https://securetoken.google.com/<projectId>
 *   - aud == <projectId>
 *   - not expired, issued in the past
 *   - non-empty subject (the uid)
 *
 * Revocation is not checked (that needs the Auth Admin API). A revoked user's already-issued ID
 * token stays valid until it expires, at most one hour.
 */
export const FIREBASE_JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

let sharedJwks: JWTVerifyGetKey | null = null;

function defaultKeyResolver(): JWTVerifyGetKey {
  if (!sharedJwks) {
    sharedJwks = createRemoteJWKSet(new URL(FIREBASE_JWKS_URL), {
      cooldownDuration: 30_000,
      cacheMaxAge: 6 * 60 * 60 * 1000,
    });
  }
  return sharedJwks;
}

export interface JoseTokenVerifierOptions {
  /** Firebase project id. Defaults to the Admin app's project, then NEXT_PUBLIC_FIREBASE_PROJECT_ID. */
  projectId?: string;
  /** Injectable key resolver for tests. Defaults to Google's remote JWKS (cached). */
  getKey?: JWTVerifyGetKey;
}

export class JoseTokenVerifier implements TokenVerifier {
  constructor(private readonly options: JoseTokenVerifierOptions = {}) {}

  private async resolveProjectId(): Promise<string> {
    if (this.options.projectId) return this.options.projectId;
    try {
      const { getAdminApp } = await import("./firebase-admin");
      const id = getAdminApp().options.projectId;
      if (id) return id;
    } catch {
      // fall through to the public project id
    }
    const fallback = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    if (!fallback) {
      const err = new Error("Firebase project id is not configured for token verification.");
      err.name = "MissingFirebaseAdminConfigError";
      throw err;
    }
    return fallback;
  }

  async verifyIdToken(token: string): Promise<AuthenticatedUser> {
    const projectId = await this.resolveProjectId();
    const { payload } = await jwtVerify(token, this.options.getKey ?? defaultKeyResolver(), {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
      algorithms: ["RS256"],
      clockTolerance: 5,
    });
    if (typeof payload.sub !== "string" || payload.sub.length === 0 || payload.sub.length > 128) {
      throw new Error("Firebase ID token has no valid subject (uid).");
    }
    return {
      uid: payload.sub,
      email: typeof payload.email === "string" ? payload.email : null,
      emailVerified: payload.email_verified === true,
    };
  }
}
