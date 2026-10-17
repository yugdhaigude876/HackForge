"use client";

import { useTheme } from "@/components/providers/theme-provider";

export interface ChartThemeColors {
  isDark: boolean;
  grid: string;
  axisText: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  actuals: string;
  forecastMean: string;
  forecastBand: string;
  forecastBandStroke: string;
  primary: string;
  positive: string;
  warning: string;
  negative: string;
  donutColors: string[];
}

export function useChartTheme(): ChartThemeColors {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  if (isDark) {
    return {
      isDark: true,
      grid: "#212c45",
      axisText: "#7c8ba1",
      tooltipBg: "#0e1628",
      tooltipBorder: "#273552",
      tooltipText: "#e2e8f0",
      actuals: "#38bdf8", // Sky blue for actuals
      forecastMean: "#f59e0b", // Amber for forecast model
      forecastBand: "rgba(56, 189, 248, 0.15)",
      forecastBandStroke: "rgba(56, 189, 248, 0.35)",
      primary: "#3b82f6",
      positive: "#10b981",
      warning: "#f59e0b",
      negative: "#ef4444",
      donutColors: ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899"],
    };
  }

  return {
    isDark: false,
    grid: "#ded9cd",
    axisText: "#667085",
    tooltipBg: "#faf9f6",
    tooltipBorder: "#ded9cd",
    tooltipText: "#1d2638",
    actuals: "#2563eb",
    forecastMean: "#a96f12",
    forecastBand: "rgba(47, 95, 196, 0.12)",
    forecastBandStroke: "rgba(47, 95, 196, 0.30)",
    primary: "#2f5fc4",
    positive: "#1d8a5e",
    warning: "#a96f12",
    negative: "#b83f36",
    donutColors: ["#2f5fc4", "#1d8a5e", "#a96f12", "#7c3aed", "#db2777"],
  };
}
