"use client";

import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCompactMinor } from "@/lib/money";
import type { NetFlowPoint } from "@/lib/sample-data";
import { useChartTheme } from "./use-chart-theme";

export function NetFlowChart({ data }: { data: NetFlowPoint[] }) {
  const chartTheme = useChartTheme();

  return (
    <div className="h-72 w-full" role="img" aria-label="Hourly net cash flow, sample data">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="hour" stroke={chartTheme.axisText} fontSize={11} tickLine={false} interval={3} />
          <YAxis
            stroke={chartTheme.axisText}
            fontSize={11}
            tickLine={false}
            axisLine={false}
            width={56}
            tickFormatter={(v: number) => formatCompactMinor(v)}
          />
          <ReferenceLine y={0} stroke={chartTheme.grid} />
          <Tooltip
            cursor={{ fill: chartTheme.isDark ? "#111d33" : "#ebe7de" }}
            contentStyle={{
              background: chartTheme.tooltipBg,
              border: `1px solid ${chartTheme.tooltipBorder}`,
              borderRadius: 6,
              fontSize: 12,
              color: chartTheme.tooltipText,
            }}
            formatter={(v) => [formatCompactMinor(Number(v)), "Net flow"]}
          />
          <Bar dataKey="net" fill={chartTheme.primary} radius={[2, 2, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
