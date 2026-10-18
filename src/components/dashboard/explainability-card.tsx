"use client";

import { FileText, ShieldCheck, ShieldAlert, AlertTriangle } from "lucide-react";
import { formatMinor } from "@/lib/money";

export interface ExplainabilityCardProps {
  status?: "HEALTHY" | "LOW_CONFIDENCE" | "UNDER_RESERVED";
  availableCashMinor?: bigint;
  requiredReserveMinor?: bigint;
  deployableSurplusMinor?: bigint;
  expectedFlowMinor?: bigint;
  tailShortfallMinor?: bigint;
  operationalFloorMinor?: bigint;
  stressAddOnMinor?: bigint;
  mase?: number | null;
  confidence?: number;
  explanation?: string;
  className?: string;
}

export function ExplainabilityCard({
  status = "HEALTHY",
  availableCashMinor = 50_000_000_00n,
  requiredReserveMinor = 16_500_000_00n,
  deployableSurplusMinor = 33_500_000_00n,
  expectedFlowMinor = 2_000_000_00n,
  tailShortfallMinor = -3_500_000_00n,
  operationalFloorMinor = 5_000_000_00n,
  stressAddOnMinor = 0n,
  mase = 0.85,
  confidence = 0.99,
  explanation,
  className = "",
}: ExplainabilityCardProps) {
  // Generate default natural-language rationale if none provided
  const dynamicRationale =
    explanation ||
    (status === "HEALTHY"
      ? `Treasury status is HEALTHY. Available cash (${formatMinor(availableCashMinor)}) exceeds the statistical Basel III liquidity reserve (${formatMinor(requiredReserveMinor)}). All ${formatMinor(deployableSurplusMinor)} of surplus capital is actively deployed across Tiers 1–3 yield vaults, optimizing Net APY to +4.62% with zero idle cash drag.`
      : status === "UNDER_RESERVED"
      ? `CRITICAL ALERT: Treasury is UNDER_RESERVED. Customer withdrawal surges have reduced available cash (${formatMinor(availableCashMinor)}) below the Basel III safety threshold (${formatMinor(requiredReserveMinor)}). New capital deployment is locked. The automated lowest-penalty liquidation cascade is active across Tier 1 Repo (0.5% early break) and Tier 2 Bonds (2.0% haircut) to prevent 12% emergency overdraft charges.`
      : `CAUTION: LOW CONFIDENCE detected in forecasting model (MASE = ${mase?.toFixed(2) ?? "1.35"} > 1.20). Under Basel III conservative principles, the operational floor buffer has been automatically expanded by 1.5x to protect against tail shortfalls.`);

  return (
    <div
      className={`rounded-xl border border-[#1E2536] bg-[#121620] p-5 shadow-lg ${className}`}
      data-testid="explainability-card"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1E2536] pb-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-[#38BDF8]" />
          <h3 className="text-sm font-semibold tracking-wide text-[#F8FAFC]">
            Executive Liquidity Summary & Policy Explainability
          </h3>
          <span className="rounded bg-[#1E2536] px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider text-[#94A3B8]">
            CHIEF TREASURY OFFICER MEMO
          </span>
        </div>

        {/* State Pill */}
        <div className="flex items-center gap-2">
          {status === "HEALTHY" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#A3E635]/15 border border-[#A3E635]/30 px-3 py-0.5 text-xs font-semibold text-[#A3E635]">
              <ShieldCheck className="h-3.5 w-3.5" />
              SOLVENT & OPTIMIZED
            </span>
          ) : status === "LOW_CONFIDENCE" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F59E0B]/15 border border-[#F59E0B]/30 px-3 py-0.5 text-xs font-semibold text-[#F59E0B]">
              <AlertTriangle className="h-3.5 w-3.5" />
              CONSERVATIVE BUFFER EXPANDED
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#EF4444]/20 border border-[#EF4444]/40 px-3 py-0.5 text-xs font-semibold text-[#EF4444] animate-pulse">
              <ShieldAlert className="h-3.5 w-3.5" />
              DEFICIT LIQUIDATION ACTIVE
            </span>
          )}
        </div>
      </div>

      {/* Natural Language Explanation Box */}
      <div className="mt-3.5 rounded-lg bg-[#0B0E14] border border-[#1E2536] p-3.5">
        <p className="text-xs leading-relaxed text-[#F8FAFC]">
          {dynamicRationale}
        </p>
      </div>

      {/* Quantitative Formula Breakdown Grid */}
      <div className="mt-4 pt-3 border-t border-[#1E2536]/70">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[#94A3B8]">
            Basel III Quantitative Reserve Formula:
          </span>
          <span className="font-mono text-[11px] text-[#A3E635] bg-[#A3E635]/10 px-2 py-0.5 rounded border border-[#A3E635]/20">
            R = max(0, -(μ_H + q_H(α))) + F + Z
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 text-xs font-mono">
          {/* μ_H Expected Net Flow */}
          <div className="rounded bg-[#0B0E14] border border-[#1E2536] p-2">
            <div className="text-[10px] text-[#94A3B8]">μ_H (Expected Flow)</div>
            <div className="font-bold text-[#F8FAFC] mt-0.5 tabular-nums">
              {formatMinor(expectedFlowMinor)}
            </div>
          </div>

          {/* q_H(α) Tail Shortfall */}
          <div className="rounded bg-[#0B0E14] border border-[#1E2536] p-2">
            <div className="text-[10px] text-[#94A3B8]">q_H({Math.round(confidence * 100)}% VaR)</div>
            <div className="font-bold text-[#EF4444] mt-0.5 tabular-nums">
              {formatMinor(tailShortfallMinor)}
            </div>
          </div>

          {/* F Operational Floor */}
          <div className="rounded bg-[#0B0E14] border border-[#1E2536] p-2">
            <div className="text-[10px] text-[#94A3B8]">F (Floor Buffer)</div>
            <div className="font-bold text-[#38BDF8] mt-0.5 tabular-nums">
              {formatMinor(operationalFloorMinor)}
            </div>
          </div>

          {/* Z Stress Add-on */}
          <div className="rounded bg-[#0B0E14] border border-[#1E2536] p-2">
            <div className="text-[10px] text-[#94A3B8]">Z (Stress Add-on)</div>
            <div className="font-bold text-[#F59E0B] mt-0.5 tabular-nums">
              {formatMinor(stressAddOnMinor)}
            </div>
          </div>

          {/* R Total Required Reserve */}
          <div className="rounded bg-[#A3E635]/10 border border-[#A3E635]/30 p-2">
            <div className="text-[10px] text-[#A3E635] font-semibold">R (Total Reserve)</div>
            <div className="font-bold text-[#A3E635] mt-0.5 tabular-nums">
              {formatMinor(requiredReserveMinor)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
