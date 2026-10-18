"use client";

import React, { useMemo } from "react";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";
import { formatCompactMinor, formatMinor } from "@/lib/money";
import { GlassCard } from "@/components/ui/primitives";
import { useChartTheme } from "@/components/finance/use-chart-theme";

interface AssetTierItem {
  id: string;
  name: string;
  amountMinor: bigint;
  color: string;
  rateLabel: string;
  lockupLabel: string;
}

interface AssetAllocationDonutProps {
  cashMinor?: bigint;
  repoMinor?: bigint;
  bondsMinor?: bigint;
  equitiesMinor?: bigint;
  overdraftMinor?: bigint;
}

export function AssetAllocationDonut({
  cashMinor = 15_000_000_00n,
  repoMinor = 20_000_000_00n,
  bondsMinor = 10_000_000_00n,
  equitiesMinor = 5_000_000_00n,
  overdraftMinor = 0n,
}: AssetAllocationDonutProps) {
  const chartTheme = useChartTheme();

  const tiers: AssetTierItem[] = useMemo(() => [
    {
      id: "tier0",
      name: "Tier 0: Cash Buffer",
      amountMinor: cashMinor,
      color: chartTheme.muted,
      rateLabel: "0.0% APY",
      lockupLabel: "Instant Liquid (0h)",
    },
    {
      id: "tier1",
      name: "Tier 1: Overnight Repo",
      amountMinor: repoMinor,
      color: chartTheme.teal,
      rateLabel: "4.29% APY",
      lockupLabel: "Overnight (17:00-08:00)",
    },
    {
      id: "tier2",
      name: "Tier 2: 2Y Sovereign Debt",
      amountMinor: bondsMinor,
      color: chartTheme.blue,
      rateLabel: "4.80% YTM",
      lockupLabel: "D_mod=1.92 (1h)",
    },
    {
      id: "tier3",
      name: "Tier 3: Growth Equities",
      amountMinor: equitiesMinor,
      color: chartTheme.gold,
      rateLabel: "10.0% APY",
      lockupLabel: "Continuous (2h)",
    },
  ], [cashMinor, repoMinor, bondsMinor, equitiesMinor, chartTheme]);

  const totalMinor =
    overdraftMinor > 0n
      ? cashMinor + repoMinor + bondsMinor + equitiesMinor - overdraftMinor
      : cashMinor + repoMinor + bondsMinor + equitiesMinor;

  const chartData = useMemo(() => tiers.map((t) => ({
    name: t.name,
    value: Number(t.amountMinor) / 100,
    color: t.color,
  })), [tiers]);

  return (
    <GlassCard className="p-5">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-foreground tracking-tight">4-Tier Asset Vault Allocation</h3>
        <span className="text-[10px] font-mono font-semibold text-accent-teal bg-accent-teal/10 px-2 py-0.5 rounded border border-accent-teal/20 tracking-wider">
          ZERO IDLE DRAG
        </span>
      </div>
      <p className="text-xs text-muted mb-4">
        Dynamic capital distribution across institutional liquidity tiers
      </p>

      {/* Donut Canvas */}
      <div className="relative h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={75}
              paddingAngle={3}
              dataKey="value"
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} stroke="var(--surface)" strokeWidth={2} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--surface)",
                borderColor: "var(--border)",
                borderRadius: "0.5rem",
                fontSize: 11,
                color: "var(--foreground)",
                boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.4)",
              }}
              formatter={(value: unknown) => [`$${Number(value).toLocaleString()}`, "Valuation"]}
            />
          </PieChart>
        </ResponsiveContainer>

        {/* Center Text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-[10px] font-mono text-muted uppercase tracking-wider">Total Assets</span>
          <span className="text-base font-bold font-mono text-foreground tabular-nums">
            {formatCompactMinor(totalMinor)}
          </span>
        </div>
      </div>

      {/* Tier Legend & Metrics */}
      <div className="grid grid-cols-2 gap-2.5 mt-3 pt-3 border-t border-border">
        {tiers.map((t) => {
          const pct = totalMinor > 0n ? Math.round((Number(t.amountMinor) / Number(totalMinor)) * 100) : 0;
          return (
            <div key={t.id} className="rounded-xl bg-surface-2 border border-border p-2.5 transition-all hover:border-border-strong">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                <span className="text-[11px] font-medium text-foreground truncate">{t.name.split(":")[0]}</span>
                <span className="ml-auto font-mono text-[10px] text-accent-teal font-semibold tabular-nums">{pct}%</span>
              </div>
              <div className="flex items-baseline justify-between mt-1 text-[11px] font-mono">
                <span className="text-muted tabular-nums">{formatMinor(t.amountMinor)}</span>
                <span className="text-[10px] text-accent-blue font-semibold">{t.rateLabel}</span>
              </div>
            </div>
          );
        })}
      </div>
    </GlassCard>
  );
}
