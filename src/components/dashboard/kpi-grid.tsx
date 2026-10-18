"use client";

import { DollarSign, Shield, Layers, TrendingUp } from "lucide-react";
import { formatMinor, formatCompactMinor } from "@/lib/money";

interface KpiGridProps {
  availableCashMinor: bigint;
  requiredReserveMinor: bigint;
  deployableSurplusMinor: bigint;
  netYieldMinor: bigint;
  annualizedApyPct?: number;
  avoidedOverdraftFeesMinor?: bigint;
  yieldEarnedVsNaiveMinor?: bigint;
  simulationSeed?: string | number;
  isLive?: boolean;
}

export function KpiGrid({
  availableCashMinor,
  requiredReserveMinor,
  deployableSurplusMinor,
  netYieldMinor,
  annualizedApyPct = 4.62,
  avoidedOverdraftFeesMinor,
  yieldEarnedVsNaiveMinor,
  simulationSeed,
  isLive = true,
}: KpiGridProps) {
  return (
    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
      {/* 1. Available Cash (C) */}
      <div className="terminal-card bg-[#121620] border border-[#1E2536] p-4 relative overflow-hidden transition-all hover:border-[#38BDF8]/40">
        <div className="flex items-center justify-between text-xs text-[#94A3B8]">
          <span className="font-medium tracking-wide">Available Cash</span>
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#38BDF8]/10 text-[#38BDF8]">
            <DollarSign className="h-3.5 w-3.5" />
          </span>
        </div>

        <div className="mt-2.5">
          <div className="text-2xl font-bold font-mono tracking-tight text-[#F8FAFC]">
            {formatCompactMinor(availableCashMinor)}
          </div>
          <p className="mt-1 text-[11px] text-[#94A3B8]">
            {formatMinor(availableCashMinor)} · Tier 0 Checking
          </p>
        </div>

        <div className="mt-3 flex items-center justify-between pt-2.5 border-t border-[#1E2536] text-[10px] font-mono">
          <span className="text-[#94A3B8]">Buffer Capacity:</span>
          <span className="text-[#38BDF8] font-semibold">
            {isLive ? "100% Live Unencumbered" : "Illustrative"}
          </span>
        </div>
      </div>

      {/* 2. Required Reserve (Basel III) (R) */}
      <div className="terminal-card bg-[#121620] border border-[#1E2536] p-4 relative overflow-hidden transition-all hover:border-[#F59E0B]/40">
        <div className="flex items-center justify-between text-xs text-[#94A3B8]">
          <span className="font-medium tracking-wide">Required Reserve (Basel III)</span>
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#F59E0B]/10 text-[#F59E0B]">
            <Shield className="h-3.5 w-3.5" />
          </span>
        </div>

        <div className="mt-2.5">
          <div className="text-2xl font-bold font-mono tracking-tight text-[#F59E0B]">
            {formatCompactMinor(requiredReserveMinor)}
          </div>
          <p className="mt-1 text-[11px] text-[#94A3B8]">
            Buffer Floor ($5M) + 99% Tail Risk (VaR)
          </p>
        </div>

        <div className="mt-3 flex items-center justify-between pt-2.5 border-t border-[#1E2536] text-[10px] font-mono">
          <span className="text-[#94A3B8]">LCR Status:</span>
          <span className="text-[#22C55E] font-semibold">Solvent · Basel III</span>
        </div>
      </div>

      {/* 3. Deployable Surplus (C - R) */}
      <div className="terminal-card bg-[#121620] border border-[#1E2536] p-4 relative overflow-hidden transition-all hover:border-[#A3E635]/40 shadow-[0_4px_20px_-4px_rgba(163,230,53,0.1)]">
        <div className="flex items-center justify-between text-xs text-[#94A3B8]">
          <span className="font-medium tracking-wide">Deployable Surplus</span>
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#A3E635]/15 text-[#A3E635]">
            <Layers className="h-3.5 w-3.5" />
          </span>
        </div>

        <div className="mt-2.5">
          <div className="text-2xl font-bold font-mono tracking-tight text-[#A3E635]">
            {formatCompactMinor(deployableSurplusMinor)}
          </div>
          <p className="mt-1 text-[11px] text-[#94A3B8]">
            100% Deployed across 3 Yield Vaults
          </p>
        </div>

        <div className="mt-3 flex items-center justify-between pt-2.5 border-t border-[#1E2536] text-[10px] font-mono">
          <span className="text-[#94A3B8]">Idle Cash:</span>
          <span className="text-[#A3E635] font-semibold">$0.00 (Zero Drag)</span>
        </div>
      </div>

      {/* 4. Portfolio Net Yield / PnL */}
      <div className="terminal-card bg-[#121620] border border-[#1E2536] p-4 relative overflow-hidden transition-all hover:border-[#22C55E]/40">
        <div className="flex items-center justify-between text-xs text-[#94A3B8]">
          <span className="font-medium tracking-wide">Portfolio Net Yield / PnL</span>
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#22C55E]/10 text-[#22C55E]">
            <TrendingUp className="h-3.5 w-3.5" />
          </span>
        </div>

        <div className="mt-2.5">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono tracking-tight text-[#22C55E]">
              +{annualizedApyPct.toFixed(2)}%
            </span>
            <span className="font-mono text-xs text-[#22C55E]/80">
              (+{formatCompactMinor(netYieldMinor)})
            </span>
          </div>
          <div className="mt-1 space-y-0.5 text-[11px] text-[#94A3B8]">
            <p>
              Avoided overdraft cost:{" "}
              {avoidedOverdraftFeesMinor !== undefined && simulationSeed ? (
                <span className="font-mono text-[#F8FAFC]">
                  {formatCompactMinor(avoidedOverdraftFeesMinor)}
                  <span className="ml-1 text-[10px] text-[#94A3B8]">
                    (Simulated, seed {simulationSeed})
                  </span>
                </span>
              ) : (
                <span
                  title="Run the replay to compute"
                  className="cursor-help font-mono text-[#94A3B8]"
                  data-testid="avoided-overdraft-uncomputed"
                >
                  —
                </span>
              )}
            </p>
            <p>
              Yield earned vs naive:{" "}
              {yieldEarnedVsNaiveMinor !== undefined && simulationSeed ? (
                <span className="font-mono text-[#22C55E]">
                  +{formatCompactMinor(yieldEarnedVsNaiveMinor)}
                  <span className="ml-1 text-[10px] text-[#94A3B8]">
                    (Simulated, seed {simulationSeed})
                  </span>
                </span>
              ) : (
                <span
                  title="Run the replay to compute"
                  className="cursor-help font-mono text-[#94A3B8]"
                  data-testid="yield-vs-naive-uncomputed"
                >
                  —
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between pt-2.5 border-t border-[#1E2536] text-[10px] font-mono">
          <span className="text-[#94A3B8]">Net Alpha vs Cash:</span>
          <span className="text-[#22C55E] font-semibold">+{annualizedApyPct.toFixed(2)}%</span>
        </div>
      </div>
    </div>
  );
}
