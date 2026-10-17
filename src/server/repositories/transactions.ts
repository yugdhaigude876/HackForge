import "server-only";

import type { Firestore } from "firebase-admin/firestore";
import { getAdminFirestore } from "../firebase-admin";
import {
  validateId,
  clampLimit,
  toDate,
  toTimestamp,
  moneyToDecimalString,
  decimalStringToMoney,
} from "./common";
import { TransactionDocSchema, validateDoc } from "./schemas";
import { Money } from "@/engine/money";

export type TransactionType = "deposit" | "withdrawal" | "settlement";
export type TransactionSource = "synthetic" | "import";

export interface Transaction {
  id: string;
  orgId: string;
  ts: Date;
  type: TransactionType;
  amount: Money;
  amountMinor: string;
  source: TransactionSource;
  seed?: number;
  createdAt: Date;
  createdBy: string;
}

export interface CreateTransactionInput {
  id?: string;
  ts: Date;
  type: TransactionType;
  amount: Money | string | bigint | number;
  source: TransactionSource;
  seed?: number;
}

export const transactionsRepo = {
  /**
   * Inserts transactions in atomic batches of at most 500 writes each
   * (the hard Firestore Admin SDK batch limit).
   */
  async batchInsert(
    orgId: string,
    inputs: CreateTransactionInput[],
    actorUid: string,
    firestore?: Firestore
  ): Promise<Transaction[]> {
    const validOrgId = validateId(orgId, "orgId");
    const validActor = validateId(actorUid, "actorUid");
    const db = firestore ?? getAdminFirestore();

    if (inputs.length === 0) {
      return [];
    }

    const now = new Date();
    const created: Transaction[] = [];
    const BATCH_SIZE = 500;

    for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
      const chunk = inputs.slice(i, i + BATCH_SIZE);
      const batch = db.batch();

      for (const item of chunk) {
        const colRef = db.collection(`orgs/${validOrgId}/transactions`);
        const docRef = item.id ? colRef.doc(validateId(item.id, "transactionId")) : colRef.doc();
        const id = docRef.id;

        const amountMinor = moneyToDecimalString(item.amount);
        const docData = {
          id,
          orgId: validOrgId,
          ts: toTimestamp(item.ts),
          type: item.type,
          amountMinor,
          source: item.source,
          ...(item.seed !== undefined ? { seed: item.seed } : {}),
          createdAt: toTimestamp(now),
          createdBy: validActor,
        };

        validateDoc(TransactionDocSchema, docData, id);
        batch.set(docRef, docData);

        created.push({
          id,
          orgId: validOrgId,
          ts: item.ts,
          type: item.type,
          amount: decimalStringToMoney(amountMinor),
          amountMinor,
          source: item.source,
          seed: item.seed,
          createdAt: now,
          createdBy: validActor,
        });
      }

      await batch.commit();
    }

    return created;
  },

  /**
   * Retrieves a transaction by ID.
   */
  async get(orgId: string, id: string, firestore?: Firestore): Promise<Transaction | null> {
    const validOrgId = validateId(orgId, "orgId");
    const validId = validateId(id, "id");
    const db = firestore ?? getAdminFirestore();

    const snap = await db.doc(`orgs/${validOrgId}/transactions/${validId}`).get();
    if (!snap.exists) {
      return null;
    }

    const data = validateDoc(TransactionDocSchema, snap.data(), snap.id);
    return {
      id: data.id,
      orgId: validOrgId,
      ts: toDate(data.ts),
      type: data.type,
      amount: decimalStringToMoney(data.amountMinor),
      amountMinor: data.amountMinor,
      source: data.source,
      seed: data.seed,
      createdAt: toDate(data.createdAt),
      createdBy: data.createdBy,
    };
  },

  /**
   * Queries transactions within a timestamp range [from, to] with bounded pagination.
   */
  async listByTimeRange(
    orgId: string,
    from: Date,
    to: Date,
    options: { limit?: number; type?: TransactionType } = {},
    firestore?: Firestore
  ): Promise<Transaction[]> {
    const validOrgId = validateId(orgId, "orgId");
    const take = clampLimit(options.limit);
    const db = firestore ?? getAdminFirestore();

    let query = db
      .collection(`orgs/${validOrgId}/transactions`)
      .where("ts", ">=", toTimestamp(from))
      .where("ts", "<=", toTimestamp(to));

    if (options.type) {
      query = query.where("type", "==", options.type);
    }

    const snap = await query.orderBy("ts", "desc").limit(take).get();

    return snap.docs.map((d) => {
      const data = validateDoc(TransactionDocSchema, d.data(), d.id);
      return {
        id: data.id,
        orgId: validOrgId,
        ts: toDate(data.ts),
        type: data.type,
        amount: decimalStringToMoney(data.amountMinor),
        amountMinor: data.amountMinor,
        source: data.source,
        seed: data.seed,
        createdAt: toDate(data.createdAt),
        createdBy: data.createdBy,
      };
    });
  },
};
