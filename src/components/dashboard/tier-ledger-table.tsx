"use client";

import { useMemo } from "react";
import { formatCurrency, formatCompactMinor, formatMinor } from "@/lib/money";

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
  className?: string;
}

const DEFAULT_TIERS: TierLedgerItem[] = [
  {
    tierId: "tier0_cash",
    tierNumber: 0,
    name: "Tier 0: Cash Buffer",
    subName: "Instant Liquid · Operational Reserve (R)",
    balanceMinor: 50_000_000_00n,
    balanceUsd: 50_000_000,
    rateLabel: "0.00% APY",
    liquidity: "Instant (T+0)",
    friction: "0.0% Fee",
    priority: 1,
    accentColor: "#94A3B8", // Muted Slate
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
    accentColor: "#A3E635", // Electric Lime
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
    accentColor: "#06B6D4", // Cyan
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
    accentColor: "#F59E0B", // Amber Gold
    capacityMinor: 20_000_000_00n,
  },
];

export function TierLedgerTable({
  items = DEFAULT_TIERS,
  totalAssetsMinor,
  className = "",
}: TierLedgerTableProps) {
  const computedTotal = useMemo(() => {
    if (totalAssetsMinor !== undefined) return totalAssetsMinor;
    return items.reduce((acc, item) => acc + item.balanceMinor, 0n);
  }, [items, totalAssetsMinor]);

  const totalNum = Number(computedTotal);

  return (
    <div
      className={`rounded-xl border border-[#1E2536] bg-[#121620] overflow-hidden shadow-lg ${className}`}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between border-b border-[#1E2536] px-5 py-3.5">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold tracking-wide text-[#F8FAFC]">
              4-Tier Holdings & Liquidation Priority Ledger
            </h3>
            <span className="rounded bg-[#1E2536] px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider text-[#A3E635]">
              CASCADE ENGINE
            </span>
          </div>
          <p className="mt-0.5 text-xs text-[#94A3B8]">
            Automated waterfall liquidation ordered by lowest early-exit penalty and settlement friction
          </p>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="text-[#94A3B8]">Total Net Holdings:</span>
          <span className="font-bold text-[#F8FAFC] tabular-nums">
            {formatMinor(computedTotal)}
          </span>
        </div>
      </div>

      {/* High-density Table */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-[#1E2536] bg-[#0B0E14]/60 text-[11px] font-mono font-semibold uppercase tracking-wider text-[#94A3B8]">
              <th className="py-3 pl-5 pr-3">Tier / Instrument</th>
              <th className="py-3 px-3 text-right">Balance ($USD)</th>
              <th className="py-3 px-3 text-right">Current APY / YTM</th>
              <th className="py-3 px-3">Liquidity / Lockup</th>
              <th className="py-3 px-3">Liquidation Friction</th>
              <th className="py-3 pl-3 pr-5 text-center">Priority</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1E2536]/70">
            {items.map((tier) => {
              const itemBalance = Number(tier.balanceMinor);
              const sharePct =
                totalNum > 0
                  ? Math.min(100, Math.max(0, Math.round((itemBalance / totalNum) * 100)))
                  : 0;

              return (
                <tr
                  key={tier.tierId}
                  className="transition-colors hover:bg-[#1A202C]/80 group"
                >
                  {/* Tier / Instrument */}
                  <td className="py-3 pl-5 pr-3">
                    <div className="flex items-center gap-2.5">
                      <span
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{
                          backgroundColor: tier.accentColor,
                          boxShadow: `0 0 8px ${tier.accentColor}80`,
                        }}
                      />
                      <div>
                        <div className="font-semibold text-[#F8FAFC] group-hover:text-white transition-colors">
                          {tier.name}
                        </div>
                        <div className="text-[10px] text-[#94A3B8] font-mono">
                          {tier.subName}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Balance + Capacity Bar */}
                  <td className="py-3 px-3 text-right">
                    <div className="font-mono font-bold text-[#F8FAFC] tabular-nums">
                      {tier.balanceUsd !== undefined
                        ? formatCurrency(tier.balanceUsd)
                        : formatCompactMinor(tier.balanceMinor)}
                    </div>
                    <div className="mt-1 flex items-center justify-end gap-2">
                      <div className="h-1.5 w-16 rounded-full bg-[#1E2536] overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-300"
                          style={{
                            width: `${sharePct}%`,
                            backgroundColor: tier.accentColor,
                          }}
                        />
                      </div>
                      <span className="font-mono text-[10px] text-[#94A3B8] tabular-nums">
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
                    <span className="font-mono text-[#F8FAFC] text-[11px]">
                      {tier.liquidity}
                    </span>
                  </td>

                  {/* Liquidation Friction */}
                  <td className="py-3 px-3">
                    <span
                      className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-mono font-semibold ${
                        tier.priority === 1
                          ? "bg-[#22C55E]/15 text-[#22C55E] border border-[#22C55E]/30"
                          : tier.priority === 2
                          ? "bg-[#38BDF8]/15 text-[#38BDF8] border border-[#38BDF8]/30"
                          : tier.priority === 3
                          ? "bg-[#F59E0B]/15 text-[#F59E0B] border border-[#F59E0B]/30"
                          : "bg-[#EF4444]/15 text-[#EF4444] border border-[#EF4444]/30"
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
                          ? "bg-[#A3E635] text-[#0B0E14] shadow-[0_0_10px_rgba(163,230,53,0.3)]"
                          : "bg-[#1E2536] text-[#94A3B8] border border-[#2A344A]"
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
    </div>
  );
}
