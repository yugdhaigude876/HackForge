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
  };
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
  }>;
  residualQuantiles: Record<string, number>;
  backtest: {
    mase: number;
    pinball: number;
    skillVsBaseline?: number;
  };
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
    const serializedPoints = input.points.map((p) => ({
      ts: toTimestamp(p.ts),
      meanMinor: moneyToDecimalString(p.mean),
    }));

    const docData = {
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
        return {
          ts: p.ts,
          mean: decimalStringToMoney(meanMinor),
          meanMinor,
        };
      }),
      residualQuantiles: input.residualQuantiles,
      backtest: input.backtest,
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
      })),
      residualQuantiles: data.residualQuantiles,
      backtest: data.backtest,
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
        })),
        residualQuantiles: data.residualQuantiles,
        backtest: data.backtest,
        createdAt: toDate(data.createdAt),
        createdBy: data.createdBy,
      };
    });
  },
};
