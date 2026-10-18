"use client";

import React from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { useChartTheme } from "@/components/finance/use-chart-theme";

export interface BandChartPoint {
  label: string;
  actual?: number | null;
  forecast?: number | null;
  bandLower?: number | null;
  bandUpper?: number | null;
  bandRange?: [number, number] | null;
}

export interface BandChartProps {
  data: BandChartPoint[];
  height?: number;
  valueFormatter?: (val: number) => string;
  actualsName?: string;
  forecastName?: string;
  bandName?: string;
  className?: string;
}

export function BandChart({
  data,
  height = 280,
  valueFormatter = (v) => `$${v.toLocaleString()}M`,
  actualsName = "Actual Net Flow",
  forecastName = "EWMA Forecast",
  bandName = "99% VaR Tail Envelope",
  className = "",
}: BandChartProps) {
  const theme = useChartTheme();
  const gradientId = React.useId();

  // Normalize data to ensure bandRange is present if lower/upper exist
  const formattedData = data.map((pt) => ({
    ...pt,
    bandRange:
      pt.bandLower !== undefined && pt.bandUpper !== undefined && pt.bandLower !== null && pt.bandUpper !== null
        ? [pt.bandLower, pt.bandUpper]
        : pt.bandRange,
  }));

  return (
    <div className={`w-full ${className}`} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={formattedData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={theme.primary} stopOpacity={0.25} />
              <stop offset="95%" stopColor={theme.primary} stopOpacity={0.03} />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} vertical={false} opacity={0.6} />
          <XAxis
            dataKey="label"
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
            tickFormatter={(val) => valueFormatter(Number(val))}
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
            formatter={(value: unknown, name: unknown) => {
              if (Array.isArray(value)) {
                return [
                  `${valueFormatter(value[0])} to ${valueFormatter(value[1])}`,
                  String(name),
                ];
              }
              if (value === undefined || value === null) return ["-", String(name)];
              return [valueFormatter(Number(value)), String(name)];
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
            formatter={(val) => <span style={{ color: theme.axisText }}>{val}</span>}
          />

          {/* Shaded 99% VaR Envelope */}
          <Area
            type="monotone"
            dataKey="bandRange"
            stroke={theme.forecastBandStroke}
            strokeDasharray="2 2"
            fill={`url(#${gradientId})`}
            name={bandName}
          />

          {/* Actuals Line */}
          <Line
            type="monotone"
            dataKey="actual"
            stroke={theme.actuals}
            strokeWidth={2}
            dot={false}
            name={actualsName}
          />

          {/* Forecast Mean Line */}
          <Line
            type="monotone"
            dataKey="forecast"
            stroke={theme.forecastMean}
            strokeWidth={2}
            strokeDasharray="4 4"
            dot={false}
            name={forecastName}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
