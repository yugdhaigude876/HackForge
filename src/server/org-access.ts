import "server-only";

import type { AuthenticatedUser, MembershipStore, OrgRole } from "./auth";
import { invitesRepo, normalizeEmail, type OrgInvite } from "./repositories/invites";
import { membersRepo } from "./repositories/members";

export type JoinResult =
  | { status: "member"; role: OrgRole }
  | { status: "joined"; role: OrgRole; via: "invite" | "bootstrap" }
  | { status: "denied"; reason: "email-not-verified" | "no-email" | "no-invitation" };

export interface OrgAccessDeps {
  membership: MembershipStore;
  invites: Pick<typeof invitesRepo, "get" | "markClaimed">;
  members: Pick<typeof membersRepo, "putRole">;
  /** Comma-separated emails that become admin on first sign-in (server env ORG_ADMIN_EMAILS). */
  bootstrapAdminEmails?: string;
}

/** Emails allowed to bootstrap as admin, lower-cased. */
export function parseBootstrapEmails(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((e) => normalizeEmail(e))
      .filter((e) => e.length > 0)
  );
}

/**
 * Decides whether a signed-in user may join an organisation, and creates their member document
 * when they may. Rules, in order:
 *   1. Already a member: nothing to do.
 *   2. The account needs a verified email address.
 *   3. An unclaimed (or same-user) invite for that email grants its role.
 *   4. The email is in ORG_ADMIN_EMAILS: admin (bootstrap for the first administrator).
 *   5. Otherwise denied. Nobody gets access without an explicit invitation.
 */
export async function resolveJoin(orgId: string, user: AuthenticatedUser, deps: OrgAccessDeps): Promise<JoinResult> {
  const existing = await deps.membership.getRole(orgId, user.uid);
  if (existing) return { status: "member", role: existing };

  if (!user.email) return { status: "denied", reason: "no-email" };
  if (user.emailVerified !== true) return { status: "denied", reason: "email-not-verified" };

  const email = normalizeEmail(user.email);

  const invite: OrgInvite | null = await deps.invites.get(orgId, email);
  if (invite && (invite.claimedBy === null || invite.claimedBy === user.uid)) {
    await deps.members.putRole(orgId, user.uid, invite.role, "invite");
    await deps.invites.markClaimed(orgId, email, user.uid);
    return { status: "joined", role: invite.role, via: "invite" };
  }

  if (parseBootstrapEmails(deps.bootstrapAdminEmails).has(email)) {
    await deps.members.putRole(orgId, user.uid, "admin", "bootstrap");
    return { status: "joined", role: "admin", via: "bootstrap" };
  }

  return { status: "denied", reason: "no-invitation" };
}
