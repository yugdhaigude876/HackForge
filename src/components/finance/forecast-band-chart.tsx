"use client";

import { useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCompactMinor } from "@/lib/money";
import { useChartTheme } from "./use-chart-theme";
import {
  buildForecastBandSeries,
  type HistoryInputPoint,
  type ForecastInputPoint,
  type ResidualQuantilesConfig,
} from "./forecast-band-utils";

export interface ForecastBandChartProps {
  history: readonly HistoryInputPoint[];
  predictions: readonly ForecastInputPoint[];
  residualMetrics?: ResidualQuantilesConfig;
  mase?: number | null;
  captionExtra?: string;
  className?: string;
}

export function ForecastBandChart({
  history,
  predictions,
  residualMetrics,
  mase,
  captionExtra,
  className,
}: ForecastBandChartProps) {
  const chartTheme = useChartTheme();

  // Legend toggles
  const [showActuals, setShowActuals] = useState(true);
  const [showModel, setShowModel] = useState(true);
  const [showBand, setShowBand] = useState(true);

  const data = buildForecastBandSeries(history, predictions, residualMetrics);

  const hasData = data.length > 0;

  return (
    <div className={`space-y-3 ${className ?? ""}`}>
      {/* Header controls & toggles */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2.5">
        <div className="flex items-center gap-1.5 text-xs text-muted">
          {typeof mase === "number" && (
            <span className="font-mono font-medium text-foreground">
              MASE: {mase.toFixed(2)}
            </span>
          )}
          {typeof mase === "number" && captionExtra && <span>•</span>}
          {captionExtra && <span>{captionExtra}</span>}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            role="switch"
            aria-checked={showActuals}
            onClick={() => setShowActuals(!showActuals)}
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-all ${
              showActuals
                ? "bg-primary-soft text-foreground shadow-xs ring-1 ring-primary/30"
                : "bg-surface-2/60 text-muted hover:text-foreground"
            }`}
          >
            Actuals
          </button>
          <button
            type="button"
            role="switch"
            aria-checked={showModel}
            onClick={() => setShowModel(!showModel)}
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-all ${
              showModel
                ? "bg-warning/20 text-foreground shadow-xs ring-1 ring-warning/40"
                : "bg-surface-2/60 text-muted hover:text-foreground"
            }`}
          >
            Smoothing Model
          </button>
          <button
            type="button"
            role="switch"
            aria-checked={showBand}
            onClick={() => setShowBand(!showBand)}
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-all ${
              showBand
                ? "bg-primary/20 text-foreground shadow-xs ring-1 ring-primary/40"
                : "bg-surface-2/60 text-muted hover:text-foreground"
            }`}
          >
            Confidence Band
          </button>
        </div>
      </div>

      {/* Main Chart */}
      <div
        className="h-72 w-full"
        role="img"
        aria-label="Cash flow forecasting and backtesting chart"
      >
        {!hasData ? (
          <div className="flex h-full items-center justify-center text-sm text-muted">
            No history or forecast points available.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={data}
              margin={{ top: 12, right: 12, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="forecastBandGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor={chartTheme.forecastBandStroke}
                    stopOpacity={0.35}
                  />
                  <stop
                    offset="100%"
                    stopColor={chartTheme.forecastBandStroke}
                    stopOpacity={0.05}
                  />
                </linearGradient>
              </defs>

              <CartesianGrid
                stroke={chartTheme.grid}
                strokeDasharray="3 3"
                vertical={false}
              />
              <XAxis
                dataKey="step"
                stroke={chartTheme.axisText}
                fontSize={11}
                tickLine={false}
                interval={Math.max(1, Math.floor(data.length / 8))}
              />
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
                cursor={{ stroke: chartTheme.grid, strokeWidth: 1 }}
                contentStyle={{
                  backgroundColor: chartTheme.tooltipBg,
                  border: `1px solid ${chartTheme.tooltipBorder}`,
                  borderRadius: 6,
                  color: chartTheme.tooltipText,
                  fontSize: 12,
                }}
                formatter={(v, name) => {
                  if (v === null || v === undefined) return ["-", String(name)];
                  if (Array.isArray(v)) {
                    return [
                      `${formatCompactMinor(v[0])} to ${formatCompactMinor(v[1])}`,
                      "Confidence Band (99%)",
                    ];
                  }
                  return [formatCompactMinor(Number(v)), String(name)];
                }}
              />

              {/* Confidence Band Area (range) */}
              {showBand && (
                <Area
                  type="monotone"
                  dataKey="bandRange"
                  name="Confidence Band"
                  stroke={chartTheme.forecastBandStroke}
                  fill="url(#forecastBandGrad)"
                  isAnimationActive={false}
                />
              )}

              {/* Actuals Line */}
              {showActuals && (
                <Line
                  type="monotone"
                  dataKey="actual"
                  name="Actuals"
                  stroke={chartTheme.actuals}
                  strokeWidth={2}
                  dot={{ r: 2, fill: chartTheme.actuals }}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false}
                  connectNulls={false}
                />
              )}

              {/* Forecast Model Line */}
              {showModel && (
                <Line
                  type="monotone"
                  dataKey="mean"
                  name="Smoothing Model"
                  stroke={chartTheme.forecastMean}
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  dot={{ r: 2, fill: chartTheme.forecastMean }}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false}
                  connectNulls={false}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
