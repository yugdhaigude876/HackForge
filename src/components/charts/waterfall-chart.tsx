"use client";

import React from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  ReferenceLine,
} from "recharts";
import { useChartTheme } from "@/components/finance/use-chart-theme";

export interface WaterfallStep {
  name: string;
  amount: number;
  fill?: string;
  symbol?: string;
  description?: string;
}

export interface WaterfallChartProps {
  steps: WaterfallStep[];
  height?: number;
  valueFormatter?: (val: number) => string;
  className?: string;
}

export function WaterfallChart({
  steps,
  height = 280,
  valueFormatter = (v) => `$${(v / 1_000_000).toFixed(1)}M`,
  className = "",
}: WaterfallChartProps) {
  const theme = useChartTheme();

  return (
    <div className={`w-full ${className}`} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={steps} margin={{ top: 15, right: 10, left: 0, bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} vertical={false} opacity={0.6} />
          <XAxis
            dataKey="name"
            stroke={theme.axisText}
            fontSize={11}
            tickLine={false}
            axisLine={{ stroke: theme.grid }}
          />
          <YAxis
            stroke={theme.axisText}
            fontSize={10}
            tickLine={false}
            axisLine={false}
            tickFormatter={(val) => valueFormatter(Number(val))}
          />
          <ReferenceLine y={0} stroke={theme.grid} strokeWidth={1.5} />
          <Tooltip
            contentStyle={{
              backgroundColor: theme.tooltipBg,
              borderColor: theme.tooltipBorder,
              borderRadius: "14px",
              color: theme.tooltipText,
              fontSize: "12px",
              boxShadow: "0 10px 25px -5px rgba(0,0,0,0.3)",
              backdropFilter: "blur(12px)",
            }}
            formatter={(val: unknown) => [
              valueFormatter(Number(val)),
              "Amount",
            ]}
          />
          <Bar dataKey="amount" radius={[6, 6, 0, 0]}>
            {steps.map((entry, index) => {
              const defaultFill =
                entry.amount < 0
                  ? theme.negative
                  : entry.name.toLowerCase().includes("reserve")
                  ? theme.accentIndigo
                  : entry.name.toLowerCase().includes("surplus")
                  ? theme.positive
                  : theme.primary;
              return <Cell key={`cell-${index}`} fill={entry.fill || defaultFill} />;
            })}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
