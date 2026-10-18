"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  TrendingUp,
  Layers,
  Activity,
  ScrollText,
  Settings,
  ShieldCheck,
  Cpu,
  LogOut,
  User,
  Search,
  Building2,
  BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/firebase/auth-context";
import { BrandLogo } from "@/components/brand/logo";
import { CommandPalette } from "./command-palette";

interface SidebarProps {
  onNavigate?: () => void;
  collapsed?: boolean;
}

interface NavGroup {
  group: string;
  items: Array<{
    href: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    tag?: string;
    badgeCount?: number;
  }>;
}

const navGroups: NavGroup[] = [
  {
    group: "CORE WORKSTATION",
    items: [
      { href: "/dashboard", label: "Overview", icon: LayoutDashboard, tag: "LIVE" },
      { href: "/forecast", label: "Cash Flow Forecasting", icon: TrendingUp },
      { href: "/reserve", label: "Reserve Sizing (Basel III)", icon: Layers },
      { href: "/optimizer", label: "4-Tier Yield Vaults", icon: Layers, tag: "YIELD" },
    ],
  },
  {
    group: "SIMULATION & AUDIT",
    items: [
      { href: "/twin", label: "Liquidity Digital Twin", icon: Activity, tag: "SIM" },
      { href: "/analytics", label: "Policy Analytics", icon: BarChart3 },
      { href: "/audit", label: "Audit & Compliance Log", icon: ScrollText },
      { href: "/settings", label: "System Settings", icon: Settings },
    ],
  },
];

