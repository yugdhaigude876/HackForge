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
import { InstrumentDocSchema, validateDoc } from "./schemas";
import { Money } from "@/engine/money";

export interface Instrument {
  id: string;
  orgId: string;
  name: string;
  annualRateBps: number;
  settlementLagHours: number;
  penaltyBps: number;
  capacity: Money;
  capacityMinor: string;
  minHoldHours: number;
  createdAt: Date;
  createdBy: string;
  updatedAt?: Date;
  updatedBy?: string;
}

export interface CreateInstrumentInput {
  name: string;
  annualRateBps: number;
  settlementLagHours: number;
  penaltyBps: number;
  capacity: Money | string | bigint | number;
  minHoldHours: number;
}

export interface UpdateInstrumentInput {
  name?: string;
  annualRateBps?: number;
  settlementLagHours?: number;
  penaltyBps?: number;
  capacity?: Money | string | bigint | number;
  minHoldHours?: number;
}

export const instrumentsRepo = {
  /**
   * Creates a new instrument in the organisation portfolio.
   */
  async create(
    orgId: string,
    input: CreateInstrumentInput,
    actorUid: string,
    firestore?: Firestore
  ): Promise<Instrument> {
    const validOrgId = validateId(orgId, "orgId");
    const validActor = validateId(actorUid, "actorUid");
    const db = firestore ?? getAdminFirestore();

    const colRef = db.collection(`orgs/${validOrgId}/instruments`);
    const docRef = colRef.doc();
    const id = docRef.id;

    const capacityMinor = moneyToDecimalString(input.capacity);
    const now = new Date();

    const docData = {
      id,
      orgId: validOrgId,
      name: input.name,
      annualRateBps: input.annualRateBps,
      settlementLagHours: input.settlementLagHours,
      penaltyBps: input.penaltyBps,
      capacityMinor,
      minHoldHours: input.minHoldHours,
      createdAt: toTimestamp(now),
      createdBy: validActor,
    };

    validateDoc(InstrumentDocSchema, docData, id);
    await docRef.set(docData);

    return {
      id,
      orgId: validOrgId,
      name: input.name,
      annualRateBps: input.annualRateBps,
      settlementLagHours: input.settlementLagHours,
      penaltyBps: input.penaltyBps,
      capacity: decimalStringToMoney(capacityMinor),
      capacityMinor,
      minHoldHours: input.minHoldHours,
      createdAt: now,
      createdBy: validActor,
    };
  },

  /**
   * Retrieves an instrument by ID.
   */
  async get(orgId: string, id: string, firestore?: Firestore): Promise<Instrument | null> {
    const validOrgId = validateId(orgId, "orgId");
    const validId = validateId(id, "id");
    const db = firestore ?? getAdminFirestore();

    const snap = await db.doc(`orgs/${validOrgId}/instruments/${validId}`).get();
    if (!snap.exists) {
      return null;
    }

    const data = validateDoc(InstrumentDocSchema, snap.data(), snap.id);
    return {
      id: data.id,
      orgId: validOrgId,
      name: data.name,
      annualRateBps: data.annualRateBps,
      settlementLagHours: data.settlementLagHours,
      penaltyBps: data.penaltyBps,
      capacity: decimalStringToMoney(data.capacityMinor),
      capacityMinor: data.capacityMinor,
      minHoldHours: data.minHoldHours,
      createdAt: toDate(data.createdAt),
      createdBy: data.createdBy,
      updatedAt: data.updatedAt ? toDate(data.updatedAt) : undefined,
      updatedBy: data.updatedBy,
    };
  },

  /**
   * Lists instruments for an organisation.
   */
  async list(
    orgId: string,
    options: { limit?: number } = {},
    firestore?: Firestore
  ): Promise<Instrument[]> {
    const validOrgId = validateId(orgId, "orgId");
    const take = clampLimit(options.limit);
    const db = firestore ?? getAdminFirestore();

    const snap = await db.collection(`orgs/${validOrgId}/instruments`).limit(take).get();

    return snap.docs.map((d) => {
      const data = validateDoc(InstrumentDocSchema, d.data(), d.id);
      return {
        id: data.id,
        orgId: validOrgId,
        name: data.name,
        annualRateBps: data.annualRateBps,
        settlementLagHours: data.settlementLagHours,
        penaltyBps: data.penaltyBps,
        capacity: decimalStringToMoney(data.capacityMinor),
        capacityMinor: data.capacityMinor,
        minHoldHours: data.minHoldHours,
        createdAt: toDate(data.createdAt),
        createdBy: data.createdBy,
        updatedAt: data.updatedAt ? toDate(data.updatedAt) : undefined,
        updatedBy: data.updatedBy,
      };
    });
  },

  /**
   * Updates an existing instrument.
   */
  async update(
    orgId: string,
    id: string,
    updates: UpdateInstrumentInput,
    actorUid: string,
    firestore?: Firestore
  ): Promise<Instrument> {
    const validOrgId = validateId(orgId, "orgId");
    const validId = validateId(id, "id");
    const validActor = validateId(actorUid, "actorUid");
    const db = firestore ?? getAdminFirestore();

    const existing = await this.get(validOrgId, validId, db);
    if (!existing) {
      throw new Error(`Instrument ${validId} not found in organisation ${validOrgId}`);
    }

    const now = new Date();
    const capacityMinor =
      updates.capacity !== undefined
        ? moneyToDecimalString(updates.capacity)
        : existing.capacityMinor;

    const updatedData = {
      ...existing,
      ...updates,
      id: validId,
      orgId: validOrgId,
      capacityMinor,
      createdAt: toTimestamp(existing.createdAt),
      updatedAt: toTimestamp(now),
      updatedBy: validActor,
    };

    validateDoc(InstrumentDocSchema, updatedData, validId);
    await db.doc(`orgs/${validOrgId}/instruments/${validId}`).update({
      ...(updates.name !== undefined ? { name: updates.name } : {}),
      ...(updates.annualRateBps !== undefined ? { annualRateBps: updates.annualRateBps } : {}),
      ...(updates.settlementLagHours !== undefined ? { settlementLagHours: updates.settlementLagHours } : {}),
      ...(updates.penaltyBps !== undefined ? { penaltyBps: updates.penaltyBps } : {}),
      ...(updates.capacity !== undefined ? { capacityMinor } : {}),
      ...(updates.minHoldHours !== undefined ? { minHoldHours: updates.minHoldHours } : {}),
      updatedAt: toTimestamp(now),
      updatedBy: validActor,
    });

    return {
      ...existing,
      ...updates,
      capacity: decimalStringToMoney(capacityMinor),
      capacityMinor,
      updatedAt: now,
      updatedBy: validActor,
    };
  },

  /**
   * Deletes an instrument.
   */
  async delete(orgId: string, id: string, firestore?: Firestore): Promise<void> {
    const validOrgId = validateId(orgId, "orgId");
    const validId = validateId(id, "id");
    const db = firestore ?? getAdminFirestore();

    await db.doc(`orgs/${validOrgId}/instruments/${validId}`).delete();
  },
};
