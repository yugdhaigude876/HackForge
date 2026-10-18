"use client";

import { TrendingUp, Zap } from "lucide-react";
import { formatCurrency } from "@/lib/money";

export interface AlphaComparisonProps {
  grossYieldEarnedUsd?: number;
  penaltiesIncurredUsd?: number;
  avoidedOverdraftFeesUsd?: number;
  netApyPct?: number;
  className?: string;
}

export function AlphaComparison({
  grossYieldEarnedUsd = 354_620,
  penaltiesIncurredUsd = 12_500,
  avoidedOverdraftFeesUsd = 1_240_000,
  netApyPct = 4.62,
  className = "",
}: AlphaComparisonProps) {
  // Calculated economic net alpha
  const algorithmicNetYieldUsd = grossYieldEarnedUsd - penaltiesIncurredUsd;
  const naiveTotalPnlUsd = -avoidedOverdraftFeesUsd; // Status quo would suffer overdraft penalties
  const jugglerTotalPnlUsd = algorithmicNetYieldUsd; // Juggler earns yield and avoids overdraft
  const totalEconomicAlphaUsd = jugglerTotalPnlUsd - naiveTotalPnlUsd;

  return (
    <div
      className={`rounded-xl border border-[#1E2536] bg-[#121620] p-5 shadow-lg ${className}`}
      data-testid="alpha-comparison-card"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1E2536] pb-3.5">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#A3E635]/15 text-[#A3E635]">
              <Zap className="h-4 w-4" />
            </span>
            <h3 className="text-sm font-semibold tracking-wide text-[#F8FAFC]">
              Demonstrable Economic Alpha: Status Quo vs. Reserve Juggler
            </h3>
            <span className="rounded bg-[#A3E635]/15 px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider text-[#A3E635] border border-[#A3E635]/30">
              +{netApyPct.toFixed(2)}% NET APY
            </span>
          </div>
          <p className="mt-0.5 text-xs text-[#94A3B8]">
            Side-by-side comparison of naive 0% cash holding versus algorithmic Basel III liquidity orchestration
          </p>
        </div>

        <div className="flex items-center gap-2 rounded-lg bg-[#0B0E14] border border-[#1E2536] px-3 py-1 font-mono text-xs">
          <span className="text-[#94A3B8]">Total Alpha Generated:</span>
          <span className="font-bold text-[#A3E635] tabular-nums">
            +{formatCurrency(totalEconomicAlphaUsd)}
          </span>
        </div>
      </div>

      {/* Side-by-side Comparison Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        {/* Left Column: Naive Bank (Status Quo) */}
        <div className="rounded-lg border border-[#EF4444]/20 bg-[#EF4444]/5 p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-[#EF4444]">
                Naive Bank (Status Quo)
              </span>
              <span className="rounded bg-[#EF4444]/20 px-2 py-0.5 font-mono text-[10px] font-semibold text-[#EF4444]">
                0% YIELD · HIGH RISK
              </span>
            </div>
            <p className="text-[11px] text-[#94A3B8] mt-1">
              100% idle cash in 0% checking; no tail-risk forecasting; vulnerable to liquidity runs.
            </p>

            <div className="space-y-2 mt-4 text-xs font-mono">
              <div className="flex justify-between text-[#94A3B8]">
                <span>Idle Cash Yield:</span>
                <span className="text-[#F8FAFC]">$0.00 (0.0% APY)</span>
              </div>
              <div className="flex justify-between text-[#94A3B8]">
                <span>Emergency Overdraft Exposure (12% APR):</span>
                <span className="text-[#EF4444] font-semibold">
                  -{formatCurrency(avoidedOverdraftFeesUsd)}
                </span>
              </div>
              <div className="flex justify-between text-[#94A3B8]">
                <span>Liquidity Run Protection:</span>
                <span className="text-[#EF4444]">Unhedged (Zero VaR Buffer)</span>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-[#EF4444]/20 flex items-center justify-between font-mono text-xs">
            <span className="text-[#94A3B8]">Net Economic Value:</span>
            <span className="text-base font-bold text-[#EF4444] tabular-nums">
              -{formatCurrency(avoidedOverdraftFeesUsd)}
            </span>
          </div>
        </div>

        {/* Right Column: Reserve Juggler (Algorithmic Treasury) */}
        <div className="rounded-lg border border-[#A3E635]/30 bg-[#A3E635]/5 p-4 flex flex-col justify-between relative overflow-hidden">
          <div className="absolute top-0 right-0 h-16 w-16 bg-[#A3E635]/10 rounded-bl-full pointer-events-none" />

          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-[#A3E635]">
                Reserve Juggler (Algorithmic Treasury)
              </span>
              <span className="rounded bg-[#A3E635]/20 px-2 py-0.5 font-mono text-[10px] font-semibold text-[#A3E635] border border-[#A3E635]/30">
                ACTIVE ALPHA
              </span>
            </div>
            <p className="text-[11px] text-[#94A3B8] mt-1">
              Dynamic Basel III reserve floor with automated surplus sweep across 3 asset vaults.
            </p>

            <div className="space-y-2 mt-4 text-xs font-mono">
              <div className="flex justify-between text-[#94A3B8]">
                <span>Gross Yield (Tiers 1–3):</span>
                <span className="text-[#22C55E] font-semibold">
                  +{formatCurrency(grossYieldEarnedUsd)}
                </span>
              </div>
              <div className="flex justify-between text-[#94A3B8]">
                <span>Early Exit & Slippage Deductions:</span>
                <span className="text-[#F59E0B]">
                  -{formatCurrency(penaltiesIncurredUsd)}
                </span>
              </div>
              <div className="flex justify-between text-[#94A3B8]">
                <span>Overdraft Penalties Prevented:</span>
                <span className="text-[#38BDF8] font-semibold">
                  +{formatCurrency(avoidedOverdraftFeesUsd)} (Saved)
                </span>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-[#A3E635]/20 flex items-center justify-between font-mono text-xs">
            <span className="text-[#94A3B8]">Total Juggler Value:</span>
            <span className="text-base font-bold text-[#A3E635] tabular-nums">
              +{formatCurrency(algorithmicNetYieldUsd)}
            </span>
          </div>
        </div>
      </div>

      {/* Summary Footer Pill */}
      <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#0B0E14] border border-[#1E2536] px-3.5 py-2 text-xs">
        <div className="flex items-center gap-2 text-[#94A3B8]">
          <TrendingUp className="h-4 w-4 text-[#A3E635]" />
          <span>
            Net Treasury Advantage: <strong className="text-[#F8FAFC]">+{netApyPct.toFixed(2)}% APY</strong> over status quo while strictly preserving Basel III LCR compliance.
          </span>
        </div>
        <div className="flex items-center gap-1 font-mono text-[11px] text-[#A3E635]">
          <span>Net Outperformance:</span>
          <span className="font-bold">+{formatCurrency(totalEconomicAlphaUsd)}</span>
        </div>
      </div>
    </div>
  );
}
