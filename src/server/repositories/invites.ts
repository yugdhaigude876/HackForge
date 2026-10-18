import "server-only";

import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { getAdminFirestore } from "../firebase-admin";
import { validateId, clampLimit, toDate } from "./common";
import type { OrgRole } from "../auth";

/**
 * Pre-authorised access: an admin invites an email address with a role. The first time that person
 * signs in with that (verified) email, the server turns the invite into a member document.
 * Stored at orgs/{orgId}/invites/{emailKey}. Server-only (Firestore rules deny all client access).
 */
export interface OrgInvite {
  email: string;
  role: OrgRole;
  createdBy: string;
  createdAt: Date;
  claimedBy: string | null;
  claimedAt: Date | null;
}

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/** Stable document id for an email: base64url(sha256(email)), 43 characters, safe for paths. */
export function inviteKey(email: string): string {
  return createHash("sha256").update(normalizeEmail(email)).digest("base64url");
}

function fromDoc(data: FirebaseFirestore.DocumentData): OrgInvite {
  return {
    email: String(data.email),
    role: data.role as OrgRole,
    createdBy: String(data.createdBy ?? "unknown"),
    createdAt: data.createdAt ? toDate(data.createdAt) : new Date(0),
    claimedBy: typeof data.claimedBy === "string" ? data.claimedBy : null,
    claimedAt: data.claimedAt ? toDate(data.claimedAt) : null,
  };
}

export const invitesRepo = {
  async get(orgId: string, email: string, firestore?: Firestore): Promise<OrgInvite | null> {
    const db = firestore ?? getAdminFirestore();
    const snap = await db.doc(`orgs/${validateId(orgId, "orgId")}/invites/${inviteKey(email)}`).get();
    return snap.exists ? fromDoc(snap.data() ?? {}) : null;
  },

  /** Creates or replaces an invite. Re-inviting resets the claimed state. */
  async put(
    orgId: string,
    input: { email: string; role: OrgRole; createdBy: string },
    firestore?: Firestore
  ): Promise<OrgInvite> {
    const db = firestore ?? getAdminFirestore();
    const email = normalizeEmail(input.email);
    const doc = { email, role: input.role, createdBy: input.createdBy, createdAt: new Date(), claimedBy: null, claimedAt: null };
    await db.doc(`orgs/${validateId(orgId, "orgId")}/invites/${inviteKey(email)}`).set(doc);
    return fromDoc(doc);
  },

  async markClaimed(orgId: string, email: string, uid: string, firestore?: Firestore): Promise<void> {
    const db = firestore ?? getAdminFirestore();
    await db
      .doc(`orgs/${validateId(orgId, "orgId")}/invites/${inviteKey(email)}`)
      .set({ claimedBy: uid, claimedAt: new Date() }, { merge: true });
  },

  async list(orgId: string, options: { limit?: number } = {}, firestore?: Firestore): Promise<OrgInvite[]> {
    const db = firestore ?? getAdminFirestore();
    const snap = await db
      .collection(`orgs/${validateId(orgId, "orgId")}/invites`)
      .limit(clampLimit(options.limit, 100, 200))
      .get();
    return snap.docs.map((d) => fromDoc(d.data())).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  },

  async remove(orgId: string, email: string, firestore?: Firestore): Promise<void> {
    const db = firestore ?? getAdminFirestore();
    await db.doc(`orgs/${validateId(orgId, "orgId")}/invites/${inviteKey(email)}`).delete();
  },
};
