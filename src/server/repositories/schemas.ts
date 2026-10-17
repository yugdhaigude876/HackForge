import "server-only";

import { z } from "zod";
import { RepositoryError } from "./common";

/**
 * Validates untrusted or raw Firestore document data against a Zod schema.
 * Throws a typed RepositoryError with "MALFORMED_DATA" if validation fails.
 */
export function validateDoc<T>(schema: z.ZodType<T>, data: unknown, docId: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const errorDetails = result.error.issues
      .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
      .join("; ");
    throw new RepositoryError(
      "MALFORMED_DATA",
      `Document "${docId}" failed schema validation: ${errorDetails}`,
      result.error.issues
    );
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Document Zod Schemas (storage layer)
// ---------------------------------------------------------------------------

export const MemberRoleSchema = z.enum(["admin", "analyst", "viewer"]);

export const OrgDocSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  currency: z.string().default("USD"),
  createdAt: z.unknown(), // Timestamp | Date
  createdBy: z.string().min(1),
});

export const MemberDocSchema = z.object({
  orgId: z.string().min(1),
  uid: z.string().min(1),
  role: MemberRoleSchema,
  createdAt: z.unknown(),
  createdBy: z.string().min(1),
});

export const InstrumentDocSchema = z.object({
  id: z.string().min(1),
  orgId: z.string().min(1),
  name: z.string().min(1),
  annualRateBps: z.number().int().nonnegative(),
  settlementLagHours: z.number().int().nonnegative(),
  penaltyBps: z.number().int().nonnegative(),
  capacityMinor: z.string().regex(/^-?\d+$/, "capacityMinor must be a decimal integer string"),
  minHoldHours: z.number().int().nonnegative(),
  createdAt: z.unknown(),
  createdBy: z.string().min(1),
  updatedAt: z.unknown().optional(),
  updatedBy: z.string().optional(),
});

export const TransactionDocSchema = z.object({
  id: z.string().min(1),
  orgId: z.string().min(1),
  ts: z.unknown(),
  type: z.enum(["deposit", "withdrawal", "settlement"]),
  amountMinor: z.string().regex(/^-?\d+$/, "amountMinor must be a decimal integer string"),
  source: z.enum(["synthetic", "import"]),
  seed: z.number().optional(),
  createdAt: z.unknown(),
  createdBy: z.string().min(1),
});

export const SeriesBucketDocSchema = z.object({
  bucketId: z.string().min(1), // ISO hour string (e.g. 2026-03-01T00:00:00.000Z)
  orgId: z.string().min(1),
  hourStart: z.unknown(),
  inMinor: z.string().regex(/^-?\d+$/, "inMinor must be a decimal integer string"),
  outMinor: z.string().regex(/^-?\d+$/, "outMinor must be a decimal integer string"),
  updatedAt: z.unknown(),
});

export const ForecastDocSchema = z.object({
  id: z.string().min(1),
  orgId: z.string().min(1),
  method: z.string().min(1),
  params: z.record(z.string(), z.unknown()),
  asOf: z.unknown(),
  horizon: z.number().int().positive(),
  points: z.array(
    z.object({
      ts: z.unknown(),
      meanMinor: z.string().regex(/^-?\d+$/, "meanMinor must be a decimal integer string"),
      bandLowerMinor: z.string().regex(/^-?\d+$/, "bandLowerMinor must be a decimal integer string").optional(),
      bandUpperMinor: z.string().regex(/^-?\d+$/, "bandUpperMinor must be a decimal integer string").optional(),
    })
  ),
  residualQuantiles: z.record(z.string(), z.number()),
  backtest: z.object({
    mase: z.number(),
    pinball: z.number(),
    skillVsBaseline: z.number().optional(),
    sampleSize: z.number().optional(),
  }),
  source: z.enum(["synthetic", "import", "live"]).optional(),
  createdAt: z.unknown(),
  createdBy: z.string().min(1),
});

export const DecisionDocSchema = z.object({
  id: z.string().min(1),
  orgId: z.string().min(1),
  forecastId: z.string().optional().default("none"),
  confidence: z.number(),
  reserveMinor: z.string().regex(/^-?\d+$/, "reserveMinor must be a decimal integer string"),
  surplusMinor: z.string().regex(/^-?\d+$/, "surplusMinor must be a decimal integer string"),
  availableCashMinor: z.string().regex(/^-?\d+$/, "availableCashMinor must be a decimal integer string").optional(),
  deployedTotalMinor: z.string().regex(/^-?\d+$/, "deployedTotalMinor must be a decimal integer string").optional(),
  operationalFloorMinor: z.string().regex(/^-?\d+$/, "operationalFloorMinor must be a decimal integer string").optional(),
  horizonHours: z.number().int().positive().optional(),
  alpha: z.number().optional(),
  expectedCumulativeFlowMinor: z.string().regex(/^-?\d+$/, "expectedCumulativeFlowMinor must be a decimal integer string").optional(),
  worstCaseResidualShortfallMinor: z.string().regex(/^-?\d+$/, "worstCaseResidualShortfallMinor must be a decimal integer string").optional(),
  backtest: z
    .object({
      mase: z.number(),
      sampleSize: z.number(),
    })
    .optional(),
  allocations: z.array(
    z.object({
      instrumentId: z.string().min(1),
      name: z.string().optional(),
      amountMinor: z.string().regex(/^-?\d+$/, "amountMinor must be a decimal integer string"),
      annualRateBps: z.number().int().nonnegative().optional(),
      settlementLagHours: z.number().int().nonnegative().optional(),
      penaltyBps: z.number().int().nonnegative().optional(),
      capacityMinor: z.string().regex(/^-?\d+$/, "capacityMinor must be a decimal integer string").optional(),
    })
  ),
  status: z.string().min(1),
  expectedNetYieldMinor: z.string().regex(/^-?\d+$/, "expectedNetYieldMinor must be a decimal integer string"),
  explanation: z.string(),
  source: z.enum(["synthetic", "import", "live"]).optional(),
  createdAt: z.unknown(),
  createdBy: z.string().min(1),
});

export const SimulationDocSchema = z.object({
  id: z.string().min(1),
  orgId: z.string().min(1),
  scenario: z.string().min(1),
  seed: z.number(),
  policy: z.union([z.string(), z.record(z.string(), z.unknown())]),
  metrics: z.record(z.string(), z.unknown()),
  createdAt: z.unknown(),
  createdBy: z.string().min(1),
});

export const AuditDocSchema = z.object({
  id: z.string().min(1),
  orgId: z.string().min(1),
  actorUid: z.string().min(1),
  action: z.string().min(1),
  refPath: z.string().min(1),
  beforeHash: z.string().optional(),
  afterHash: z.string().optional(),
  ts: z.unknown(),
  createdAt: z.unknown(),
});
