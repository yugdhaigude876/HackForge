/**
 * Reserve Juggler - Zod API Validation Schemas
 *
 * Provides strict runtime validation for incoming API requests across:
 * - Synthetic transaction generation
 * - Rolling-origin net flow forecasting
 * - Basel III liquidity decision orchestration
 */

import { z } from "zod";
import { Money } from "@/engine/money";
import { Instrument } from "@/engine/models";
import { AllocatedHolding } from "@/engine/decision";

/**
 * Flexible Money input representation supporting numbers, formatted decimal strings,
 * or explicit minor unit JSON objects.
 */
export const MoneyInputSchema = z.union([
  z.number(),
  z.string(),
  z.object({
    amountMinor: z.union([z.number(), z.string()]),
    currency: z.string().optional(),
  }),
]);

export type MoneyInput = z.infer<typeof MoneyInputSchema>;

/**
 * Coerces a validated MoneyInput into a strict immutable Money object.
 */
export function parseMoneyInput(input: MoneyInput, defaultCurrency = "USD"): Money {
  if (input instanceof Money) {
    return input;
  }

  if (typeof input === "object" && input !== null && "amountMinor" in input) {
    return Money.fromMinor(input.amountMinor, input.currency ?? defaultCurrency);
  }

  if (typeof input === "number") {
    // Treat whole numbers as minor units if they look like raw minor integers,
    // or as decimal dollars. To be deterministic and safe:
    // If integer, check if decimal was intended. If fractional (has decimal), parse from decimal.
    if (Number.isInteger(input)) {
      return Money.fromMinor(input, defaultCurrency);
    }
    return Money.fromDecimal(input.toFixed(2), defaultCurrency);
  }

  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed.includes(".")) {
      return Money.fromDecimal(trimmed, defaultCurrency);
    }
    // Integer string
    return Money.fromMinor(trimmed, defaultCurrency);
  }

  throw new Error(`Unsupported money input format: ${JSON.stringify(input)}`);
}

/**
 * Coerces date strings or Date objects safely.
 */
export const DateInputSchema = z.union([
  z.date(),
  z.string().datetime({ offset: true }),
  z.string().regex(/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?Z?)?$/),
]);

