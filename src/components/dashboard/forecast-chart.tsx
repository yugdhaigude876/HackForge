"use client";

import { useState, useMemo } from "react";
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

  // Generate fallback visual time-series if none provided
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

    // Default 24-48h diurnal cycle
    return Array.from({ length: 48 }, (_, i) => {
      const hourOfDay = i % 24;
      // Inflow peak at 08:00, outflow peak at 17:00
      const diurnal = Math.sin(((hourOfDay - 8) / 24) * 2 * Math.PI) * 3.5;
      const noise = (Math.sin(i * 3.7) + Math.cos(i * 1.3)) * 0.8;
      const actual = Math.round((diurnal + noise) * 100) / 100;
      const ewma = Math.round((diurnal * 0.95) * 100) / 100;
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
    if (onHorizonChange) {
      onHorizonChange(hours);
    }
  };

  return (
    <div className="terminal-card bg-[#121620] border border-[#1E2536] p-5 shadow-sm">
      {/* Header & Horizon Toggle Pills */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#A3E635]" />
            <h3 className="text-sm font-semibold text-[#F8FAFC]">
              Net Flow Forecasting & 99% Tail-Risk Envelope ($M)
            </h3>
            {mase !== undefined && mase !== null && (
              <span className="rounded bg-[#A3E635]/15 border border-[#A3E635]/30 px-2 py-0.5 text-[10px] font-mono font-bold text-[#A3E635]">
                MASE: {mase.toFixed(2)}
              </span>
            )}
          </div>
          <p className="text-xs text-[#94A3B8] mt-0.5">
            Historical Actuals vs Hour-of-Week EWMA (λ=0.3) vs 1st Percentile Basel III VaR
          </p>
        </div>

        {/* Horizon Toggle Pills */}
        <div className="flex items-center rounded-lg bg-[#0B0E14] border border-[#1E2536] p-1 gap-1">
          {horizonOptions.map(({ label, hours }) => {
            const active = selectedHorizon === hours;
            return (
              <button
                key={label}
                onClick={() => handleHorizonSelect(hours)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-mono font-medium transition-all",
                  active
                    ? "bg-[#A3E635] text-[#0B0E14] font-bold shadow-[0_0_10px_rgba(163,230,53,0.3)]"
                    : "text-[#94A3B8] hover:text-[#F8FAFC]"
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Chart Canvas */}
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
            <defs>
              <linearGradient id="varGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#38BDF8" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#38BDF8" stopOpacity={0.02} />
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="3 3" stroke="#1E2536" opacity={0.6} />
            <XAxis dataKey="hourLabel" stroke="#94A3B8" fontSize={10} tickLine={false} />
            <YAxis stroke="#94A3B8" fontSize={10} tickLine={false} tickFormatter={(v) => `$${v}M`} />
            <Tooltip
              contentStyle={{
                backgroundColor: "#121620",
                borderColor: "#1E2536",
                borderRadius: "0.5rem",
                color: "#F8FAFC",
                fontSize: 11,
              }}
              formatter={(value: unknown, name: unknown) => [
                `$${String(value ?? 0)}M`,
                String(name ?? ""),
              ]}
            />
            <Legend
              wrapperStyle={{ fontSize: 11, paddingTop: 10 }}
              formatter={(value) => <span className="text-[#94A3B8] font-mono">{value}</span>}
            />

            {/* Shaded 99% VaR Envelope */}
            <Area
              type="monotone"
              dataKey="var99Lower"
              stroke="#0284c7"
              strokeDasharray="2 2"
              fill="url(#varGradient)"
              name="99% VaR Tail Limit"
            />

            {/* Actual Net Flow */}
            <Line
              type="monotone"
              dataKey="actualNetFlow"
              stroke="#38BDF8"
              strokeWidth={2}
              dot={false}
              name="Historical Net Flow"
            />

            {/* EWMA Production Forecast */}
            <Line
              type="monotone"
              dataKey="ewmaForecast"
              stroke="#A3E635"
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