export function Sidebar({ onNavigate }: SidebarProps) {
  const pathname = usePathname();
  const { user, isMock, signOut } = useAuth();
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    router.push("/login");
  };

  const roleLabel = user?.role ? user.role.toUpperCase() : isMock ? "DEMO OPERATOR" : "OPERATOR";

  return (
    <>
      <div className="flex h-full flex-col justify-between bg-sidebar-bg border-r border-sidebar-border p-3.5 text-sidebar-foreground transition-all duration-300">
        <div className="flex flex-col gap-4">
          {/* 1. Brand Header */}
          <div className="flex items-center justify-between pb-3.5 border-b border-sidebar-border">
            <Link
              href="/dashboard"
              onClick={onNavigate}
              className="flex items-center gap-3 transition-opacity hover:opacity-90"
            >
              <BrandLogo size={34} className="ring-1 ring-white/10" />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold tracking-tight text-sm text-white">RESERVE JUGGLER</span>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[10px] font-mono tracking-widest text-sidebar-muted uppercase">
                    TREASURY OS
                  </span>
                  <span className="rounded bg-accent-blue/15 border border-accent-blue/30 px-1.5 py-0.2 font-mono text-[9px] font-bold text-accent-blue">
                    INSTITUTIONAL
                  </span>
                </div>
              </div>
            </Link>
          </div>

          {/* 2. Workspace Selector Card */}
          <div className="rounded-xl border border-white/8 bg-white/[0.03] p-2.5 transition-colors hover:bg-white/[0.05]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-blue/15 border border-accent-blue/30 text-accent-blue">
                  <Building2 className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-white">Digital Bank Corp</p>
                  <p className="truncate text-[10px] font-mono text-sidebar-muted">
                    {roleLabel} · USD TREASURY
                  </p>
                </div>
              </div>
              <span className="rounded bg-accent-teal/15 border border-accent-teal/30 px-1.5 py-0.5 font-mono text-[9px] font-bold text-accent-teal">
                LIVE
              </span>
            </div>
          </div>

          {/* 3. Search Trigger / Command Palette Trigger */}
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-xs font-medium text-sidebar-muted hover:border-white/20 hover:bg-white/[0.06] hover:text-white transition-all shadow-sm group"
          >
            <div className="flex items-center gap-2">
              <Search className="h-3.5 w-3.5 text-sidebar-muted group-hover:text-accent-blue transition-colors" />
              <span>Search or command...</span>
            </div>
            <kbd className="flex items-center gap-0.5 rounded border border-white/10 bg-white/[0.05] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-sidebar-muted">
              <span className="text-[11px]">⌘</span>K
            </kbd>
          </button>

          {/* 4. Primary Grouped Navigation */}
          <nav aria-label="Workstation Navigation" className="space-y-4">
            {navGroups.map((group) => (
              <div key={group.group} className="space-y-1">
                <div className="px-2 mb-1.5">
                  <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-sidebar-muted/70">
                    {group.group}
                  </span>
                </div>

                {group.items.map(({ href, label, icon: Icon, tag, badgeCount }) => {
                  const active = pathname === href || (href === "/dashboard" && pathname === "/");
                  return (
                    <Link
                      key={href}
                      href={href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group flex items-center justify-between rounded-xl px-3 py-2 text-xs font-medium transition-all duration-150",
                        active
                          ? "bg-accent-blue text-white font-semibold shadow-[0_0_20px_rgba(59,130,246,0.35)]"
                          : "text-sidebar-muted hover:bg-white/[0.06] hover:text-white"
                      )}
                    >
                      <div className="flex items-center gap-2.5">
                        <Icon
                          className={cn(
                            "h-4 w-4 transition-colors",
                            active ? "text-white" : "text-sidebar-muted group-hover:text-white"
                          )}
                        />
                        <span>{label}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {tag && (
                          <span
                            className={cn(
                              "rounded px-1.5 py-0.2 font-mono text-[9px] font-bold tracking-wider",
                              active
                                ? "bg-white/20 text-white"
                                : "bg-white/[0.06] border border-white/[0.08] text-sidebar-muted"
                            )}
                          >
                            {tag}
                          </span>
                        )}
                        {badgeCount !== undefined && badgeCount > 0 && (
                          <span
                            className={cn(
                              "flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-mono text-[9px] font-bold",
                              active ? "bg-white text-accent-blue" : "bg-accent-blue text-white"
                            )}
                          >
                            {badgeCount}
                          </span>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
        </div>

        {/* 5. Bottom System Telemetry & User Card */}
        <div className="space-y-3 pt-3 border-t border-sidebar-border mt-auto">
          {/* Engine Status Indicators */}
          <div className="rounded-xl border border-white/8 bg-white/[0.02] p-2.5 space-y-1.5 text-[11px]">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-sidebar-muted">
                <Cpu className="h-3.5 w-3.5 text-accent-blue" />
                <span>ENGINE TELEMETRY</span>
              </span>
              <span className="flex items-center gap-1.5 font-mono font-semibold text-accent-teal">
                <span className="h-1.5 w-1.5 rounded-full bg-accent-teal animate-breathing-beacon" />
                ACTIVE
              </span>
            </div>

            <div className="flex items-center justify-between pt-1 border-t border-white/[0.05]">
              <span className="flex items-center gap-1.5 text-sidebar-muted">
                <ShieldCheck className="h-3.5 w-3.5 text-accent-teal" />
                <span>BASEL III LCR</span>
              </span>
              <span className="font-mono text-[10px] text-accent-teal font-semibold">
                134% COMPLIANT
              </span>
            </div>
          </div>

          {/* User Profile Card */}
          <div className="flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.03] p-2 px-2.5 transition-colors hover:bg-white/[0.05]">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-blue/20 border border-accent-blue/40 text-accent-blue text-xs font-bold font-mono">
                {user?.displayName ? (
                  user.displayName.charAt(0).toUpperCase()
                ) : (
                  <User className="h-3.5 w-3.5" />
                )}
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-white">
                  {user?.displayName || "Treasury Operator"}
                </p>
                <p className="truncate text-[10px] font-mono text-sidebar-muted">
                  {isMock ? "Mock Dev Session" : user?.email || "treasury@digitalbank.com"}
                </p>
              </div>
            </div>

            <button
              onClick={handleSignOut}
              title="Sign out"
              aria-label="Sign out"
              className="p-1.5 text-sidebar-muted hover:text-accent-crimson hover:bg-white/[0.08] rounded-lg transition-colors"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Global Command Palette modal */}
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </>
  );
}
