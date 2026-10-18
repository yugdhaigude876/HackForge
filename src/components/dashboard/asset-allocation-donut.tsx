"use client";

import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";
import { formatCompactMinor, formatMinor } from "@/lib/money";

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
  const tiers: AssetTierItem[] = [
    {
      id: "tier0",
      name: "Tier 0: Cash Buffer",
      amountMinor: cashMinor,
      color: "#475569",
      rateLabel: "0.0% APY",
      lockupLabel: "Instant Liquid (0h)",
    },
    {
      id: "tier1",
      name: "Tier 1: Overnight Repo",
      amountMinor: repoMinor,
      color: "#A3E635",
      rateLabel: "4.29% APY",
      lockupLabel: "Overnight (17:00-08:00)",
    },
    {
      id: "tier2",
      name: "Tier 2: 2Y Sovereign Debt",
      amountMinor: bondsMinor,
      color: "#06B6D4",
      rateLabel: "4.80% YTM",
      lockupLabel: "D_mod=1.92 (1h)",
    },
    {
      id: "tier3",
      name: "Tier 3: Growth Equities",
      amountMinor: equitiesMinor,
      color: "#F59E0B",
      rateLabel: "10.0% APY",
      lockupLabel: "Continuous (2h)",
    },
  ];

  const totalMinor =
    overdraftMinor > 0n
      ? cashMinor + repoMinor + bondsMinor + equitiesMinor - overdraftMinor
      : cashMinor + repoMinor + bondsMinor + equitiesMinor;

  const chartData = tiers.map((t) => ({
    name: t.name,
    value: Number(t.amountMinor) / 100,
    color: t.color,
  }));

  return (
    <div className="terminal-card bg-[#121620] border border-[#1E2536] p-5 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-[#F8FAFC]">4-Tier Asset Vault Allocation</h3>
        <span className="text-[10px] font-mono font-semibold text-[#A3E635] bg-[#A3E635]/10 px-2 py-0.5 rounded border border-[#A3E635]/20">
          ZERO IDLE DRAG
        </span>
      </div>
      <p className="text-xs text-[#94A3B8] mb-4">
        Dynamic capital distribution across liquidity tiers
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
                <Cell key={`cell-${index}`} fill={entry.color} stroke="#121620" strokeWidth={2} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: "#121620",
                borderColor: "#1E2536",
                borderRadius: "0.5rem",
                fontSize: 11,
                color: "#F8FAFC",
              }}
              formatter={(value: unknown) => [`$${Number(value).toLocaleString()}`, "Valuation"]}
            />
          </PieChart>
        </ResponsiveContainer>

        {/* Center Text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-[10px] font-mono text-[#94A3B8] uppercase">Total Assets</span>
          <span className="text-base font-bold font-mono text-[#F8FAFC]">
            {formatCompactMinor(totalMinor)}
          </span>
        </div>
      </div>

      {/* Tier Legend & Metrics */}
      <div className="grid grid-cols-2 gap-2.5 mt-3 pt-3 border-t border-[#1E2536]">
        {tiers.map((t) => {
          const pct = totalMinor > 0n ? Math.round((Number(t.amountMinor) / Number(totalMinor)) * 100) : 0;
          return (
            <div key={t.id} className="rounded-md bg-[#0B0E14] border border-[#1E2536] p-2">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                <span className="text-[11px] font-medium text-[#F8FAFC] truncate">{t.name.split(":")[0]}</span>
                <span className="ml-auto font-mono text-[10px] text-[#A3E635] font-semibold">{pct}%</span>
              </div>
              <div className="flex items-baseline justify-between mt-1 text-[11px] font-mono">
                <span className="text-[#94A3B8]">{formatMinor(t.amountMinor)}</span>
                <span className="text-[10px] text-[#38BDF8]">{t.rateLabel}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
