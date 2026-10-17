"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatCompactMinor } from "@/lib/money";
import { useChartTheme } from "./use-chart-theme";

export interface AllocationItem {
  name: string;
  amount: number;
}

export interface AllocationDonutProps {
  allocations: AllocationItem[];
  totalMinor?: number;
  className?: string;
}

export function AllocationDonut({
  allocations,
  totalMinor,
  className,
}: AllocationDonutProps) {
  const chartTheme = useChartTheme();

  const total =
    totalMinor ?? allocations.reduce((acc, curr) => acc + curr.amount, 0);

  const data = allocations.filter((a) => a.amount > 0);

  if (data.length === 0) {
    return (
      <div
        className={`flex h-40 w-40 flex-col items-center justify-center rounded-lg border border-border/60 bg-surface-2/30 p-2 text-center text-xs text-muted ${
          className ?? ""
        }`}
      >
        <span>No active yield allocations</span>
      </div>
    );
  }

  return (
    <div
      className={`relative flex h-40 w-40 items-center justify-center ${
        className ?? ""
      }`}
      role="img"
      aria-label="Yield allocation distribution donut"
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip
            contentStyle={{
              backgroundColor: chartTheme.tooltipBg,
              border: `1px solid ${chartTheme.tooltipBorder}`,
              borderRadius: 6,
              color: chartTheme.tooltipText,
              fontSize: 12,
            }}
            formatter={(value, name) => [
              `${formatCompactMinor(Number(value))} (${
                total > 0 ? Math.round((Number(value) / total) * 100) : 0
              }%)`,
              String(name),
            ]}
          />
          <Pie
            data={data}
            dataKey="amount"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={38}
            outerRadius={56}
            paddingAngle={3}
            isAnimationActive={false}
          >
            {data.map((_, index) => (
              <Cell
                key={`cell-${index}`}
                fill={
                  chartTheme.donutColors[index % chartTheme.donutColors.length]
                }
              />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-[10px] uppercase tracking-wider text-muted">
          Yield
        </span>
        <span className="font-mono text-xs font-semibold text-foreground">
          {formatCompactMinor(total)}
        </span>
      </div>
    </div>
  );
}
