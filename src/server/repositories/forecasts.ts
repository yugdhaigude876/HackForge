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
import { ForecastDocSchema, validateDoc } from "./schemas";
import { Money } from "@/engine/money";

export interface ForecastPoint {
  ts: Date;
  mean: Money;
  meanMinor: string;
  bandLower?: Money;
  bandLowerMinor?: string;
  bandUpper?: Money;
  bandUpperMinor?: string;
}

export interface ForecastRecord {
  id: string;
  orgId: string;
  method: string;
  params: Record<string, unknown>;
  asOf: Date;
  horizon: number;
  points: ForecastPoint[];
  residualQuantiles: Record<string, number>;
  backtest: {
    mase: number;
    pinball: number;
    skillVsBaseline?: number;
    sampleSize?: number;
  };
  source?: "synthetic" | "import" | "live";
  createdAt: Date;
  createdBy: string;
}

export interface CreateForecastInput {
  id?: string;
  method: string;
  params: Record<string, unknown>;
  asOf: Date;
  horizon: number;
  points: Array<{
    ts: Date;
    mean: Money | string | bigint | number;
    bandLower?: Money | string | bigint | number;
    bandUpper?: Money | string | bigint | number;
  }>;
  residualQuantiles: Record<string, number>;
  backtest: {
    mase: number;
    pinball: number;
    skillVsBaseline?: number;
    sampleSize?: number;
  };
  source?: "synthetic" | "import" | "live";
}

export const forecastsRepo = {
  /**
   * Persists a new forecast calculation.
   */
  async create(
    orgId: string,
    input: CreateForecastInput,
    actorUid: string,
    firestore?: Firestore
  ): Promise<ForecastRecord> {
    const validOrgId = validateId(orgId, "orgId");
    const validActor = validateId(actorUid, "actorUid");
    const db = firestore ?? getAdminFirestore();

    const colRef = db.collection(`orgs/${validOrgId}/forecasts`);
    const docRef = input.id ? colRef.doc(validateId(input.id, "forecastId")) : colRef.doc();
    const id = docRef.id;

    const now = new Date();
    const serializedPoints = input.points.map((p) => {
      const pt: Record<string, unknown> = {
        ts: toTimestamp(p.ts),
        meanMinor: moneyToDecimalString(p.mean),
      };
      if (p.bandLower !== undefined) pt.bandLowerMinor = moneyToDecimalString(p.bandLower);
      if (p.bandUpper !== undefined) pt.bandUpperMinor = moneyToDecimalString(p.bandUpper);
      return pt;
    });

    const docData: Record<string, unknown> = {
      id,
      orgId: validOrgId,
      method: input.method,
      params: input.params,
      asOf: toTimestamp(input.asOf),
      horizon: input.horizon,
      points: serializedPoints,
      residualQuantiles: input.residualQuantiles,
      backtest: input.backtest,
      createdAt: toTimestamp(now),
      createdBy: validActor,
    };
    if (input.source) docData.source = input.source;

    validateDoc(ForecastDocSchema, docData, id);
    await docRef.set(docData);

    return {
      id,
      orgId: validOrgId,
      method: input.method,
      params: input.params,
      asOf: input.asOf,
      horizon: input.horizon,
      points: input.points.map((p) => {
        const meanMinor = moneyToDecimalString(p.mean);
        const bandLowerMinor = p.bandLower !== undefined ? moneyToDecimalString(p.bandLower) : undefined;
        const bandUpperMinor = p.bandUpper !== undefined ? moneyToDecimalString(p.bandUpper) : undefined;
        return {
          ts: p.ts,
          mean: decimalStringToMoney(meanMinor),
          meanMinor,
          bandLower: bandLowerMinor ? decimalStringToMoney(bandLowerMinor) : undefined,
          bandLowerMinor,
          bandUpper: bandUpperMinor ? decimalStringToMoney(bandUpperMinor) : undefined,
          bandUpperMinor,
        };
      }),
      residualQuantiles: input.residualQuantiles,
      backtest: input.backtest,
      source: input.source,
      createdAt: now,
      createdBy: validActor,
    };
  },

  /**
   * Retrieves a forecast by ID.
   */
  async get(orgId: string, id: string, firestore?: Firestore): Promise<ForecastRecord | null> {
    const validOrgId = validateId(orgId, "orgId");
    const validId = validateId(id, "id");
    const db = firestore ?? getAdminFirestore();

    const snap = await db.doc(`orgs/${validOrgId}/forecasts/${validId}`).get();
    if (!snap.exists) {
      return null;
    }

    const data = validateDoc(ForecastDocSchema, snap.data(), snap.id);
    return {
      id: data.id,
      orgId: validOrgId,
      method: data.method,
      params: data.params,
      asOf: toDate(data.asOf),
      horizon: data.horizon,
      points: data.points.map((p) => ({
        ts: toDate(p.ts),
        mean: decimalStringToMoney(p.meanMinor),
        meanMinor: p.meanMinor,
        bandLower: p.bandLowerMinor ? decimalStringToMoney(p.bandLowerMinor) : undefined,
        bandLowerMinor: p.bandLowerMinor,
        bandUpper: p.bandUpperMinor ? decimalStringToMoney(p.bandUpperMinor) : undefined,
        bandUpperMinor: p.bandUpperMinor,
      })),
      residualQuantiles: data.residualQuantiles,
      backtest: data.backtest,
      source: data.source,
      createdAt: toDate(data.createdAt),
      createdBy: data.createdBy,
    };
  },

  /**
   * Lists forecasts ordered newest first with bounded pagination.
   */
  async list(
    orgId: string,
    options: { limit?: number } = {},
    firestore?: Firestore
  ): Promise<ForecastRecord[]> {
    const validOrgId = validateId(orgId, "orgId");
    const take = clampLimit(options.limit);
    const db = firestore ?? getAdminFirestore();

    const snap = await db
      .collection(`orgs/${validOrgId}/forecasts`)
      .orderBy("createdAt", "desc")
      .limit(take)
      .get();

    return snap.docs.map((d) => {
      const data = validateDoc(ForecastDocSchema, d.data(), d.id);
      return {
        id: data.id,
        orgId: validOrgId,
        method: data.method,
        params: data.params,
        asOf: toDate(data.asOf),
        horizon: data.horizon,
        points: data.points.map((p) => ({
          ts: toDate(p.ts),
          mean: decimalStringToMoney(p.meanMinor),
          meanMinor: p.meanMinor,
          bandLower: p.bandLowerMinor ? decimalStringToMoney(p.bandLowerMinor) : undefined,
          bandLowerMinor: p.bandLowerMinor,
          bandUpper: p.bandUpperMinor ? decimalStringToMoney(p.bandUpperMinor) : undefined,
          bandUpperMinor: p.bandUpperMinor,
        })),
        residualQuantiles: data.residualQuantiles,
        backtest: data.backtest,
        source: data.source,
        createdAt: toDate(data.createdAt),
        createdBy: data.createdBy,
      };
    });
  },
};
