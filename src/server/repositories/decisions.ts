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
  name?: string;
  amount: Money;
  amountMinor: string;
  annualRateBps?: number;
  settlementLagHours?: number;
  penaltyBps?: number;
  capacity?: Money;
  capacityMinor?: string;
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
  availableCash?: Money;
  availableCashMinor?: string;
  deployedTotal?: Money;
  deployedTotalMinor?: string;
  operationalFloor?: Money;
  operationalFloorMinor?: string;
  horizonHours?: number;
  alpha?: number;
  expectedCumulativeFlow?: Money;
  expectedCumulativeFlowMinor?: string;
  worstCaseResidualShortfall?: Money;
  worstCaseResidualShortfallMinor?: string;
  backtest?: {
    mase: number;
    sampleSize: number;
  };
  allocations: DecisionAllocation[];
  status: string;
  expectedNetYield: Money;
  expectedNetYieldMinor: string;
  explanation: string;
  source?: "synthetic" | "import" | "live";
  createdAt: Date;
  createdBy: string;
}

export interface CreateDecisionInput {
  id?: string;
  forecastId?: string;
  confidence: number;
  reserve: Money | string | bigint | number;
  surplus: Money | string | bigint | number;
  availableCash?: Money | string | bigint | number;
  deployedTotal?: Money | string | bigint | number;
  operationalFloor?: Money | string | bigint | number;
  horizonHours?: number;
  alpha?: number;
  expectedCumulativeFlow?: Money | string | bigint | number;
  worstCaseResidualShortfall?: Money | string | bigint | number;
  backtest?: {
    mase: number;
    sampleSize: number;
  };
  allocations: Array<{
    instrumentId: string;
    name?: string;
    amount: Money | string | bigint | number;
    annualRateBps?: number;
    settlementLagHours?: number;
    penaltyBps?: number;
    capacity?: Money | string | bigint | number;
  }>;
  status: string;
  expectedNetYield: Money | string | bigint | number;
  explanation: string;
  source?: "synthetic" | "import" | "live";
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
    const availableCashMinor = input.availableCash !== undefined ? moneyToDecimalString(input.availableCash) : undefined;
    const deployedTotalMinor = input.deployedTotal !== undefined ? moneyToDecimalString(input.deployedTotal) : undefined;
    const operationalFloorMinor = input.operationalFloor !== undefined ? moneyToDecimalString(input.operationalFloor) : undefined;
    const expectedCumulativeFlowMinor = input.expectedCumulativeFlow !== undefined ? moneyToDecimalString(input.expectedCumulativeFlow) : undefined;
    const worstCaseResidualShortfallMinor = input.worstCaseResidualShortfall !== undefined ? moneyToDecimalString(input.worstCaseResidualShortfall) : undefined;

    const serializedAllocations = input.allocations.map((a) => ({
      instrumentId: validateId(a.instrumentId, "instrumentId"),
      name: a.name,
      amountMinor: moneyToDecimalString(a.amount),
      annualRateBps: a.annualRateBps,
      settlementLagHours: a.settlementLagHours,
      penaltyBps: a.penaltyBps,
      capacityMinor: a.capacity !== undefined ? moneyToDecimalString(a.capacity) : undefined,
    }));

