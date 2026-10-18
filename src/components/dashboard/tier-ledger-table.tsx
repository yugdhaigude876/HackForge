"use client";

import React, { useMemo } from "react";
import { formatCurrency, formatCompactMinor, formatMinor } from "@/lib/money";
import { GlassCard } from "@/components/ui/primitives";
import { ShieldCheck, Zap } from "lucide-react";

export interface TierLedgerItem {
  tierId: string;
  tierNumber: number;
  name: string;
  subName: string;
  balanceMinor: bigint;
  balanceUsd?: number;
  rateLabel: string;
  liquidity: string;
  friction: string;
  priority: number;
  accentColor: string;
  capacityMinor?: bigint;
}

interface TierLedgerTableProps {
  items?: TierLedgerItem[];
  totalAssetsMinor?: bigint;
  isDeficit?: boolean;
  className?: string;
}

const DEFAULT_TIERS: TierLedgerItem[] = [
  {
    tierId: "tier0_cash",
    tierNumber: 0,
    name: "Tier 0: Cash Buffer",
    subName: "Instant Liquid · Operational Reserve Floor (R)",
    balanceMinor: 50_000_000_00n,
    balanceUsd: 50_000_000,
    rateLabel: "0.00% APY",
    liquidity: "Instant (T+0)",
    friction: "0.0% Fee",
    priority: 1,
    accentColor: "var(--muted-foreground)",
    capacityMinor: 100_000_000_00n,
  },
  {
    tierId: "tier1_repo",
    tierNumber: 1,
    name: "Tier 1: Overnight Repo",
    subName: "Swept 17:00 UTC · Matures 08:00 UTC",
    balanceMinor: 25_000_000_00n,
    balanceUsd: 25_000_000,
    rateLabel: "4.29% APY",
    liquidity: "Overnight (17:00–08:00)",
    friction: "0.5% Early break",
    priority: 2,
    accentColor: "var(--accent-teal)",
    capacityMinor: 50_000_000_00n,
  },
  {
    tierId: "tier2_bonds",
    tierNumber: 2,
    name: "Tier 2: 2Y Sovereign Debt",
    subName: "US Treasury · D_mod = 1.92 · MTM",
    balanceMinor: 15_000_000_00n,
    balanceUsd: 15_000_000,
    rateLabel: "4.80% YTM",
    liquidity: "MTM (T+1h)",
    friction: "2.0% Haircut",
    priority: 3,
    accentColor: "var(--accent-blue)",
    capacityMinor: 30_000_000_00n,
  },
  {
    tierId: "tier3_equities",
    tierNumber: 3,
    name: "Tier 3: Growth Equities",
    subName: "Index Tracking · σ = 18.0% Volatility",
    balanceMinor: 10_000_000_00n,
    balanceUsd: 10_000_000,
    rateLabel: "10.00% APY",
    liquidity: "Continuous (T+2h)",
    friction: "15.0% Slippage",
    priority: 4,
    accentColor: "var(--accent-gold)",
    capacityMinor: 20_000_000_00n,
  },
];

