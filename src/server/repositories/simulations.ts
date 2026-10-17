import "server-only";

import type { Firestore, Query } from "firebase-admin/firestore";
import { getAdminFirestore } from "../firebase-admin";
import { validateId, clampLimit, toDate, toTimestamp } from "./common";
import { SimulationDocSchema, validateDoc } from "./schemas";

export interface SimulationRecord {
  id: string;
  orgId: string;
  comparisonId?: string;
  scenario: string | Record<string, unknown>;
  seed: number | string;
  policy: string | Record<string, unknown>;
  metrics: Record<string, unknown>;
  source?: "synthetic" | "import" | "live";
  createdAt: Date;
  createdBy: string;
}

export interface CreateSimulationInput {
  id?: string;
  comparisonId?: string;
  scenario: string | Record<string, unknown>;
  seed: number | string;
  policy: string | Record<string, unknown>;
  metrics: Record<string, unknown>;
  source?: "synthetic" | "import" | "live";
}

export const simulationsRepo = {
  /**
   * Persists a simulation run record.
   */
  async create(
    orgId: string,
    input: CreateSimulationInput,
    actorUid: string,
    firestore?: Firestore
  ): Promise<SimulationRecord> {
    const validOrgId = validateId(orgId, "orgId");
    const validActor = validateId(actorUid, "actorUid");
    const db = firestore ?? getAdminFirestore();

    const colRef = db.collection(`orgs/${validOrgId}/simulations`);
    const docRef = input.id ? colRef.doc(validateId(input.id, "simulationId")) : colRef.doc();
    const id = docRef.id;

    const now = new Date();
    const docData = {
      id,
      orgId: validOrgId,
      ...(input.comparisonId ? { comparisonId: input.comparisonId } : {}),
      scenario: input.scenario,
      seed: input.seed,
      policy: input.policy,
      metrics: input.metrics,
      ...(input.source ? { source: input.source } : {}),
      createdAt: toTimestamp(now),
      createdBy: validActor,
    };

    validateDoc(SimulationDocSchema, docData, id);
    await docRef.set(docData);

    return {
      id,
      orgId: validOrgId,
      comparisonId: input.comparisonId,
      scenario: input.scenario,
      seed: input.seed,
      policy: input.policy,
      metrics: input.metrics,
      source: input.source,
      createdAt: now,
      createdBy: validActor,
    };
  },

  /**
   * Retrieves a simulation record by ID.
   */
  async get(orgId: string, id: string, firestore?: Firestore): Promise<SimulationRecord | null> {
    const validOrgId = validateId(orgId, "orgId");
    const validId = validateId(id, "id");
    const db = firestore ?? getAdminFirestore();

    const snap = await db.doc(`orgs/${validOrgId}/simulations/${validId}`).get();
    if (!snap.exists) {
      return null;
    }

    const data = validateDoc(SimulationDocSchema, snap.data(), snap.id);
    return {
      id: data.id,
      orgId: validOrgId,
      comparisonId: data.comparisonId,
      scenario: data.scenario,
      seed: data.seed,
      policy: data.policy,
      metrics: data.metrics,
      source: data.source,
      createdAt: toDate(data.createdAt),
      createdBy: data.createdBy,
    };
  },

  /**
   * Lists simulations ordered newest first with bounded pagination.
   * Can optionally filter by scenario.
   */
  async list(
    orgId: string,
    options: { limit?: number; scenario?: string } = {},
    firestore?: Firestore
  ): Promise<SimulationRecord[]> {
    const validOrgId = validateId(orgId, "orgId");
    const take = clampLimit(options.limit);
    const db = firestore ?? getAdminFirestore();

    let query: Query = db.collection(`orgs/${validOrgId}/simulations`);

    if (options.scenario) {
      query = query.where("scenario", "==", options.scenario);
    }

    const snap = await query.orderBy("createdAt", "desc").limit(take).get();

    return snap.docs.map((d) => {
      const data = validateDoc(SimulationDocSchema, d.data(), d.id);
      return {
        id: data.id,
        orgId: validOrgId,
        comparisonId: data.comparisonId,
        scenario: data.scenario,
        seed: data.seed,
        policy: data.policy,
        metrics: data.metrics,
        source: data.source,
        createdAt: toDate(data.createdAt),
        createdBy: data.createdBy,
      };
    });
  },

  /**
   * Lists simulation records for a specific comparison ID ordered newest first.
   */
  async listByComparisonId(
    orgId: string,
    comparisonId: string,
    firestore?: Firestore
  ): Promise<SimulationRecord[]> {
    const validOrgId = validateId(orgId, "orgId");
    const validCmpId = validateId(comparisonId, "comparisonId");
    const db = firestore ?? getAdminFirestore();

    const snap = await db
      .collection(`orgs/${validOrgId}/simulations`)
      .where("comparisonId", "==", validCmpId)
      .orderBy("createdAt", "desc")
      .get();

    return snap.docs.map((d) => {
      const data = validateDoc(SimulationDocSchema, d.data(), d.id);
      return {
        id: data.id,
        orgId: validOrgId,
        comparisonId: data.comparisonId,
        scenario: data.scenario,
        seed: data.seed,
        policy: data.policy,
        metrics: data.metrics,
        source: data.source,
        createdAt: toDate(data.createdAt),
        createdBy: data.createdBy,
      };
    });
  },
};
