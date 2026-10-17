/**
 * Reserve Juggler - Deterministic Decision Explanation Engine
 *
 * Conforms to FINANCIAL_MODEL.md and Phase 20 explainability requirements:
 * Pure TypeScript, deterministic, strictly zero LLM dependencies.
 *
 * Reconstructs step-by-step mathematical reasoning from stored fields:
 * 1. Expected cumulative net flow: mu_H
 * 2. Worst-case residual quantile at confidence (1 - alpha): q_H(alpha)
 * 3. Fixed operational floor buffer: F
 * 4. Stress scenario add-on: Z
 * 5. Required liquid reserve: R = max(0, -(mu_H + q_H)) + F + Z
 * 6. Available cash C, coverage ratio C / R, and deployable surplus (C - R)
 * 7. Decision status and exact triggering rule (UNDER_RESERVED, LOW_CONFIDENCE, HEALTHY)
 * 8. Each instrument's net unit return v_i = r_i * (H / 8760) - pi_i * p_i and funding reason
 *
 * Rules:
 * - If a field is not recorded in stored data, it is explicitly reported as "not recorded", never fabricated.
 * - Handles monetary values strictly in minor units (cents) via BigInt to avoid IEEE-754 precision loss > 2^53.
 */

import { Money } from "@/engine/money";

const HOURS_IN_YEAR = 8760;

export interface ExplanationStep {
  step: number;
  label: string;
  symbol: string;
  recorded: boolean;
  valueMinor: string | null;
  valueFormatted: string;
  description: string;
}

export interface InstrumentExplanation {
  instrumentId: string;
  name: string;
  annualRateBps: number | null;
  annualRateFormatted: string;
  settlementLagHours: number | null;
  penaltyBps: number | null;
  penaltyFormatted: string;
  piEstimate: number | null;
  piFormatted: string;
  netUnitValue: number | null;
  netUnitValueFormatted: string;
  allocatedMinor: string;
  allocatedFormatted: string;
  capacityMinor: string | null;
  capacityFormatted: string;
  utilizationRate: number | null;
  utilizationFormatted: string;
  funded: boolean;
  fundingReason: string;
}

export interface StructuredDecisionExplanation {
  decisionId: string;
  status: string;
  statusTriggerRule: string;
  summary: string;
  steps: ExplanationStep[];
  instruments: InstrumentExplanation[];
  recordedFields: {
    hasAvailableCash: boolean;
    hasOperationalFloor: boolean;
    hasExpectedCumulativeFlow: boolean;
    hasWorstCaseResidualShortfall: boolean;
    hasBacktest: boolean;
    hasStressAddOn: boolean;
  };
}

export interface StoredAllocationInput {
  instrumentId: string;
  name?: string;
  amountMinor: string;
  annualRateBps?: number;
  settlementLagHours?: number;
  penaltyBps?: number;
  capacityMinor?: string;
  earlyWithdrawalRisk?: number;
  p_i?: number;
}

export interface StoredDecisionInput {
  id: string;
  status: string;
  confidence?: number;
  alpha?: number;
  horizonHours?: number;
  reserveMinor: string;
  surplusMinor: string;
  availableCashMinor?: string;
  operationalFloorMinor?: string;
  stressAddOnMinor?: string;
  expectedCumulativeFlowMinor?: string;
  worstCaseResidualShortfallMinor?: string;
  backtest?: {
    mase?: number;
    sampleSize?: number;
  };
  allocations?: StoredAllocationInput[];
  expectedNetYieldMinor?: string;
  source?: "synthetic" | "import" | "live";
}

export interface InstrumentDefinitionInput {
  id: string;
  name: string;
  annualRateBps?: number;
  apy?: number;
  settlementLagHours?: number;
  penaltyBps?: number;
  withdrawalPenalty?: number;
  capacityMinor?: string;
  earlyWithdrawalRisk?: number;
}

/**
 * Formats a BigInt minor unit string into formatted currency safely.
 */
