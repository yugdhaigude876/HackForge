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
import { SeriesBucketDocSchema, validateDoc } from "./schemas";
import { Money } from "@/engine/money";

export interface SeriesBucket {
  bucketId: string;
  orgId: string;
  hourStart: Date;
  inFlow: Money;
  outFlow: Money;
  inMinor: string;
  outMinor: string;
  updatedAt: Date;
}

export interface CreateSeriesBucketInput {
  bucketId?: string;
  hourStart: Date;
  inMinor: Money | string | bigint | number;
  outMinor: Money | string | bigint | number;
}

/**
 * Formats a Date into a safe ISO hour bucket ID conforming to ^[A-Za-z0-9_-]{1,64}$
 * e.g. "2026-03-01T14-00-00Z"
 */
export function formatHourBucketId(date: Date): string {
  const iso = date.toISOString();
  // Truncate to hour and replace ':' with '-' to stay within safe character set
  return iso.slice(0, 13).replace(/[:.]/g, "-") + "-00-00Z";
}

export const seriesRepo = {
  /**
   * Upserts an aggregated hourly bucket keyed by bucketId.
   */
  async upsertBucket(
    orgId: string,
    input: CreateSeriesBucketInput,
    firestore?: Firestore
  ): Promise<SeriesBucket> {
    const validOrgId = validateId(orgId, "orgId");
    const bucketId = validateId(
      input.bucketId ?? formatHourBucketId(input.hourStart),
      "bucketId"
    );
    const db = firestore ?? getAdminFirestore();

    const inMinor = moneyToDecimalString(input.inMinor);
    const outMinor = moneyToDecimalString(input.outMinor);
    const now = new Date();

    const docData = {
      bucketId,
      orgId: validOrgId,
      hourStart: toTimestamp(input.hourStart),
      inMinor,
      outMinor,
      updatedAt: toTimestamp(now),
    };

    validateDoc(SeriesBucketDocSchema, docData, bucketId);
    await db.doc(`orgs/${validOrgId}/series/${bucketId}`).set(docData, { merge: true });

    return {
      bucketId,
      orgId: validOrgId,
      hourStart: input.hourStart,
      inFlow: decimalStringToMoney(inMinor),
      outFlow: decimalStringToMoney(outMinor),
      inMinor,
      outMinor,
      updatedAt: now,
    };
  },

  /**
   * Retrieves a single series bucket by bucketId.
   */
  async getBucket(
    orgId: string,
    bucketId: string,
    firestore?: Firestore
  ): Promise<SeriesBucket | null> {
    const validOrgId = validateId(orgId, "orgId");
    const validBucketId = validateId(bucketId, "bucketId");
    const db = firestore ?? getAdminFirestore();

    const snap = await db.doc(`orgs/${validOrgId}/series/${validBucketId}`).get();
    if (!snap.exists) {
      return null;
    }

    const data = validateDoc(SeriesBucketDocSchema, snap.data(), snap.id);
    return {
      bucketId: data.bucketId,
      orgId: validOrgId,
      hourStart: toDate(data.hourStart),
      inFlow: decimalStringToMoney(data.inMinor),
      outFlow: decimalStringToMoney(data.outMinor),
      inMinor: data.inMinor,
      outMinor: data.outMinor,
      updatedAt: toDate(data.updatedAt),
    };
  },

  /**
   * Reads a range of hourly buckets ordered chronologically.
   */
  async listRange(
    orgId: string,
    fromHour: Date,
    toHour: Date,
    options: { limit?: number } = {},
    firestore?: Firestore
  ): Promise<SeriesBucket[]> {
    const validOrgId = validateId(orgId, "orgId");
    const take = clampLimit(options.limit);
    const db = firestore ?? getAdminFirestore();

    const snap = await db
      .collection(`orgs/${validOrgId}/series`)
      .where("hourStart", ">=", toTimestamp(fromHour))
      .where("hourStart", "<=", toTimestamp(toHour))
      .orderBy("hourStart", "asc")
      .limit(take)
      .get();

    return snap.docs.map((d) => {
      const data = validateDoc(SeriesBucketDocSchema, d.data(), d.id);
      return {
        bucketId: data.bucketId,
        orgId: validOrgId,
        hourStart: toDate(data.hourStart),
        inFlow: decimalStringToMoney(data.inMinor),
        outFlow: decimalStringToMoney(data.outMinor),
        inMinor: data.inMinor,
        outMinor: data.outMinor,
        updatedAt: toDate(data.updatedAt),
      };
    });
  },
};
