import "server-only";

import type { Firestore } from "firebase-admin/firestore";
import { getAdminFirestore } from "../firebase-admin";
import { validateId, clampLimit, toDate, toTimestamp } from "./common";
import { AuditDocSchema, validateDoc } from "./schemas";

export interface AuditRecord {
  id: string;
  orgId: string;
  actorUid: string;
  action: string;
  refPath: string;
  beforeHash?: string;
  afterHash?: string;
  ts: Date;
  createdAt: Date;
}

export interface CreateAuditEntryInput {
  id?: string;
  actorUid: string;
  action: string;
  refPath: string;
  beforeHash?: string;
  afterHash?: string;
  ts?: Date;
}

/**
 * Append-only audit repository.
 *
 * CRITICAL COMPLIANCE CONSTRAINT:
 * This repository is strictly append-only. It NEVER exposes update or delete methods
 * to ensure an immutable, tamper-evident audit log for financial compliance.
 */
export const auditRepo = {
  /**
   * Appends an immutable audit log entry.
   */
  async append(
    orgId: string,
    input: CreateAuditEntryInput,
    firestore?: Firestore
  ): Promise<AuditRecord> {
    const validOrgId = validateId(orgId, "orgId");
    const validActor = validateId(input.actorUid, "actorUid");
    const db = firestore ?? getAdminFirestore();

    const colRef = db.collection(`orgs/${validOrgId}/audit`);
    const docRef = input.id ? colRef.doc(validateId(input.id, "auditId")) : colRef.doc();
    const id = docRef.id;

    const now = new Date();
    const ts = input.ts ?? now;

    const docData = {
      id,
      orgId: validOrgId,
      actorUid: validActor,
      action: input.action,
      refPath: input.refPath,
      ...(input.beforeHash ? { beforeHash: input.beforeHash } : {}),
      ...(input.afterHash ? { afterHash: input.afterHash } : {}),
      ts: toTimestamp(ts),
      createdAt: toTimestamp(now),
    };

    validateDoc(AuditDocSchema, docData, id);
    await docRef.set(docData);

    return {
      id,
      orgId: validOrgId,
      actorUid: validActor,
      action: input.action,
      refPath: input.refPath,
      beforeHash: input.beforeHash,
      afterHash: input.afterHash,
      ts,
      createdAt: now,
    };
  },

  /**
   * Retrieves an audit record by ID.
   */
  async get(orgId: string, id: string, firestore?: Firestore): Promise<AuditRecord | null> {
    const validOrgId = validateId(orgId, "orgId");
    const validId = validateId(id, "id");
    const db = firestore ?? getAdminFirestore();

    const snap = await db.doc(`orgs/${validOrgId}/audit/${validId}`).get();
    if (!snap.exists) {
      return null;
    }

    const data = validateDoc(AuditDocSchema, snap.data(), snap.id);
    return {
      id: data.id,
      orgId: validOrgId,
      actorUid: data.actorUid,
      action: data.action,
      refPath: data.refPath,
      beforeHash: data.beforeHash,
      afterHash: data.afterHash,
      ts: toDate(data.ts),
      createdAt: toDate(data.createdAt),
    };
  },

  /**
   * Lists audit records chronologically descending with bounded pagination.
   */
  async list(
    orgId: string,
    options: { limit?: number } = {},
    firestore?: Firestore
  ): Promise<AuditRecord[]> {
    const validOrgId = validateId(orgId, "orgId");
    const take = clampLimit(options.limit);
    const db = firestore ?? getAdminFirestore();

    const snap = await db
      .collection(`orgs/${validOrgId}/audit`)
      .orderBy("ts", "desc")
      .limit(take)
      .get();

    return snap.docs.map((d) => {
      const data = validateDoc(AuditDocSchema, d.data(), d.id);
      return {
        id: data.id,
        orgId: validOrgId,
        actorUid: data.actorUid,
        action: data.action,
        refPath: data.refPath,
        beforeHash: data.beforeHash,
        afterHash: data.afterHash,
        ts: toDate(data.ts),
        createdAt: toDate(data.createdAt),
      };
    });
  },
};
