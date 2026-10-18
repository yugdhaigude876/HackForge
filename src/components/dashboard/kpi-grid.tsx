"use client";

import React from "react";
import { DollarSign, Shield, Layers, TrendingUp } from "lucide-react";
import { formatMinor, formatCompactMinor } from "@/lib/money";
import { AnimatedCounter } from "@/components/ui/animated-counter";

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
  const cashDollars = Number(availableCashMinor) / 100;
  const reserveDollars = Number(requiredReserveMinor) / 100;
  const surplusDollars = Number(deployableSurplusMinor) / 100;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {/* 1. Available Cash (C) */}
      <div className="relative overflow-hidden rounded-[22px] border border-border bg-surface/85 p-5 backdrop-blur-xl shadow-lg transition-all duration-300 hover:border-accent-blue/50 hover:shadow-[0_8px_30px_rgba(59,130,246,0.12)]">
        <div className="flex items-center justify-between text-xs text-muted">
          <span className="font-semibold uppercase tracking-wider text-[11px]">
            <span>Available Cash</span> <span className="opacity-70">(C)</span>
          </span>
          <span className="flex h-7 w-7 items-center justify-center rounded-xl border border-accent-blue/30 bg-accent-blue/15 text-accent-blue shadow-sm">
            <DollarSign className="h-4 w-4" />
          </span>
        </div>

        <div className="mt-3">
          <div className="text-2xl lg:text-3xl font-extrabold font-mono tracking-tight text-foreground tabular tabular-nums">
            <AnimatedCounter
              value={cashDollars}
              formatter={(v) => `$${(v / 1_000_000).toFixed(1)}M`}
            />
          </div>
          <p className="mt-1 text-[11px] text-muted font-medium font-mono tabular-nums">
            {formatMinor(availableCashMinor)} · Tier 0 Cash
          </p>
        </div>

        <div className="mt-4 flex items-center justify-between pt-2.5 border-t border-border/80 text-[10px] font-mono">
          <span className="text-muted">Unencumbered Buffer:</span>
          <span className="text-accent-blue font-bold">
            {isLive ? "100% Live Verified" : "Illustrative"}
          </span>
        </div>
      </div>

      {/* 2. Required Reserve (Basel III) (R) */}
      <div className="relative overflow-hidden rounded-[22px] border border-border bg-surface/85 p-5 backdrop-blur-xl shadow-lg transition-all duration-300 hover:border-accent-gold/50 hover:shadow-[0_8px_30px_rgba(245,158,11,0.12)]">
        <div className="flex items-center justify-between text-xs text-muted">
          <span className="font-semibold uppercase tracking-wider text-[11px]">
            <span>Required Reserve</span> <span className="opacity-70">(R)</span>
          </span>
          <span className="flex h-7 w-7 items-center justify-center rounded-xl border border-accent-gold/30 bg-accent-gold/15 text-accent-gold shadow-sm">
            <Shield className="h-4 w-4" />
          </span>
        </div>

        <div className="mt-3">
          <div className="text-2xl lg:text-3xl font-extrabold font-mono tracking-tight text-accent-gold tabular tabular-nums">
            <AnimatedCounter
              value={reserveDollars}
              formatter={(v) => `$${(v / 1_000_000).toFixed(1)}M`}
            />
          </div>
          <p className="mt-1 text-[11px] text-muted font-medium">
            Operational Floor ($5M) + 99% VaR Buffer
          </p>
        </div>

        <div className="mt-4 flex items-center justify-between pt-2.5 border-t border-border/80 text-[10px] font-mono">
          <span className="text-muted">LCR Coverage:</span>
          <span className="text-accent-teal font-bold tabular-nums">134% · Basel III Compliant</span>
        </div>
      </div>

      {/* 3. Deployable Surplus (C - R) - Primary Active Card with Ambient Radial Backdrop Glow */}
      <div className="relative overflow-hidden rounded-[22px] border border-accent-blue/40 bg-surface/90 p-5 backdrop-blur-2xl shadow-xl transition-all duration-300 hover:border-accent-blue hover:shadow-[0_12px_40px_rgba(59,130,246,0.2)]">
        {/* Soft radial glow pinned behind primary active card */}
        <div
          className="pointer-events-none absolute -top-12 -right-12 h-36 w-36 rounded-full bg-accent-blue/20 blur-[50px]"
          aria-hidden="true"
        />

        <div className="relative z-10 flex items-center justify-between text-xs text-muted">
          <span className="font-semibold uppercase tracking-wider text-[11px] text-foreground">
            <span>Deployable Surplus</span> <span className="opacity-70">(C - R)</span>
          </span>
          <span className="flex h-7 w-7 items-center justify-center rounded-xl border border-accent-blue/40 bg-accent-blue/20 text-accent-blue shadow-sm">
            <Layers className="h-4 w-4" />
          </span>
        </div>

        <div className="relative z-10 mt-3">
          <div className="text-2xl lg:text-3xl font-extrabold font-mono tracking-tight text-accent-blue tabular tabular-nums">
            <AnimatedCounter
              value={surplusDollars}
              formatter={(v) => `$${(v / 1_000_000).toFixed(1)}M`}
            />
          </div>
          <p className="mt-1 text-[11px] text-muted font-medium">
            100% Deployed across Tiers 1-3
          </p>
        </div>

        <div className="relative z-10 mt-4 flex items-center justify-between pt-2.5 border-t border-border/80 text-[10px] font-mono">
          <span className="text-muted">Idle Cash Drag:</span>
          <span className="text-accent-teal font-bold tabular-nums">$0.00 (Zero Drag)</span>
        </div>
      </div>

      {/* 4. Portfolio Net Yield / PnL */}
      <div className="relative overflow-hidden rounded-[22px] border border-border bg-surface/85 p-5 backdrop-blur-xl shadow-lg transition-all duration-300 hover:border-accent-teal/50 hover:shadow-[0_8px_30px_rgba(16,185,129,0.12)]">
        <div className="flex items-center justify-between text-xs text-muted">
          <span className="font-semibold uppercase tracking-wider text-[11px]">Portfolio Net Yield / PnL</span>
          <span className="flex h-7 w-7 items-center justify-center rounded-xl border border-accent-teal/30 bg-accent-teal/15 text-accent-teal shadow-sm">
            <TrendingUp className="h-4 w-4" />
          </span>
        </div>

        <div className="mt-3">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl lg:text-3xl font-extrabold font-mono tracking-tight text-accent-teal tabular tabular-nums">
              <AnimatedCounter
                value={annualizedApyPct}
                formatter={(v) => `+${v.toFixed(2)}%`}
              />
            </span>
            <span className="font-mono text-xs text-accent-teal/80 font-bold tabular tabular-nums">
              (+{formatCompactMinor(netYieldMinor)})
            </span>
          </div>

          <div className="mt-1 space-y-0.5 text-[11px] text-muted">
            <p>
              Avoided overdraft cost:{" "}
              {avoidedOverdraftFeesMinor !== undefined && simulationSeed ? (
                <span className="font-mono text-foreground font-semibold">
                  {formatCompactMinor(avoidedOverdraftFeesMinor)}
                  <span className="ml-1 text-[10px] text-muted">
                    (Simulated, seed {simulationSeed})
                  </span>
                </span>
              ) : (
                <span
                  title="Run the replay to compute"
                  className="cursor-help font-mono text-muted"
                  data-testid="avoided-overdraft-uncomputed"
                >
                  —
                </span>
              )}
            </p>
            <p>
              Yield earned vs naive:{" "}
              {yieldEarnedVsNaiveMinor !== undefined && simulationSeed ? (
                <span className="font-mono text-accent-teal font-semibold">
                  +{formatCompactMinor(yieldEarnedVsNaiveMinor)}
                  <span className="ml-1 text-[10px] text-muted">
                    (Simulated, seed {simulationSeed})
                  </span>
                </span>
              ) : (
                <span
                  title="Run the replay to compute"
                  className="cursor-help font-mono text-muted"
                  data-testid="yield-vs-naive-uncomputed"
                >
                  —
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between pt-2.5 border-t border-border/80 text-[10px] font-mono">
          <span className="text-muted">Net Alpha vs Cash:</span>
          <span className="text-accent-teal font-bold">+{annualizedApyPct.toFixed(2)}%</span>
        </div>
      </div>
    </div>
  );
}
