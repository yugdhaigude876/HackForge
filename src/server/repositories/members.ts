import "server-only";

import type { Firestore } from "firebase-admin/firestore";
import { getAdminFirestore } from "../firebase-admin";
import { validateId, clampLimit, toDate, toTimestamp } from "./common";
import { MemberDocSchema, validateDoc } from "./schemas";
import type { OrgRole } from "../auth";

export interface OrgMember {
  orgId: string;
  uid: string;
  role: OrgRole;
  createdAt: Date;
  createdBy: string;
}

export const membersRepo = {
  /**
   * Retrieves an organisation member by orgId and uid.
   */
  async get(orgId: string, uid: string, firestore?: Firestore): Promise<OrgMember | null> {
    const validOrgId = validateId(orgId, "orgId");
    const validUid = validateId(uid, "uid");
    const db = firestore ?? getAdminFirestore();

    const snap = await db.doc(`orgs/${validOrgId}/members/${validUid}`).get();
    if (!snap.exists) {
      return null;
    }

    const data = validateDoc(MemberDocSchema, snap.data(), snap.id);
    return {
      orgId: validOrgId,
      uid: validUid,
      role: data.role as OrgRole,
      createdAt: toDate(data.createdAt),
      createdBy: data.createdBy,
    };
  },

  /**
   * Assigns or updates a member role within an organisation.
   */
  async putRole(
    orgId: string,
    uid: string,
    role: OrgRole,
    actorUid: string,
    firestore?: Firestore
  ): Promise<OrgMember> {
    const validOrgId = validateId(orgId, "orgId");
    const validUid = validateId(uid, "uid");
    const validActor = validateId(actorUid, "actorUid");
    const db = firestore ?? getAdminFirestore();

    const now = new Date();
    const docData = {
      orgId: validOrgId,
      uid: validUid,
      role,
      createdAt: toTimestamp(now),
      createdBy: validActor,
    };

    validateDoc(MemberDocSchema, docData, validUid);
    await db.doc(`orgs/${validOrgId}/members/${validUid}`).set(docData, { merge: true });

    return {
      orgId: validOrgId,
      uid: validUid,
      role,
      createdAt: now,
      createdBy: validActor,
    };
  },

  /**
   * Lists organisation members with bounded pagination.
   */
  async list(
    orgId: string,
    options: { limit?: number } = {},
    firestore?: Firestore
  ): Promise<OrgMember[]> {
    const validOrgId = validateId(orgId, "orgId");
    const take = clampLimit(options.limit);
    const db = firestore ?? getAdminFirestore();

    const snap = await db.collection(`orgs/${validOrgId}/members`).limit(take).get();

    return snap.docs.map((d) => {
      const data = validateDoc(MemberDocSchema, d.data(), d.id);
      return {
        orgId: validOrgId,
        uid: d.id,
        role: data.role as OrgRole,
        createdAt: toDate(data.createdAt),
        createdBy: data.createdBy,
      };
    });
  },
};