export function parseDateInput(input: z.infer<typeof DateInputSchema>): Date {
  const d = new Date(input);
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid timestamp: ${input}`);
  }
  return d;
}

// ---------------------------------------------------------------------------
// 1. Transaction Generation Request Schema
// ---------------------------------------------------------------------------

export const GenerateTransactionsRequestSchema = z.object({
  /** Seed string for deterministic reproduction */
  seed: z.string().min(1, "Seed must be at least 1 character"),

  /** Inclusive start of the time window */
  startDate: DateInputSchema,

  /** Inclusive end of the time window */
  endDate: DateInputSchema,

  /**
   * Target gross hourly bank volume.
   * Defaults to $20,000,000.00 USD (2,000,000,000 cents).
   */
  baseVolumePerHour: MoneyInputSchema.optional(),

  /** Expected transaction count per hour (integer or [min, max] range) */
  transactionsPerHour: z
    .union([
      z.number().int().positive(),
      z.tuple([z.number().int().positive(), z.number().int().positive()]),
    ])
    .optional(),

  /** Currency code (default: "USD") */
  currency: z.string().min(3).max(3).optional().default("USD"),
});

export type GenerateTransactionsRequest = z.infer<
  typeof GenerateTransactionsRequestSchema
>;

// ---------------------------------------------------------------------------
// 2. Forecast Request Schema
// ---------------------------------------------------------------------------

export const ForecastMethodEnum = z.enum([
  "naive",
  "seasonal_naive",
  "hour_of_week",
]);

export const ForecastRequestSchema = z.object({
  /** Forecasting algorithm to evaluate */
  method: ForecastMethodEnum.optional().default("hour_of_week"),

  /** Forecast steps ahead (horizon H in hours, 1..720) */
  horizonHours: z.number().int().positive().max(720).optional().default(24),

  /** Lookback context length in hours (default: 168 = 1 week) */
  lookbackHours: z.number().int().positive().optional().default(168),

  /** Rolling window step interval in hours (default: 12) */
  stepHours: z.number().int().positive().optional().default(12),

  /** Synthetic seed if generating simulation data on the fly */
  seed: z.string().optional().default("hackathon-seed-123"),

  /** Simulation start date if generating data */
  startDate: DateInputSchema.optional(),

  /** Simulation end date if generating data */
  endDate: DateInputSchema.optional(),

  /** Simulation base hourly volume */
  baseVolumePerHour: MoneyInputSchema.optional(),

  /** Seasonal lag in hours for seasonal naive (default: 168) */
  seasonalLag: z.number().int().positive().optional().default(168),

  /** EWMA smoothing parameter lambda in (0, 1] for hour_of_week (default: 0.3) */
  lambda: z.number().min(0.01).max(1.0).optional().default(0.3),

  /** Hour-of-week profile calculation mode */
  mode: z.enum(["ewma", "mean"]).optional().default("ewma"),

  /** Currency code (default: "USD") */
  currency: z.string().min(3).max(3).optional().default("USD"),
});

export type ForecastRequest = z.infer<typeof ForecastRequestSchema>;

// ---------------------------------------------------------------------------
// 3. Instrument and Decision Request Schemas
// ---------------------------------------------------------------------------

export const InstrumentInputSchema = z.object({
  id: z.string().min(1, "Instrument id required"),
  name: z.string().min(1, "Instrument name required"),
  apy: z.number().nonnegative("APY must be non-negative"),
  capacity: MoneyInputSchema,
  withdrawalPenalty: z.number().nonnegative("Penalty must be non-negative"),
  settlementLagHours: z.number().int().nonnegative().optional().default(0),
  minHoldHours: z.number().int().nonnegative().optional().default(0),
  earlyWithdrawalRisk: z.number().min(0).max(1).optional().default(0),
});

export const AllocatedHoldingInputSchema = z.object({
  instrument: InstrumentInputSchema,
  currentAmount: MoneyInputSchema,
});

export const DecisionRequestSchema = z.object({
  /** Available unencumbered cash balance C */
  availableCash: MoneyInputSchema,

  /** Operational floor buffer F */
  operationalFloor: MoneyInputSchema,

  /** Optional stress add-on Z */
  stressAddOn: MoneyInputSchema.optional(),

  /** Expected cumulative net flow over horizon H (if precomputed) */
  expectedCumulativeFlow: MoneyInputSchema.optional(),

  /** Worst-case empirical residual shortfall q_H(alpha) (if precomputed) */
  worstCaseResidualShortfall: MoneyInputSchema.optional(),

  /** Historical backtest sample size N */
  sampleSize: z.number().int().nonnegative().optional(),

  /** Backtest MASE error score */
  mase: z.number().nonnegative().optional(),

  /** Active deployed holdings in yield instruments */
  holdings: z.array(AllocatedHoldingInputSchema).optional().default([]),

  /** Available instruments for surplus deployment */
  instruments: z.array(InstrumentInputSchema).optional().default([]),

  /** Planning horizon H in hours */
  horizonHours: z.number().int().positive().optional().default(24),

  /** Risk tolerance alpha (default: 0.01) */
  alpha: z.number().min(0.001).max(0.5).optional().default(0.01),

  /** Synthetic seed if full simulation pipeline is requested */
  seed: z.string().optional(),

  /** Currency code */
  currency: z.string().min(3).max(3).optional().default("USD"),

  /** Optional forecast ID linkage */
  forecastId: z.string().optional(),

  /** Optional override thresholds */
  thresholds: z
    .object({
      minSampleSize: z.number().int().positive().optional(),
      maxMase: z.number().positive().optional(),
      conservativeBufferMultiplier: z.number().positive().optional(),
    })
    .optional(),
});

export type DecisionRequest = z.infer<typeof DecisionRequestSchema>;

/**
 * Coerces InstrumentInputSchema into a domain Instrument with typed Money capacity.
 */
export function parseInstrumentInput(
  input: z.infer<typeof InstrumentInputSchema>,
  currency = "USD"
): Instrument {
  return {
    ...input,
    capacity: parseMoneyInput(input.capacity, currency),
  };
}

/**
 * Coerces AllocatedHoldingInputSchema into a domain AllocatedHolding.
 */
export function parseAllocatedHoldingInput(
  input: z.infer<typeof AllocatedHoldingInputSchema>,
  currency = "USD"
): AllocatedHolding {
  return {
    instrument: parseInstrumentInput(input.instrument, currency),
    currentAmount: parseMoneyInput(input.currentAmount, currency),
  };
}

// ---------------------------------------------------------------------------
// 4. Stress Scenario Simulation Schemas (Phase 18)
// ---------------------------------------------------------------------------

export const CorrelatedRunSchema = z.object({
  /** Initial extra outflow shock percentage at t=0 of the run (0–100%) */
  intensityPct: z.number().min(0).max(100),
  /** Hourly exponential persistence / decay factor lambda in [0, 1] (e.g. 0.85) */
  decay: z.number().min(0).max(1),
});

export const ScenarioSchema = z.object({
  /** Outflow multiplier shock in percent (0–50%) */
  outflowShockPct: z.number().min(0).max(50).default(0),

  /** Delay in incoming merchant settlement arrivals in hours (0–72h) */
  settlementDelayHours: z.number().int().min(0).max(72).default(0),

  /** Offset from horizon start when the outflow shock begins (hours) */
  shockStartHour: z.number().int().min(0).max(168).optional().default(0),

  /** Duration of the outflow shock window (hours) */
  shockDurationHours: z.number().int().positive().max(168).optional().default(24),

  /** Optional correlated run parameterizing persistent bank-run outflow tails */
  correlatedRun: CorrelatedRunSchema.optional(),

  /** Shift in instrument APYs in basis points (can be negative or positive) */
  yieldRateShockBps: z.number().int().min(-2000).max(2000).optional().default(0),

  /** Array of instrument IDs that cannot be redeemed due to market freeze or outage */
  instrumentOutageIds: z.array(z.string().min(1)).optional().default([]),

  /** Reserve confidence level used by policies (0.50–0.999, default 0.99) */
  confidence: z.number().min(0.5).max(0.999).default(0.99),
});

export type Scenario = z.infer<typeof ScenarioSchema>;
export type ScenarioInput = z.input<typeof ScenarioSchema>;

export const PolicyTypeEnum = z.enum([
  "reserve-juggler",
  "hold-all-cash",
  "fixed-buffer",
]);

export type PolicyType = z.infer<typeof PolicyTypeEnum>;

export const SimulationRequestSchema = z.object({
  /** Stress test scenario configuration */
  scenario: ScenarioSchema,

  /** Liquidity management policy under test */
  policy: PolicyTypeEnum.optional().default("reserve-juggler"),

  /** Optional parameters for specific policies (e.g. fixed buffer percentage) */
  policyParams: z
    .object({
      /** For fixed-buffer policy: fraction of cash retained as liquid reserve [0, 1] */
      bufferPct: z.number().min(0).max(1).optional(),
    })
    .optional(),

  /** Simulation horizon in hours (1..168, default: 24) */
  horizonHours: z.number().int().positive().max(168).optional().default(24),

  /** Number of Monte Carlo bootstrap trials (1..2000, default: 500) */
  trials: z.number().int().positive().max(2000).optional().default(500),

  /** PRNG seed for exact reproducibility */
  seed: z.string().optional(),

  /** Emergency borrowing rate in basis points annualized (default: 1000 = 10%) */
  emergencyBorrowingRateBps: z.number().int().nonnegative().optional().default(1000),

  /** Explicit starting cash minor units string when running synthetic baseline without stored decision */
  startingCash: z.string().regex(/^\d+$/).optional(),

  /** Explicit operational floor minor units string when running synthetic baseline without stored decision */
  operationalFloor: z.string().regex(/^\d+$/).optional(),

  /** Source tag ('synthetic' allows startingCash and operationalFloor fallback without stored decision) */
  source: z.enum(["synthetic", "import", "live"]).optional(),
});

export type SimulationRequest = z.infer<typeof SimulationRequestSchema>;

export const PolicyComparisonRequestSchema = z.object({
  /** Stress test scenario configuration */
  scenario: ScenarioSchema,

  /** Policies to compare side-by-side (1 to 3 distinct policies) */
  policies: z
    .array(PolicyTypeEnum)
    .min(1)
    .max(3)
    .optional()
    .default(["reserve-juggler", "hold-all-cash", "fixed-buffer"]),

  /** Optional parameters for specific policies */
  policyParams: z
    .object({
      /** For fixed-buffer policy: fraction of cash retained as liquid reserve [0, 1] */
      bufferPct: z.number().min(0).max(1).optional(),
    })
    .optional(),

  /** Simulation horizon in hours (1..168, default: 24) */
  horizonHours: z.number().int().positive().max(168).optional().default(24),

  /** Number of Monte Carlo bootstrap trials per policy (1..1000, default: 500) */
  trials: z.number().int().positive().max(1000).optional().default(500),

  /** PRNG seed for exact reproducibility across all compared policies */
  seed: z.string().optional(),

  /** Emergency borrowing rate in basis points annualized (default: 1000 = 10%) */
  emergencyBorrowingRateBps: z.number().int().nonnegative().optional().default(1000),

  /** Explicit starting cash minor units string when running synthetic baseline without stored decision */
  startingCash: z.string().regex(/^\d+$/).optional(),

  /** Explicit operational floor minor units string when running synthetic baseline without stored decision */
  operationalFloor: z.string().regex(/^\d+$/).optional(),

  /** Source tag ('synthetic' allows startingCash and operationalFloor fallback without stored decision) */
  source: z.enum(["synthetic", "import", "live"]).optional(),
});

export type PolicyComparisonRequest = z.infer<typeof PolicyComparisonRequestSchema>;


