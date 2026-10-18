"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  Layers,
  ScrollText,
  Settings,
  TrendingUp,
  LayoutDashboard,
  ShieldCheck,
  Cpu,
  LogOut,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/firebase/auth-context";
import { BrandLogo } from "@/components/brand/logo";

interface SidebarProps {
  onNavigate?: () => void;
}

const navItems = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard, tag: "LIVE" },
  { href: "/forecast", label: "Cash Flow Forecasting", icon: TrendingUp },
  { href: "/optimizer", label: "4-Tier Yield Vaults", icon: Layers },
  { href: "/twin", label: "Liquidity Digital Twin", icon: Activity, tag: "SIM" },
  { href: "/audit", label: "Audit & Compliance Log", icon: ScrollText },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar({ onNavigate }: SidebarProps) {
  const pathname = usePathname();
  const { user, isMock, signOut } = useAuth();
  const router = useRouter();

  const handleSignOut = async () => {
    await signOut();
    router.push("/login");
  };

  return (
    <div className="flex h-full flex-col justify-between bg-[#0B0E14] border-r border-[#1E2536] p-4 text-[#F8FAFC]">
      {/* 1. Brand Header */}
      <div>
        <div className="flex items-center justify-between pb-6 border-b border-[#1E2536]">
          <Link href="/dashboard" className="flex items-center gap-2.5">
            <BrandLogo size={36} />
            <div>
              <span className="font-bold tracking-wider text-sm text-[#F8FAFC]">RESERVE JUGGLER</span>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-mono text-[#94A3B8] tracking-widest uppercase">
                  FINTECH OS
                </span>
                <span className="rounded bg-[#A3E635]/15 px-1.5 py-0.2 text-[9px] font-bold text-[#A3E635] border border-[#A3E635]/30">
                  TREASURY
                </span>
              </div>
            </div>
          </Link>
        </div>

        {/* 2. Primary Navigation */}
        <nav aria-label="Workstation Navigation" className="mt-5 space-y-1.5">
          <div className="px-2 mb-2">
            <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-[#94A3B8]">
              TERMINAL WORKSPACES
            </span>
          </div>

          {navItems.map(({ href, label, icon: Icon, tag }) => {
            const active = pathname === href || (href === "/dashboard" && pathname === "/");
            return (
              <Link
                key={href}
                href={href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center justify-between rounded-lg px-3 py-2.5 text-xs font-medium transition-all",
                  active
                    ? "bg-[#A3E635] text-[#0B0E14] font-semibold shadow-[0_0_15px_rgba(163,230,53,0.3)]"
                    : "text-[#94A3B8] hover:bg-[#121620] hover:text-[#F8FAFC]"
                )}
              >
                <div className="flex items-center gap-3">
                  <Icon className={cn("h-4 w-4", active ? "text-[#0B0E14]" : "text-[#94A3B8]")} />
                  <span>{label}</span>
                </div>
                {tag && (
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[9px] font-bold font-mono tracking-wider",
                      active
                        ? "bg-[#0B0E14]/20 text-[#0B0E14]"
                        : "bg-[#1E2536] text-[#94A3B8]"
                    )}
                  >
                    {tag}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* 3. Bottom System Telemetry & User Pill */}
      <div className="space-y-3 pt-4 border-t border-[#1E2536]">
        {/* System Status Indicators */}
        <div className="rounded-lg bg-[#121620] border border-[#1E2536] p-2.5 space-y-1.5 text-[11px]">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[#94A3B8]">
              <Cpu className="h-3.5 w-3.5 text-[#38BDF8]" />
              <span>ENGINE</span>
            </span>
            <span className="flex items-center gap-1 font-mono font-semibold text-[#A3E635]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#A3E635] animate-pulse" />
              ACTIVE
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[#94A3B8]">
              <ShieldCheck className="h-3.5 w-3.5 text-[#A3E635]" />
              <span>BASEL III LCR</span>
            </span>
            <span className="font-mono text-[10px] text-[#A3E635] font-semibold">
              COMPLIANT
            </span>
          </div>
        </div>

        {/* User Profile Pill */}
        <div className="flex items-center justify-between rounded-lg bg-[#121620] border border-[#1E2536] px-3 py-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#38BDF8]/20 border border-[#38BDF8]/40 text-[#38BDF8] text-xs font-bold font-mono">
              {user?.displayName ? user.displayName.charAt(0).toUpperCase() : <User className="h-3.5 w-3.5" />}
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-[#F8FAFC]">
                {user?.displayName || "Treasury Officer"}
              </p>
              <p className="truncate text-[10px] font-mono text-[#94A3B8]">
                {isMock ? "Mock Session" : (user?.email || "treasury@bank.com")}
              </p>
            </div>
          </div>

          <button
            onClick={handleSignOut}
            title="Sign out"
            aria-label="Sign out"
            className="p-1.5 text-[#94A3B8] hover:text-[#EF4444] hover:bg-[#1E2536] rounded transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
