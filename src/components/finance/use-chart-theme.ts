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
  accentIndigo: string;
  muted: string;
  teal: string;
  blue: string;
  gold: string;
  crimson: string;
  donutColors: string[];
}

export function useChartTheme(): ChartThemeColors {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  if (isDark) {
    return {
      isDark: true,
      grid: "rgba(255, 255, 255, 0.08)",
      axisText: "#94A3B8",
      tooltipBg: "#0F172A",
      tooltipBorder: "rgba(255, 255, 255, 0.12)",
      tooltipText: "#F8FAFC",
      actuals: "#3B82F6", // Electric Treasury Blue
      forecastMean: "#10B981", // Cyan Teal for expected flow
      forecastBand: "rgba(59, 130, 246, 0.18)",
      forecastBandStroke: "rgba(59, 130, 246, 0.45)",
      primary: "#3B82F6",
      positive: "#10B981",
      warning: "#F59E0B",
      negative: "#EF4444",
      accentIndigo: "#818CF8",
      muted: "#94A3B8",
      teal: "#10B981",
      blue: "#3B82F6",
      gold: "#F59E0B",
      crimson: "#EF4444",
      donutColors: ["#3B82F6", "#10B981", "#06B6D4", "#F59E0B", "#818CF8"],
    };
  }

  return {
    isDark: false,
    grid: "#DED9CD",
    axisText: "#667085",
    tooltipBg: "#FCFBF9",
    tooltipBorder: "#DED9CD",
    tooltipText: "#1D2638",
    actuals: "#2563EB",
    forecastMean: "#059669",
    forecastBand: "rgba(37, 99, 235, 0.14)",
    forecastBandStroke: "rgba(37, 99, 235, 0.35)",
    primary: "#2563EB",
    positive: "#059669",
    warning: "#D97706",
    negative: "#DC2626",
    accentIndigo: "#6366F1",
    muted: "#667085",
    teal: "#059669",
    blue: "#2563EB",
    gold: "#D97706",
    crimson: "#DC2626",
    donutColors: ["#2563EB", "#059669", "#0891B2", "#D97706", "#6366F1"],
  };
}
