import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, createErrorResponse } from "@/server/with-auth";
import { parseJsonBody } from "@/server/request-guards";
import { enforceRateLimit } from "@/server/rate-limiter";
import { invitesRepo, normalizeEmail } from "@/server/repositories/invites";
import { membersRepo } from "@/server/repositories/members";
import { auditRepo } from "@/server/repositories/audit";
import { canonicalJsonHash } from "@/server/repositories/common";
import type { OrgAuthContext } from "@/server/auth";

export const maxDuration = 15;

const InviteBodySchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    role: z.enum(["viewer", "analyst", "admin"]),
  })
  .strict();

const RemoveBodySchema = z.object({ email: z.string().trim().toLowerCase().email().max(254) }).strict();

async function audit(orgId: string, actorUid: string, action: string, detail: unknown) {
  try {
    await auditRepo.append(orgId, {
      actorUid,
      action,
      refPath: `orgs/${orgId}/invites`,
      afterHash: canonicalJsonHash(detail),
    });
  } catch (err) {
    console.error(`[api/org/invites] audit ${action} failed:`, err);
  }
}

/**
 * GET /api/org/invites (admin): pending and claimed invitations plus the member count.
 */
export const GET = withAuth(
  async function listInvites(_request: NextRequest, auth: OrgAuthContext): Promise<NextResponse> {
    try {
      const [invites, members] = await Promise.all([
        invitesRepo.list(auth.orgId),
        membersRepo.list(auth.orgId, { limit: 200 }),
      ]);
      return NextResponse.json({
        ok: true,
        data: {
          memberCount: members.length,
          invites: invites.map((i) => ({
            email: i.email,
            role: i.role,
            createdAt: i.createdAt.toISOString(),
            claimed: i.claimedBy !== null,
            claimedAt: i.claimedAt ? i.claimedAt.toISOString() : null,
          })),
        },
      });
    } catch (err) {
      console.error("[api/org/invites GET] failed:", err);
      return createErrorResponse(500, "INTERNAL", "An unexpected internal server error occurred.");
    }
  },
  { minRole: "admin" }
);

/**
 * POST /api/org/invites (admin): invite an email address with a role. The person gets access the
 * first time they sign in with that verified email.
 */
export const POST = withAuth(
  async function createInvite(request: NextRequest, auth: OrgAuthContext): Promise<NextResponse> {
    const limited = await enforceRateLimit({ routeKey: "org.invite", orgId: auth.orgId, uid: auth.user.uid });
    if (limited) return limited;

    const body = await parseJsonBody(request, InviteBodySchema);
    if (!body.success) return body.response;

    try {
      const invite = await invitesRepo.put(auth.orgId, {
        email: body.data.email,
        role: body.data.role,
        createdBy: auth.user.uid,
      });
      await audit(auth.orgId, auth.user.uid, "invite.create", { email: normalizeEmail(invite.email), role: invite.role });
      return NextResponse.json({ ok: true, data: { email: invite.email, role: invite.role } });
    } catch (err) {
      console.error("[api/org/invites POST] failed:", err);
      return createErrorResponse(500, "INTERNAL", "An unexpected internal server error occurred.");
    }
  },
  { minRole: "admin" }
);

/**
 * DELETE /api/org/invites (admin): withdraw an invitation. Does not remove an existing member.
 */
export const DELETE = withAuth(
  async function removeInvite(request: NextRequest, auth: OrgAuthContext): Promise<NextResponse> {
    const body = await parseJsonBody(request, RemoveBodySchema);
    if (!body.success) return body.response;
    try {
      await invitesRepo.remove(auth.orgId, body.data.email);
      await audit(auth.orgId, auth.user.uid, "invite.remove", { email: body.data.email });
      return NextResponse.json({ ok: true, data: { removed: true } });
    } catch (err) {
      console.error("[api/org/invites DELETE] failed:", err);
      return createErrorResponse(500, "INTERNAL", "An unexpected internal server error occurred.");
    }
  },
  { minRole: "admin" }
);
