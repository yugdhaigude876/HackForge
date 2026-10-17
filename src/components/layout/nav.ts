import { Activity, BarChart3, Gauge, Layers, Settings, SlidersHorizontal, TrendingUp, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Phase in which the page becomes functional; undefined = available now. */
  phase?: number;
}

export const navItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: Gauge },
  { href: "/forecast", label: "Forecast", icon: TrendingUp, phase: 4 },
  { href: "/reserve", label: "Reserve", icon: Layers, phase: 5 },
  { href: "/optimizer", label: "Optimizer", icon: SlidersHorizontal, phase: 5 },
  { href: "/twin", label: "Digital Twin", icon: Activity, phase: 6 },
  { href: "/analytics", label: "Analytics", icon: BarChart3, phase: 7 },
  { href: "/settings", label: "Settings", icon: Settings, phase: 2 },
];
