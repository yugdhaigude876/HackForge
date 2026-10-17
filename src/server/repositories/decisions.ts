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
import { DecisionDocSchema, validateDoc } from "./schemas";
import { Money } from "@/engine/money";

export interface DecisionAllocation {
  instrumentId: string;
  amount: Money;
  amountMinor: string;
}

export interface DecisionRecord {
  id: string;
  orgId: string;
  forecastId: string;
  confidence: number;
  reserve: Money;
  reserveMinor: string;
  surplus: Money;
  surplusMinor: string;
  allocations: DecisionAllocation[];
  status: string;
  expectedNetYield: Money;
  expectedNetYieldMinor: string;
  explanation: string;
  createdAt: Date;
  createdBy: string;
}

export interface CreateDecisionInput {
  id?: string;
  forecastId?: string;
  confidence: number;
  reserve: Money | string | bigint | number;
  surplus: Money | string | bigint | number;
  allocations: Array<{
    instrumentId: string;
    amount: Money | string | bigint | number;
  }>;
  status: string;
  expectedNetYield: Money | string | bigint | number;
  explanation: string;
}

export const decisionsRepo = {
  /**
   * Persists an optimization decision and instrument allocations.
   */
  async create(
    orgId: string,
    input: CreateDecisionInput,
    actorUid: string,
    firestore?: Firestore
  ): Promise<DecisionRecord> {
    const validOrgId = validateId(orgId, "orgId");
    const validForecastId = validateId(input.forecastId ?? "none", "forecastId");
    const validActor = validateId(actorUid, "actorUid");
    const db = firestore ?? getAdminFirestore();

    const colRef = db.collection(`orgs/${validOrgId}/decisions`);
    const docRef = input.id ? colRef.doc(validateId(input.id, "decisionId")) : colRef.doc();
    const id = docRef.id;

    const now = new Date();
    const reserveMinor = moneyToDecimalString(input.reserve);
    const surplusMinor = moneyToDecimalString(input.surplus);
    const expectedNetYieldMinor = moneyToDecimalString(input.expectedNetYield);

    const serializedAllocations = input.allocations.map((a) => ({
      instrumentId: validateId(a.instrumentId, "instrumentId"),
      amountMinor: moneyToDecimalString(a.amount),
    }));

    const docData = {
      id,
      orgId: validOrgId,
      forecastId: validForecastId,
      confidence: input.confidence,
      reserveMinor,
      surplusMinor,
      allocations: serializedAllocations,
      status: input.status,
      expectedNetYieldMinor,
      explanation: input.explanation,
      createdAt: toTimestamp(now),
      createdBy: validActor,
    };

    validateDoc(DecisionDocSchema, docData, id);
    await docRef.set(docData);

    return {
      id,
      orgId: validOrgId,
      forecastId: validForecastId,
      confidence: input.confidence,
      reserve: decimalStringToMoney(reserveMinor),
      reserveMinor,
      surplus: decimalStringToMoney(surplusMinor),
      surplusMinor,
      allocations: input.allocations.map((a) => {
        const amountMinor = moneyToDecimalString(a.amount);
        return {
          instrumentId: a.instrumentId,
          amount: decimalStringToMoney(amountMinor),
          amountMinor,
        };
      }),
      status: input.status,
      expectedNetYield: decimalStringToMoney(expectedNetYieldMinor),
      expectedNetYieldMinor,
      explanation: input.explanation,
      createdAt: now,
      createdBy: validActor,
    };
  },

  /**
   * Retrieves a decision record by ID.
   */
  async get(orgId: string, id: string, firestore?: Firestore): Promise<DecisionRecord | null> {
    const validOrgId = validateId(orgId, "orgId");
    const validId = validateId(id, "id");
    const db = firestore ?? getAdminFirestore();

    const snap = await db.doc(`orgs/${validOrgId}/decisions/${validId}`).get();
    if (!snap.exists) {
      return null;
    }

    const data = validateDoc(DecisionDocSchema, snap.data(), snap.id);
    return {
      id: data.id,
      orgId: validOrgId,
      forecastId: data.forecastId,
      confidence: data.confidence,
      reserve: decimalStringToMoney(data.reserveMinor),
      reserveMinor: data.reserveMinor,
      surplus: decimalStringToMoney(data.surplusMinor),
      surplusMinor: data.surplusMinor,
      allocations: data.allocations.map((a) => ({
        instrumentId: a.instrumentId,
        amount: decimalStringToMoney(a.amountMinor),
        amountMinor: a.amountMinor,
      })),
      status: data.status,
      expectedNetYield: decimalStringToMoney(data.expectedNetYieldMinor),
      expectedNetYieldMinor: data.expectedNetYieldMinor,
      explanation: data.explanation,
      createdAt: toDate(data.createdAt),
      createdBy: data.createdBy,
    };
  },

  /**
   * Lists decisions ordered newest first with bounded pagination.
   */
  async list(
    orgId: string,
    options: { limit?: number } = {},
    firestore?: Firestore
  ): Promise<DecisionRecord[]> {
    const validOrgId = validateId(orgId, "orgId");
    const take = clampLimit(options.limit);
    const db = firestore ?? getAdminFirestore();

    const snap = await db
      .collection(`orgs/${validOrgId}/decisions`)
      .orderBy("createdAt", "desc")
      .limit(take)
      .get();

    return snap.docs.map((d) => {
      const data = validateDoc(DecisionDocSchema, d.data(), d.id);
      return {
        id: data.id,
        orgId: validOrgId,
        forecastId: data.forecastId,
        confidence: data.confidence,
        reserve: decimalStringToMoney(data.reserveMinor),
        reserveMinor: data.reserveMinor,
        surplus: decimalStringToMoney(data.surplusMinor),
        surplusMinor: data.surplusMinor,
        allocations: data.allocations.map((a) => ({
          instrumentId: a.instrumentId,
          amount: decimalStringToMoney(a.amountMinor),
          amountMinor: a.amountMinor,
        })),
        status: data.status,
        expectedNetYield: decimalStringToMoney(data.expectedNetYieldMinor),
        expectedNetYieldMinor: data.expectedNetYieldMinor,
        explanation: data.explanation,
        createdAt: toDate(data.createdAt),
        createdBy: data.createdBy,
      };
    });
  },
};
