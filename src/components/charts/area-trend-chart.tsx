"use client";

import React from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { useChartTheme } from "@/components/finance/use-chart-theme";

export interface AreaTrendChartProps {
  data: Array<{ x: string | number; y: number; [key: string]: unknown }>;
  height?: number;
  dataKey?: string;
  xKey?: string;
  gradientColor?: string;
  valueFormatter?: (val: number) => string;
  className?: string;
}

export function AreaTrendChart({
  data,
  height = 240,
  dataKey = "y",
  xKey = "x",
  gradientColor,
  valueFormatter,
  className = "",
}: AreaTrendChartProps) {
  const theme = useChartTheme();
  const strokeColor = gradientColor || theme.primary;
  const gradientId = React.useId();

  return (
    <div className={`w-full ${className}`} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={strokeColor} stopOpacity={0.35} />
              <stop offset="95%" stopColor={strokeColor} stopOpacity={0.0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} vertical={false} opacity={0.7} />
          <XAxis
            dataKey={xKey}
            stroke={theme.axisText}
            fontSize={10}
            tickLine={false}
            axisLine={{ stroke: theme.grid }}
          />
          <YAxis
            stroke={theme.axisText}
            fontSize={10}
            tickLine={false}
            axisLine={false}
            tickFormatter={valueFormatter}
          />
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
            formatter={(value: unknown) => [
              valueFormatter ? valueFormatter(Number(value)) : Number(value).toLocaleString(),
              "Value",
            ]}
          />
          <Area
            type="monotone"
            dataKey={dataKey}
            stroke={strokeColor}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            activeDot={{
              r: 5,
              fill: strokeColor,
              stroke: theme.tooltipBg,
              strokeWidth: 2,
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
