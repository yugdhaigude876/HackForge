import { NextRequest, NextResponse } from "next/server";
import { createErrorResponse } from "@/server/with-auth";
import { AuthError, getActiveMembershipStore, requireUser } from "@/server/auth";
import { enforceRateLimit } from "@/server/rate-limiter";
import { ID_REGEX } from "@/server/request-guards";
import { resolveJoin } from "@/server/org-access";
import { invitesRepo } from "@/server/repositories/invites";
import { membersRepo } from "@/server/repositories/members";
import { auditRepo } from "@/server/repositories/audit";
import { canonicalJsonHash } from "@/server/repositories/common";

export const maxDuration = 15;

const DENIED_MESSAGES = {
  "no-email": "This account has no email address, so it cannot be matched to an invitation.",
  "email-not-verified": "Your email address is not verified. Sign in with a verified account.",
  "no-invitation": "No invitation was found for this account. Ask an organisation admin to invite your email address.",
} as const;

/**
 * POST /api/org/join
 * Called right after sign-in. If the caller is already a member, returns their role. Otherwise it
 * turns a matching invitation (or the ORG_ADMIN_EMAILS bootstrap) into a member document.
 * Does not require existing membership (that is the point), only a valid ID token.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const orgId = request.headers.get("x-org-id")?.trim() ?? "";
  if (!ID_REGEX.test(orgId)) {
    return createErrorResponse(400, "VALIDATION_ERROR", "Missing or invalid 'x-org-id' header.");
  }

  try {
    const user = await requireUser(request);

    const limited = await enforceRateLimit({ routeKey: "org.join", orgId, uid: user.uid });
    if (limited) return limited;

    const result = await resolveJoin(orgId, user, {
      membership: getActiveMembershipStore(),
      invites: invitesRepo,
      members: membersRepo,
      bootstrapAdminEmails: process.env.ORG_ADMIN_EMAILS,
    });

    if (result.status === "denied") {
      return createErrorResponse(403, "FORBIDDEN", DENIED_MESSAGES[result.reason], { reason: result.reason });
    }

    if (result.status === "joined") {
      try {
        await auditRepo.append(orgId, {
          actorUid: user.uid,
          action: "member.join",
          refPath: `orgs/${orgId}/members/${user.uid}`,
          afterHash: canonicalJsonHash({ orgId, uid: user.uid, role: result.role, via: result.via }),
        });
      } catch (err) {
        console.error("[api/org/join] audit append failed:", err);
      }
    }

    return NextResponse.json({ ok: true, data: { status: result.status, role: result.role } });
  } catch (err) {
    if (err instanceof AuthError) {
      return createErrorResponse(err.status, err.code, err.message);
    }
    console.error("[api/org/join] unexpected error:", err);
    return createErrorResponse(500, "INTERNAL", "An unexpected internal server error occurred.");
  }
}
