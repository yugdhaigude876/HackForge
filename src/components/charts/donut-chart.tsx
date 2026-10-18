"use client";

import React, { useState } from "react";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";
import { useChartTheme } from "@/components/finance/use-chart-theme";

export interface DonutSegment {
  name: string;
  value: number;
  color?: string;
  subLabel?: string;
}

export interface DonutChartProps {
  segments: DonutSegment[];
  height?: number;
  innerRadius?: number;
  outerRadius?: number;
  centerTitle?: string;
  centerValue?: string;
  valueFormatter?: (val: number) => string;
  className?: string;
}

export function DonutChart({
  segments,
  height = 200,
  innerRadius = 55,
  outerRadius = 75,
  centerTitle,
  centerValue,
  valueFormatter,
  className = "",
}: DonutChartProps) {
  const theme = useChartTheme();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const total = segments.reduce((sum, s) => sum + s.value, 0);

  return (
    <div className={`relative w-full ${className}`} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={segments}
            cx="50%"
            cy="50%"
            innerRadius={innerRadius}
            outerRadius={outerRadius}
            paddingAngle={3}
            dataKey="value"
            onMouseEnter={(_, index) => setActiveIndex(index)}
            onMouseLeave={() => setActiveIndex(null)}
          >
            {segments.map((entry, index) => {
              const fill = entry.color || theme.donutColors[index % theme.donutColors.length];
              const isSelected = activeIndex === index;
              return (
                <Cell
                  key={`donut-cell-${index}`}
                  fill={fill}
                  stroke={theme.tooltipBg}
                  strokeWidth={2}
                  className="transition-all duration-200"
                  style={{
                    filter: isSelected ? "drop-shadow(0 0 6px rgba(59,130,246,0.6))" : "none",
                    transform: isSelected ? "scale(1.03)" : "scale(1)",
                    transformOrigin: "center center",
                  }}
                />
              );
            })}
          </Pie>
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
              valueFormatter ? valueFormatter(Number(value)) : `$${Number(value).toLocaleString()}`,
              String(name),
            ]}
          />
        </PieChart>
      </ResponsiveContainer>

      {/* Center Text overlay */}
      {(centerTitle || centerValue) && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          {centerTitle && (
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted">
              {centerTitle}
            </span>
          )}
          {centerValue ? (
            <span className="text-base lg:text-lg font-bold font-mono tabular-nums text-foreground">
              {centerValue}
            </span>
          ) : (
            <span className="text-base font-bold font-mono tabular-nums text-foreground">
              {valueFormatter ? valueFormatter(total) : `$${total.toLocaleString()}`}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
