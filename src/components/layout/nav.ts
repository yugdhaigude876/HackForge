import {
  Activity,
  Gauge,
  Layers,
  ScrollText,
  Settings,
  SlidersHorizontal,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

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
  { href: "/twin", label: "Digital Twin", icon: Activity },
  { href: "/audit", label: "Audit Trail", icon: ScrollText, phase: 16 },
  { href: "/settings", label: "Settings", icon: Settings, phase: 2 },
];