function formatMinorString(minorStr: string | undefined | null, currency = "USD"): string {
  if (minorStr === undefined || minorStr === null || minorStr === "") {
    return "not recorded";
  }
  try {
    const money = Money.fromMinor(BigInt(minorStr), currency);
    return money.format();
  } catch {
    return "not recorded";
  }
}

/**
 * Normalizes an APY or penalty rate to decimal fraction.
 */
function normalizeBps(bpsOrDecimal: number | undefined): number | null {
  if (bpsOrDecimal === undefined || !Number.isFinite(bpsOrDecimal)) return null;
  return bpsOrDecimal > 1 ? bpsOrDecimal / 10000 : bpsOrDecimal;
}

/**
 * Pure, deterministic decision explanation generator.
 */
export function explainDecision(
  decision: StoredDecisionInput,
  knownInstruments: readonly InstrumentDefinitionInput[] = []
): StructuredDecisionExplanation {
  const steps: ExplanationStep[] = [];
  const currency = "USD";
  const horizonHours = decision.horizonHours ?? 24;

  const hasCash = decision.availableCashMinor !== undefined && decision.availableCashMinor !== "";
  const hasFloor = decision.operationalFloorMinor !== undefined && decision.operationalFloorMinor !== "";
  const hasFlow = decision.expectedCumulativeFlowMinor !== undefined && decision.expectedCumulativeFlowMinor !== "";
  const hasShortfall = decision.worstCaseResidualShortfallMinor !== undefined && decision.worstCaseResidualShortfallMinor !== "";
  const hasBacktest = decision.backtest !== undefined;
  const hasStress = decision.stressAddOnMinor !== undefined && decision.stressAddOnMinor !== "";

  // Step 1: Expected cumulative flow mu_H
  steps.push({
    step: 1,
    label: "Expected Cumulative Flow",
    symbol: "μ",
    recorded: hasFlow,
    valueMinor: hasFlow ? decision.expectedCumulativeFlowMinor! : null,
    valueFormatted: formatMinorString(decision.expectedCumulativeFlowMinor, currency),
    description: hasFlow
      ? `Forecasted cumulative net flow over the ${horizonHours}h planning horizon.`
      : "Expected cumulative net flow (μ) was not recorded in stored decision.",
  });

  // Step 2: Residual Quantile q_H(alpha)
  const confPercent = decision.confidence ? (decision.confidence * 100).toFixed(0) : "95";
  steps.push({
    step: 2,
    label: `Residual Quantile (${confPercent}% Confidence)`,
    symbol: "q",
    recorded: hasShortfall,
    valueMinor: hasShortfall ? decision.worstCaseResidualShortfallMinor! : null,
    valueFormatted: formatMinorString(decision.worstCaseResidualShortfallMinor, currency),
    description: hasShortfall
      ? `Worst-case backtested residual shortfall at ${confPercent}% quantile (alpha = ${decision.alpha ?? 0.05}).`
      : "Residual quantile shortfall (q) was not recorded in stored decision.",
  });

  // Step 3: Operational Floor Buffer F
  steps.push({
    step: 3,
    label: "Operational Floor",
    symbol: "F",
    recorded: hasFloor,
    valueMinor: hasFloor ? decision.operationalFloorMinor! : null,
    valueFormatted: formatMinorString(decision.operationalFloorMinor, currency),
    description: hasFloor
      ? "Fixed Tier 1 intraday liquidity floor buffer for operational clearing."
      : "Operational floor buffer (F) was not recorded in stored decision.",
  });

  // Step 4: Stress Scenario Add-On Z
  steps.push({
    step: 4,
    label: "Stress Scenario Add-On",
    symbol: "Z",
    recorded: hasStress,
    valueMinor: hasStress ? decision.stressAddOnMinor! : "0",
    valueFormatted: hasStress ? formatMinorString(decision.stressAddOnMinor, currency) : "$0.00",
    description: hasStress
      ? "Tier 2/3 deterministic stress scenario buffer add-on."
      : "No stress scenario add-on recorded (evaluated at $0.00).",
  });

  // Step 5: Required Liquid Reserve R
  const reserveFormatted = formatMinorString(decision.reserveMinor, currency);
  let reserveFormulaDescription = `Resulting required liquid reserve R = max(0, -(μ + q)) + F + Z.`;
  if (hasFlow && hasShortfall && hasFloor) {
    try {
      const mu = BigInt(decision.expectedCumulativeFlowMinor!);
      const q = BigInt(decision.worstCaseResidualShortfallMinor!);
      const F = BigInt(decision.operationalFloorMinor!);
      const Z = hasStress ? BigInt(decision.stressAddOnMinor!) : 0n;
      const netDrift = mu + q;
      const driftDeficit = netDrift < 0n ? -netDrift : 0n;
      const totalR = driftDeficit + F + Z;
      reserveFormulaDescription = `Formula: max(0, -(${Money.fromMinor(mu).format()} + ${Money.fromMinor(q).format()})) + ${Money.fromMinor(F).format()} + ${Money.fromMinor(Z).format()} = ${Money.fromMinor(totalR).format()}.`;
    } catch {
      // Keep general description
    }
  }

  steps.push({
    step: 5,
    label: "Required Liquid Reserve",
    symbol: "R",
    recorded: true,
    valueMinor: decision.reserveMinor,
    valueFormatted: reserveFormatted,
    description: reserveFormulaDescription,
  });

  // Step 6: Available Cash C
  steps.push({
    step: 6,
    label: "Available Cash",
    symbol: "C",
    recorded: hasCash,
    valueMinor: hasCash ? decision.availableCashMinor! : null,
    valueFormatted: formatMinorString(decision.availableCashMinor, currency),
    description: hasCash
      ? "Unencumbered liquid cash balance currently available for reserve coverage and deployment."
      : "Available cash balance (C) was not recorded in stored decision.",
  });

  // Step 7: Deployable Surplus / Deficit
  const surplusFormatted = formatMinorString(decision.surplusMinor, currency);
  steps.push({
    step: 7,
    label: "Deployable Surplus",
    symbol: "C - R",
    recorded: true,
    valueMinor: decision.surplusMinor,
    valueFormatted: surplusFormatted,
    description:
      decision.status === "HEALTHY"
        ? `Surplus cash above required reserve available for yield optimization: ${surplusFormatted}.`
        : `Surplus is $0.00 because liquidity position is ${decision.status}.`,
  });

  // Decision State & Trigger Rule
  let statusTriggerRule = "";
  if (decision.status === "UNDER_RESERVED") {
    if (hasCash) {
      statusTriggerRule = `Available cash C (${formatMinorString(decision.availableCashMinor)}) is strictly less than required reserve R (${reserveFormatted}). Rule: C < R.`;
    } else {
      statusTriggerRule = "Available cash C is insufficient to cover required reserve R. Rule: C < R.";
    }
  } else if (decision.status === "LOW_CONFIDENCE") {
    const mase = decision.backtest?.mase;
    const sampleSize = decision.backtest?.sampleSize;
    const reasons: string[] = [];
    if (sampleSize !== undefined && sampleSize < 30) {
      reasons.push(`backtest window sample size N (${sampleSize}) < 30`);
    }
    if (mase !== undefined && mase > 1.2) {
      reasons.push(`model MASE (${mase.toFixed(2)}) > 1.20 threshold`);
    }
    if (reasons.length > 0) {
      statusTriggerRule = `Forecasting reliability checks failed: ${reasons.join(" and ")}. Rule: N < 30 or MASE > 1.20.`;
    } else {
      statusTriggerRule = "Forecasting confidence threshold was not met. Deployments halted.";
    }
  } else if (decision.status === "HEALTHY") {
    if (hasCash) {
      statusTriggerRule = `Available cash C (${formatMinorString(decision.availableCashMinor)}) >= required reserve R (${reserveFormatted}) and backtest confidence thresholds satisfied.`;
    } else {
      statusTriggerRule = `Available cash meets required reserve (${reserveFormatted}) and confidence thresholds satisfied.`;
    }
  } else {
    statusTriggerRule = `Decision recorded with state: ${decision.status}.`;
  }

  // Instrument Explanations
  const instrumentMap = new Map<string, InstrumentExplanation>();

  // Initialize known instruments if passed
  for (const inst of knownInstruments) {
    const rawRate = inst.annualRateBps ?? (inst.apy !== undefined ? (inst.apy > 1 ? inst.apy : inst.apy * 10000) : null);
    const rawPenalty = inst.penaltyBps ?? (inst.withdrawalPenalty !== undefined ? (inst.withdrawalPenalty > 1 ? inst.withdrawalPenalty : inst.withdrawalPenalty * 10000) : null);
    const r_i = normalizeBps(rawRate ?? undefined);
    const pi_penalty = normalizeBps(rawPenalty ?? undefined);
    const p_i = inst.earlyWithdrawalRisk ?? 0.0;

    let v_i: number | null = null;
    if (r_i !== null) {
      const grossRate = r_i * (horizonHours / HOURS_IN_YEAR);
      const penaltyCost = (pi_penalty ?? 0) * p_i;
      v_i = grossRate - penaltyCost;
    }

    instrumentMap.set(inst.id, {
      instrumentId: inst.id,
      name: inst.name,
      annualRateBps: rawRate,
      annualRateFormatted: rawRate !== null ? `${(rawRate / 100).toFixed(2)}% APY` : "not recorded",
      settlementLagHours: inst.settlementLagHours ?? null,
      penaltyBps: rawPenalty,
      penaltyFormatted: rawPenalty !== null ? `${(rawPenalty / 100).toFixed(2)}%` : "not recorded",
      piEstimate: p_i,
      piFormatted: `${(p_i * 100).toFixed(1)}%`,
      netUnitValue: v_i,
      netUnitValueFormatted: v_i !== null ? `${(v_i * 10000).toFixed(2)} bps` : "not recorded",
      allocatedMinor: "0",
      allocatedFormatted: "$0.00",
      capacityMinor: inst.capacityMinor ?? null,
      capacityFormatted: formatMinorString(inst.capacityMinor),
      utilizationRate: 0,
      utilizationFormatted: "0.0%",
      funded: false,
      fundingReason: "",
    });
  }

  // Overlay allocations stored in decision
  const storedAllocations = decision.allocations ?? [];
  for (const alloc of storedAllocations) {
    const existing = instrumentMap.get(alloc.instrumentId);
    const rawRate = alloc.annualRateBps ?? existing?.annualRateBps ?? null;
    const rawPenalty = alloc.penaltyBps ?? existing?.penaltyBps ?? null;
    const r_i = normalizeBps(rawRate ?? undefined);
    const pi_penalty = normalizeBps(rawPenalty ?? undefined);
    const p_i = alloc.earlyWithdrawalRisk ?? alloc.p_i ?? existing?.piEstimate ?? 0.0;

    let v_i: number | null = null;
    if (r_i !== null) {
      const grossRate = r_i * (horizonHours / HOURS_IN_YEAR);
      const penaltyCost = (pi_penalty ?? 0) * p_i;
      v_i = grossRate - penaltyCost;
    }

    const allocBig = BigInt(alloc.amountMinor || "0");
    const capMinor = alloc.capacityMinor ?? existing?.capacityMinor ?? null;
    let utilization: number | null = null;
    if (capMinor) {
      try {
        const capBig = BigInt(capMinor);
        if (capBig > 0n) {
          utilization = Number((allocBig * 10000n) / capBig) / 100;
        }
      } catch {
        // Leave null
      }
    }

    instrumentMap.set(alloc.instrumentId, {
      instrumentId: alloc.instrumentId,
      name: alloc.name ?? existing?.name ?? alloc.instrumentId,
      annualRateBps: rawRate,
      annualRateFormatted: rawRate !== null ? `${(rawRate / 100).toFixed(2)}% APY` : "not recorded",
      settlementLagHours: alloc.settlementLagHours ?? existing?.settlementLagHours ?? null,
      penaltyBps: rawPenalty,
      penaltyFormatted: rawPenalty !== null ? `${(rawPenalty / 100).toFixed(2)}%` : "not recorded",
      piEstimate: p_i,
      piFormatted: `${(p_i * 100).toFixed(1)}%`,
      netUnitValue: v_i ?? existing?.netUnitValue ?? null,
      netUnitValueFormatted:
        v_i !== null
          ? `${(v_i * 10000).toFixed(2)} bps`
          : existing?.netUnitValueFormatted ?? "not recorded",
      allocatedMinor: alloc.amountMinor,
      allocatedFormatted: formatMinorString(alloc.amountMinor),
      capacityMinor: capMinor,
      capacityFormatted: formatMinorString(capMinor),
      utilizationRate: utilization,
      utilizationFormatted: utilization !== null ? `${utilization.toFixed(1)}%` : "not recorded",
      funded: allocBig > 0n,
      fundingReason: "",
    });
  }

  // Determine funding reasons
  const instruments = Array.from(instrumentMap.values());
  for (const inst of instruments) {
    const isFunded = BigInt(inst.allocatedMinor || "0") > 0n;
    if (decision.status === "UNDER_RESERVED") {
      inst.fundingReason = "Unfunded: Bank is UNDER_RESERVED. All surplus deployment is suspended to preserve liquidity.";
    } else if (decision.status === "LOW_CONFIDENCE") {
      inst.fundingReason = "Unfunded: Forecasting confidence is LOW. All surplus cash is held in liquid buffer.";
    } else if (isFunded) {
      if (inst.utilizationRate !== null && inst.utilizationRate >= 99.9) {
        inst.fundingReason = "Funded: Allocated up to maximum institutional capacity limit.";
      } else {
        inst.fundingReason = "Funded: High positive net unit value v_i allocated from available deployable surplus.";
      }
    } else {
      if (inst.netUnitValue !== null && inst.netUnitValue <= 0) {
        inst.fundingReason = "Unfunded: Non-positive net unit value (v_i <= 0; early withdrawal penalty risk outweighs expected horizon yield).";
      } else {
        inst.fundingReason = "Unfunded: Deployable surplus was exhausted by higher net-value instruments before reaching this tier.";
      }
    }
  }

  // Human-readable summary
  let summary = "";
  if (decision.status === "HEALTHY") {
    summary = `Decision ${decision.id}: Bank is HEALTHY. Required liquid reserve is ${reserveFormatted} against available cash ${hasCash ? formatMinorString(decision.availableCashMinor) : "(unrecorded)"}. Deployable surplus of ${surplusFormatted} was optimized across ${instruments.filter((i) => i.funded).length} instrument(s).`;
  } else if (decision.status === "UNDER_RESERVED") {
    summary = `Decision ${decision.id}: Bank is UNDER_RESERVED. Required reserve is ${reserveFormatted}. Liquidity deficit triggered immediate halt of new deployments and prioritized liquidation.`;
  } else {
    summary = `Decision ${decision.id}: Bank is in LOW_CONFIDENCE state (${statusTriggerRule}). Liquid reserve is ${reserveFormatted}. Deployment halted to protect against forecast uncertainty.`;
  }

  return {
    decisionId: decision.id,
    status: decision.status,
    statusTriggerRule,
    summary,
    steps,
    instruments,
    recordedFields: {
      hasAvailableCash: hasCash,
      hasOperationalFloor: hasFloor,
      hasExpectedCumulativeFlow: hasFlow,
      hasWorstCaseResidualShortfall: hasShortfall,
      hasBacktest,
      hasStressAddOn: hasStress,
    },
  };
}
