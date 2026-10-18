"use client";

import React, { useState, useMemo } from "react";
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
import { cn } from "@/lib/utils";

interface ChartDataPoint {
  hourLabel: string;
  actualNetFlow?: number;
  ewmaForecast?: number;
  var99Lower?: number;
  var99Upper?: number;
}

interface ForecastChartProps {
  dataPoints?: ChartDataPoint[];
  history?: Array<{ hour: number; net: number; timestamp?: string }>;
  predictions?: Array<{
    hour: number;
    mean: number;
    bandLower?: number;
    bandUpper?: number;
    timestamp?: string;
  }>;
  mase?: number | null;
  onHorizonChange?: (horizonHours: number) => void;
}

const horizonOptions = [
  { label: "1D", hours: 24 },
  { label: "1W", hours: 168 },
  { label: "1M", hours: 720 },
  { label: "6M", hours: 4380 },
  { label: "1Y", hours: 8760 },
];

export function ForecastChart({
  dataPoints,
  history,
  predictions,
  mase,
  onHorizonChange,
}: ForecastChartProps) {
  const [selectedHorizon, setSelectedHorizon] = useState<number>(168);
  const theme = useChartTheme();
  const gradientId = React.useId();

  // Generate visual time-series if none provided
  const chartData = useMemo<ChartDataPoint[]>(() => {
    if (dataPoints && dataPoints.length > 0) {
      return dataPoints;
    }

    if (history || predictions) {
      const histList = history ?? [];
      const predList = predictions ?? [];
      const maxLen = Math.max(histList.length, predList.length);
      const points: ChartDataPoint[] = [];

      for (let i = 0; i < maxLen; i++) {
        const h = histList[i];
        const p = predList[i];
        const hourIdx = h?.hour ?? p?.hour ?? i;
        const hourOfDay = hourIdx % 24;

        points.push({
          hourLabel: `${hourOfDay.toString().padStart(2, "0")}:00`,
          actualNetFlow: h ? Math.round(h.net / 100_000) / 10 : undefined,
          ewmaForecast: p ? Math.round(p.mean / 100_000) / 10 : undefined,
          var99Lower: p?.bandLower ? Math.round(p.bandLower / 100_000) / 10 : undefined,
          var99Upper: p?.bandUpper ? Math.round(p.bandUpper / 100_000) / 10 : undefined,
        });
      }
      return points;
    }

    // Default 48h diurnal cycle
    return Array.from({ length: 48 }, (_, i) => {
      const hourOfDay = i % 24;
      const diurnal = Math.sin(((hourOfDay - 8) / 24) * 2 * Math.PI) * 3.5;
      const noise = (Math.sin(i * 3.7) + Math.cos(i * 1.3)) * 0.8;
      const actual = Math.round((diurnal + noise) * 100) / 100;
      const ewma = Math.round(diurnal * 0.95 * 100) / 100;
      const var99Lower = Math.round((ewma - 4.2) * 100) / 100;
      const var99Upper = Math.round((ewma + 2.5) * 100) / 100;

      return {
        hourLabel: `${hourOfDay.toString().padStart(2, "0")}:00`,
        actualNetFlow: actual,
        ewmaForecast: ewma,
        var99Lower,
        var99Upper,
      };
    });
  }, [dataPoints, history, predictions]);

  const handleHorizonSelect = (hours: number) => {
    setSelectedHorizon(hours);
    onHorizonChange?.(hours);
  };

  return (
    <div className="relative overflow-hidden rounded-[22px] border border-border bg-surface/85 p-5 backdrop-blur-xl shadow-lg">
      {/* Header & Horizon Range Pills */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-accent-blue shadow-[0_0_8px_var(--accent-blue)]" />
            <h3 className="text-sm font-bold text-foreground">
              Cash Flow Forecast & 99% Tail-Risk Envelope ($M)
            </h3>
            {mase !== undefined && mase !== null && (
              <span className="rounded-lg bg-accent-teal/15 border border-accent-teal/30 px-2 py-0.5 text-[10px] font-mono font-bold text-accent-teal">
                MASE: {mase.toFixed(2)}
              </span>
            )}
          </div>
          <p className="text-xs text-muted mt-0.5">
            Empirical EWMA (λ=0.3) vs 1st Percentile Basel III VaR
          </p>
        </div>

        {/* Horizon Toggle Pills */}
        <div className="inline-flex items-center rounded-xl border border-border bg-surface-2 p-1 gap-1">
          {horizonOptions.map(({ label, hours }) => {
            const active = selectedHorizon === hours;
            return (
              <button
                key={label}
                type="button"
                onClick={() => handleHorizonSelect(hours)}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-xs font-mono font-medium transition-all duration-150",
                  active
                    ? "bg-accent-blue text-white font-bold shadow-md shadow-accent-blue/25"
                    : "text-muted hover:text-foreground"
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Composed Chart Canvas */}
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={theme.primary} stopOpacity={0.25} />
                <stop offset="95%" stopColor={theme.primary} stopOpacity={0.02} />
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} vertical={false} opacity={0.6} />
            <XAxis
              dataKey="hourLabel"
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
              tickFormatter={(v) => `$${v}M`}
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
              formatter={(value: unknown, name: unknown) => [
                `$${String(value ?? 0)}M`,
                String(name ?? ""),
              ]}
            />
            <Legend
              wrapperStyle={{ fontSize: 11, paddingTop: 10 }}
              formatter={(value) => <span style={{ color: theme.axisText }} className="font-mono">{value}</span>}
            />

            {/* Shaded 99% VaR Envelope */}
            <Area
              type="monotone"
              dataKey="var99Lower"
              stroke={theme.forecastBandStroke}
              strokeDasharray="2 2"
              fill={`url(#${gradientId})`}
              name="99% VaR Tail Limit"
            />

            {/* Actual Net Flow */}
            <Line
              type="monotone"
              dataKey="actualNetFlow"
              stroke={theme.actuals}
              strokeWidth={2}
              dot={false}
              name="Historical Net Flow"
            />

            {/* EWMA Production Forecast */}
            <Line
              type="monotone"
              dataKey="ewmaForecast"
              stroke={theme.forecastMean}
              strokeWidth={2}
              strokeDasharray="4 4"
              dot={false}
              name="EWMA Forecast (λ=0.3)"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