export function TierLedgerTable({
  items = DEFAULT_TIERS,
  totalAssetsMinor,
  isDeficit = false,
  className = "",
}: TierLedgerTableProps) {
  const computedTotal = useMemo(() => {
    if (totalAssetsMinor !== undefined) return totalAssetsMinor;
    return items.reduce((acc, item) => acc + item.balanceMinor, 0n);
  }, [items, totalAssetsMinor]);

  const totalNum = Number(computedTotal);

  return (
    <GlassCard className={`p-0 overflow-hidden ${className}`}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between border-b border-border px-5 py-3.5 bg-surface-2/40">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold tracking-tight text-foreground">
              4-Tier Holdings & Liquidation Priority Ledger
            </h3>
            <span className="rounded-full bg-accent-teal/15 px-2.5 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider text-accent-teal border border-accent-teal/30">
              CASCADE ENGINE
            </span>
            {isDeficit && (
              <span className="rounded-full bg-accent-crimson/15 px-2.5 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider text-accent-crimson border border-accent-crimson/30 animate-pulse">
                WATERFALL ACTIVE
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted">
            Automated waterfall liquidation ordered by lowest early-exit penalty and settlement friction
          </p>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="text-muted">Total Net Holdings:</span>
          <span className="font-bold text-foreground tabular-nums">
            {formatMinor(computedTotal)}
          </span>
        </div>
      </div>

      {/* High-density Table */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-border bg-surface-2/80 text-[11px] font-mono font-semibold uppercase tracking-wider text-muted">
              <th className="py-3 pl-5 pr-3">Tier / Instrument</th>
              <th className="py-3 px-3 text-right">Balance ($USD)</th>
              <th className="py-3 px-3 text-right">Current APY / YTM</th>
              <th className="py-3 px-3">Liquidity / Lockup</th>
              <th className="py-3 px-3">Liquidation Friction</th>
              <th className="py-3 pl-3 pr-5 text-center">Priority</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {items.map((tier) => {
              const itemBalance = Number(tier.balanceMinor);
              const sharePct =
                totalNum > 0
                  ? Math.min(100, Math.max(0, Math.round((itemBalance / totalNum) * 100)))
                  : 0;

              // Staggered cascade animation during deficit state
              const isCascading = isDeficit && tier.tierNumber > 0;
              const cascadeDelay = `${(tier.tierNumber - 1) * 300}ms`;

              return (
                <tr
                  key={tier.tierId}
                  className={`transition-colors hover:bg-surface-raised/80 group ${
                    isCascading ? "animate-liquidation-cascade" : ""
                  }`}
                  style={isCascading ? { animationDelay: cascadeDelay } : undefined}
                >
                  {/* Tier / Instrument */}
                  <td className="py-3 pl-5 pr-3">
                    <div className="flex items-center gap-2.5">
                      <span
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={{
                          backgroundColor: tier.accentColor,
                          boxShadow: `0 0 10px ${tier.accentColor}`,
                        }}
                      />
                      <div>
                        <div className="font-semibold text-foreground group-hover:text-foreground transition-colors">
                          {tier.name}
                        </div>
                        <div className="text-[10px] text-muted font-mono">
                          {tier.subName}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Balance + Capacity Bar */}
                  <td className="py-3 px-3 text-right">
                    <div className="font-mono font-bold text-foreground tabular-nums">
                      {tier.balanceUsd !== undefined
                        ? formatCurrency(tier.balanceUsd)
                        : formatCompactMinor(tier.balanceMinor)}
                    </div>
                    <div className="mt-1 flex items-center justify-end gap-2">
                      <div className="h-1.5 w-16 rounded-full bg-surface-2 overflow-hidden border border-border">
                        <div
                          className="h-full rounded-full transition-all duration-300"
                          style={{
                            width: `${sharePct}%`,
                            backgroundColor: tier.accentColor,
                          }}
                        />
                      </div>
                      <span className="font-mono text-[10px] text-muted tabular-nums">
                        {sharePct}%
                      </span>
                    </div>
                  </td>

                  {/* Rate */}
                  <td className="py-3 px-3 text-right">
                    <span
                      className="font-mono font-semibold"
                      style={{ color: tier.accentColor }}
                    >
                      {tier.rateLabel}
                    </span>
                  </td>

                  {/* Liquidity */}
                  <td className="py-3 px-3">
                    <span className="font-mono text-foreground text-[11px]">
                      {tier.liquidity}
                    </span>
                  </td>

                  {/* Liquidation Friction */}
                  <td className="py-3 px-3">
                    <span
                      className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-mono font-semibold ${
                        tier.priority === 1
                          ? "bg-muted/15 text-muted border border-border"
                          : tier.priority === 2
                          ? "bg-accent-teal/15 text-accent-teal border border-accent-teal/30"
                          : tier.priority === 3
                          ? "bg-accent-blue/15 text-accent-blue border border-accent-blue/30"
                          : "bg-accent-gold/15 text-accent-gold border border-accent-gold/30"
                      }`}
                    >
                      {tier.friction}
                    </span>
                  </td>

                  {/* Priority Order */}
                  <td className="py-3 pl-3 pr-5 text-center">
                    <span
                      className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-mono font-bold ${
                        tier.priority === 1
                          ? "bg-surface-2 text-muted border border-border"
                          : tier.priority === 2
                          ? "bg-accent-teal/20 text-accent-teal border border-accent-teal/40"
                          : tier.priority === 3
                          ? "bg-accent-blue/20 text-accent-blue border border-accent-blue/40"
                          : "bg-accent-gold/20 text-accent-gold border border-accent-gold/40"
                      }`}
                    >
                      {tier.priority}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer Summary Proving Overdraft Bypassed */}
      <div className="flex flex-wrap items-center justify-between px-5 py-2.5 bg-surface-2/40 border-t border-border text-[11px] font-mono">
        <div className="flex items-center gap-1.5 text-accent-teal">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span>Priority Recovery Sequence: T1 (0.5%) → T2 (2.0%) → T3 (15.0%)</span>
        </div>
        <div className="flex items-center gap-1 text-muted">
          <Zap className="h-3.5 w-3.5 text-accent-gold" />
          <span>Bypasses Emergency Overdraft (12.0% APR)</span>
        </div>
      </div>
    </GlassCard>
  );
}
