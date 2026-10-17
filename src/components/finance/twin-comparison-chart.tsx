"use client";

import React from "react";
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
import { useChartTheme } from "@/components/finance/use-chart-theme";
import { formatCompactMinor, formatMinor } from "@/lib/money";

export interface CashPointDTO {
  hour: number;
  p5CashMinor: string;
  medianCashMinor: string;
  p95CashMinor: string;
}

export interface PolicyResultDTO {
  policy: string;
  cashPath: CashPointDTO[];
}

export interface TwinComparisonChartProps {
  policyResults: Record<string, PolicyResultDTO>;
  policies: string[];
  horizonHours: number;
  currentHour?: number;
  onHourSelect?: (hour: number) => void;
}

const POLICY_METADATA: Record<
  string,
  { label: string; strokeVar: string; fillVar: string }
> = {
  "reserve-juggler": {
    label: "Reserve Juggler",
    strokeVar: "var(--policy-juggler)",
    fillVar: "var(--policy-juggler)",
  },
  "hold-all-cash": {
    label: "Hold All Cash",
    strokeVar: "var(--policy-cash)",
    fillVar: "var(--policy-cash)",
  },
  "fixed-buffer": {
    label: "Fixed Buffer",
    strokeVar: "var(--policy-buffer)",
    fillVar: "var(--policy-buffer)",
  },
};

export function TwinComparisonChart({
  policyResults,
  policies,
  horizonHours,
  currentHour = 0,
  onHourSelect,
}: TwinComparisonChartProps) {
  const chartTheme = useChartTheme();

  // Combine cashPath points for all policies by hour
  const data: Array<Record<string, unknown>> = [];
  for (let h = 0; h <= horizonHours; h++) {
    const point: Record<string, unknown> = {
      hour: `${h}h`,
      hourIndex: h,
    };

    for (const p of policies) {
      const res = policyResults[p];
      if (res && res.cashPath && res.cashPath[h]) {
        const pObj = res.cashPath[h];
        const p5 = Number(pObj.p5CashMinor);
        const median = Number(pObj.medianCashMinor);
        const p95 = Number(pObj.p95CashMinor);
        point[`${p}_median`] = median;
        point[`${p}_p5`] = p5;
        point[`${p}_p95`] = p95;
        point[`${p}_band`] = [p5, p95];
      }
    }
    data.push(point);
  }

  return (
    <div className="w-full space-y-3">
      {/* Policy Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs">
        {policies.map((p) => {
          const meta = POLICY_METADATA[p] ?? {
            label: p,
            strokeVar: chartTheme.primary,
            fillVar: chartTheme.primary,
          };
          return (
            <div key={p} className="flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: meta.strokeVar }}
                aria-hidden
              />
              <span className="font-medium text-foreground">{meta.label}</span>
              <span className="text-muted">(median + p5-p95 band)</span>
            </div>
          );
        })}
      </div>

      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 10, right: 10, bottom: 0, left: 10 }}
            onClick={(state: unknown) => {
              const s = state as { activePayload?: Array<{ payload?: { hourIndex?: number } }> } | null;
              if (s?.activePayload && s.activePayload.length > 0) {
                const hourIndex = s.activePayload[0]?.payload?.hourIndex;
                if (hourIndex !== undefined && onHourSelect) {
                  onHourSelect(hourIndex);
                }
              }
            }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} vertical={false} />
            <XAxis
              dataKey="hour"
              stroke={chartTheme.axisText}
              fontSize={11}
              tickLine={false}
              axisLine={{ stroke: chartTheme.grid }}
            />
            <YAxis
              stroke={chartTheme.axisText}
              fontSize={11}
              tickLine={false}
              axisLine={{ stroke: chartTheme.grid }}
              tickFormatter={(v: number) => formatCompactMinor(BigInt(Math.round(v)))}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload || !payload.length) return null;
                return (
                  <div
                    className="rounded-lg border px-3 py-2 text-xs shadow-md"
                    style={{
                      backgroundColor: chartTheme.tooltipBg,
                      borderColor: chartTheme.tooltipBorder,
                      color: chartTheme.tooltipText,
                    }}
                  >
                    <p className="font-semibold text-foreground mb-1.5">{label}</p>
                    <div className="space-y-1">
                      {policies.map((p) => {
                        const meta = POLICY_METADATA[p] ?? { label: p, strokeVar: "#fff" };
                        const medianVal = payload.find((item) => item.dataKey === `${p}_median`)
                          ?.value as number | undefined;
                        const p5Val = (payload[0]?.payload as Record<string, number> | undefined)?.[
                          `${p}_p5`
                        ];
                        const p95Val = (payload[0]?.payload as Record<string, number> | undefined)?.[
                          `${p}_p95`
                        ];

                        if (medianVal === undefined) return null;
                        return (
                          <div key={p} className="flex flex-col border-b border-border/50 pb-1 last:border-0 last:pb-0">
                            <div className="flex items-center justify-between gap-4">
                              <span className="font-medium" style={{ color: meta.strokeVar }}>
                                {meta.label}:
                              </span>
                              <span className="tabular font-semibold">
                                {formatMinor(BigInt(Math.round(medianVal)))}
                              </span>
                            </div>
                            {p5Val !== undefined && p95Val !== undefined && (
                              <div className="flex justify-between text-[10px] text-muted">
                                <span>p5-p95:</span>
                                <span className="tabular">
                                  {formatCompactMinor(BigInt(Math.round(p5Val)))} –{" "}
                                  {formatCompactMinor(BigInt(Math.round(p95Val)))}
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              }}
            />

            {/* Zero balance reference line */}
            <ReferenceLine y={0} stroke={chartTheme.negative} strokeDasharray="2 2" strokeWidth={1} />

            {/* Scrubber timeline marker line */}
            <ReferenceLine
              x={`${currentHour}h`}
              stroke={chartTheme.forecastMean}
              strokeWidth={2}
              label={{
                value: `t = ${currentHour}h`,
                position: "top",
                fill: chartTheme.forecastMean,
                fontSize: 10,
                fontWeight: 600,
              }}
            />

            {/* Render uncertainty bands and median lines for each policy */}
            {policies.map((p) => {
              const meta = POLICY_METADATA[p] ?? {
                strokeVar: chartTheme.primary,
                fillVar: chartTheme.primary,
              };
              return (
                <React.Fragment key={p}>
                  <Area
                    type="monotone"
                    dataKey={`${p}_band`}
                    stroke="none"
                    fill={meta.fillVar}
                    fillOpacity={0.12}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey={`${p}_median`}
                    stroke={meta.strokeVar}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </React.Fragment>
              );
            })}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
