import {
  Activity,
  BarChart3,
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
  { href: "/forecast", label: "Forecast", icon: TrendingUp },
  { href: "/reserve", label: "Reserve", icon: Layers },
  { href: "/optimizer", label: "Optimizer", icon: SlidersHorizontal },
  { href: "/twin", label: "Digital Twin", icon: Activity },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/audit", label: "Audit Trail", icon: ScrollText },
  { href: "/settings", label: "Settings", icon: Settings },
];