    const docData: Record<string, unknown> = {
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

    if (availableCashMinor !== undefined) docData.availableCashMinor = availableCashMinor;
    if (deployedTotalMinor !== undefined) docData.deployedTotalMinor = deployedTotalMinor;
    if (operationalFloorMinor !== undefined) docData.operationalFloorMinor = operationalFloorMinor;
    if (input.horizonHours !== undefined) docData.horizonHours = input.horizonHours;
    if (input.alpha !== undefined) docData.alpha = input.alpha;
    if (expectedCumulativeFlowMinor !== undefined) docData.expectedCumulativeFlowMinor = expectedCumulativeFlowMinor;
    if (worstCaseResidualShortfallMinor !== undefined) docData.worstCaseResidualShortfallMinor = worstCaseResidualShortfallMinor;
    if (input.backtest) docData.backtest = input.backtest;
    if (input.source) docData.source = input.source;

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
      availableCash: availableCashMinor ? decimalStringToMoney(availableCashMinor) : undefined,
      availableCashMinor,
      deployedTotal: deployedTotalMinor ? decimalStringToMoney(deployedTotalMinor) : undefined,
      deployedTotalMinor,
      operationalFloor: operationalFloorMinor ? decimalStringToMoney(operationalFloorMinor) : undefined,
      operationalFloorMinor,
      horizonHours: input.horizonHours,
      alpha: input.alpha,
      expectedCumulativeFlow: expectedCumulativeFlowMinor ? decimalStringToMoney(expectedCumulativeFlowMinor) : undefined,
      expectedCumulativeFlowMinor,
      worstCaseResidualShortfall: worstCaseResidualShortfallMinor ? decimalStringToMoney(worstCaseResidualShortfallMinor) : undefined,
      worstCaseResidualShortfallMinor,
      backtest: input.backtest,
      allocations: input.allocations.map((a) => {
        const amountMinor = moneyToDecimalString(a.amount);
        const capacityMinor = a.capacity !== undefined ? moneyToDecimalString(a.capacity) : undefined;
        return {
          instrumentId: a.instrumentId,
          name: a.name,
          amount: decimalStringToMoney(amountMinor),
          amountMinor,
          annualRateBps: a.annualRateBps,
          settlementLagHours: a.settlementLagHours,
          penaltyBps: a.penaltyBps,
          capacity: capacityMinor ? decimalStringToMoney(capacityMinor) : undefined,
          capacityMinor,
        };
      }),
      status: input.status,
      expectedNetYield: decimalStringToMoney(expectedNetYieldMinor),
      expectedNetYieldMinor,
      explanation: input.explanation,
      source: input.source,
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
      availableCash: data.availableCashMinor ? decimalStringToMoney(data.availableCashMinor) : undefined,
      availableCashMinor: data.availableCashMinor,
      deployedTotal: data.deployedTotalMinor ? decimalStringToMoney(data.deployedTotalMinor) : undefined,
      deployedTotalMinor: data.deployedTotalMinor,
      operationalFloor: data.operationalFloorMinor ? decimalStringToMoney(data.operationalFloorMinor) : undefined,
      operationalFloorMinor: data.operationalFloorMinor,
      horizonHours: data.horizonHours,
      alpha: data.alpha,
      expectedCumulativeFlow: data.expectedCumulativeFlowMinor ? decimalStringToMoney(data.expectedCumulativeFlowMinor) : undefined,
      expectedCumulativeFlowMinor: data.expectedCumulativeFlowMinor,
      worstCaseResidualShortfall: data.worstCaseResidualShortfallMinor ? decimalStringToMoney(data.worstCaseResidualShortfallMinor) : undefined,
      worstCaseResidualShortfallMinor: data.worstCaseResidualShortfallMinor,
      backtest: data.backtest,
      allocations: data.allocations.map((a) => ({
        instrumentId: a.instrumentId,
        name: a.name,
        amount: decimalStringToMoney(a.amountMinor),
        amountMinor: a.amountMinor,
        annualRateBps: a.annualRateBps,
        settlementLagHours: a.settlementLagHours,
        penaltyBps: a.penaltyBps,
        capacity: a.capacityMinor ? decimalStringToMoney(a.capacityMinor) : undefined,
        capacityMinor: a.capacityMinor,
      })),
      status: data.status,
      expectedNetYield: decimalStringToMoney(data.expectedNetYieldMinor),
      expectedNetYieldMinor: data.expectedNetYieldMinor,
      explanation: data.explanation,
      source: data.source,
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
        availableCash: data.availableCashMinor ? decimalStringToMoney(data.availableCashMinor) : undefined,
        availableCashMinor: data.availableCashMinor,
        deployedTotal: data.deployedTotalMinor ? decimalStringToMoney(data.deployedTotalMinor) : undefined,
        deployedTotalMinor: data.deployedTotalMinor,
        operationalFloor: data.operationalFloorMinor ? decimalStringToMoney(data.operationalFloorMinor) : undefined,
        operationalFloorMinor: data.operationalFloorMinor,
        horizonHours: data.horizonHours,
        alpha: data.alpha,
        expectedCumulativeFlow: data.expectedCumulativeFlowMinor ? decimalStringToMoney(data.expectedCumulativeFlowMinor) : undefined,
        expectedCumulativeFlowMinor: data.expectedCumulativeFlowMinor,
        worstCaseResidualShortfall: data.worstCaseResidualShortfallMinor ? decimalStringToMoney(data.worstCaseResidualShortfallMinor) : undefined,
        worstCaseResidualShortfallMinor: data.worstCaseResidualShortfallMinor,
        backtest: data.backtest,
        allocations: data.allocations.map((a) => ({
          instrumentId: a.instrumentId,
          name: a.name,
          amount: decimalStringToMoney(a.amountMinor),
          amountMinor: a.amountMinor,
          annualRateBps: a.annualRateBps,
          settlementLagHours: a.settlementLagHours,
          penaltyBps: a.penaltyBps,
          capacity: a.capacityMinor ? decimalStringToMoney(a.capacityMinor) : undefined,
          capacityMinor: a.capacityMinor,
        })),
        status: data.status,
        expectedNetYield: decimalStringToMoney(data.expectedNetYieldMinor),
        expectedNetYieldMinor: data.expectedNetYieldMinor,
        explanation: data.explanation,
        source: data.source,
        createdAt: toDate(data.createdAt),
        createdBy: data.createdBy,
      };
    });
  },
};
