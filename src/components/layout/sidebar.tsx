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
  Cpu,
  Gauge,
  LogOut,
  User,
  Search,
  Building2,
  BarChart3,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/firebase/auth-context";
import { BrandLogo } from "@/components/brand/logo";
import { useLiveTreasury } from "@/components/providers/live-treasury-provider";
import { CommandPalette } from "./command-palette";
import { useSidebar } from "./sidebar-context";

interface SidebarProps {
  onNavigate?: () => void;
  /** Force the expanded layout (used by the mobile drawer). */
  forceExpanded?: boolean;
}

interface NavGroup {
  group: string;
  items: Array<{
    href: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    tag?: string;
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

const CONNECTION_LABEL: Record<string, { label: string; tone: string }> = {
  live: { label: "LIVE", tone: "text-accent-teal" },
  paused: { label: "PAUSED", tone: "text-sidebar-muted" },
  completed: { label: "COMPLETED", tone: "text-accent-blue" },
  connecting: { label: "CONNECTING", tone: "text-sidebar-muted" },
  offline: { label: "OFFLINE", tone: "text-accent-gold" },
  "permission-denied": { label: "NO ACCESS", tone: "text-accent-crimson" },
  empty: { label: "NO STREAM", tone: "text-sidebar-muted" },
};

export function Sidebar({ onNavigate, forceExpanded }: SidebarProps) {
  const pathname = usePathname();
  const { user, isMock, signOut } = useAuth();
  const router = useRouter();
  const live = useLiveTreasury();
  const { collapsed: storedCollapsed, toggle } = useSidebar();
  const [paletteOpen, setPaletteOpen] = useState(false);

  const collapsed = forceExpanded ? false : storedCollapsed;

  const handleSignOut = async () => {
    await signOut();
    router.push("/login");
  };

  const roleLabel = user?.role ? user.role.toUpperCase() : isMock ? "DEMO OPERATOR" : "OPERATOR";

  // Real values only: connection state of the stream and reserve coverage of the latest streamed hour.
  const conn = CONNECTION_LABEL[live.enabled ? live.connection : "empty"];
  const coverage = (() => {
    if (!live.latest) return null;
    const cash = Number(BigInt(live.latest.availableCashMinor));
    const reserve = Number(BigInt(live.latest.reserveMinor));
    return reserve > 0 ? cash / reserve : null;
  })();

  const initial = user?.displayName ? user.displayName.charAt(0).toUpperCase() : null;

  return (
    <>
      <div
        data-testid="sidebar"
        data-collapsed={collapsed ? "true" : "false"}
        className={cn(
          "flex h-full flex-col justify-between bg-sidebar-bg border-r border-sidebar-border text-sidebar-foreground transition-all duration-300",
          collapsed ? "items-center p-2.5" : "p-3.5"
        )}
      >
        <div className={cn("flex flex-col gap-4", collapsed && "items-center w-full")}>
          {/* 1. Brand header with collapse control */}
          <div
            className={cn(
              "flex items-center pb-3.5 border-b border-sidebar-border w-full",
              collapsed ? "justify-center" : "justify-between"
            )}
          >
            <Link
              href="/dashboard"
              onClick={onNavigate}
              title="Reserve Juggler"
              className="flex items-center gap-3 transition-opacity hover:opacity-90 min-w-0"
            >
              <BrandLogo size={collapsed ? 36 : 34} className="ring-1 ring-white/10" />
              {!collapsed && (
                <div className="min-w-0">
                  <span className="block font-bold tracking-tight text-sm text-white">RESERVE JUGGLER</span>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[10px] font-mono tracking-widest text-sidebar-muted uppercase">TREASURY OS</span>
                    <span className="rounded bg-accent-blue/15 border border-accent-blue/30 px-1.5 font-mono text-[9px] font-bold text-accent-blue">
                      INSTITUTIONAL
                    </span>
                  </div>
                </div>
              )}
            </Link>
            {!forceExpanded && !collapsed && (
              <button
                type="button"
                onClick={toggle}
                data-testid="sidebar-collapse"
                aria-label="Collapse sidebar"
                title="Collapse sidebar (Ctrl+B)"
                className="ml-2 hidden lg:flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sidebar-muted hover:bg-white/[0.08] hover:text-white transition-colors"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            )}
          </div>

          {collapsed && !forceExpanded && (
            <button
              type="button"
              onClick={toggle}
              data-testid="sidebar-expand"
              aria-label="Expand sidebar"
              title="Expand sidebar (Ctrl+B)"
              className="hidden lg:flex h-9 w-9 items-center justify-center rounded-xl border border-white/8 bg-white/[0.03] text-sidebar-muted hover:bg-white/[0.08] hover:text-white transition-colors"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          )}

          {/* 2. Workspace card */}
          {collapsed ? (
            <div
              title={`Digital Bank Corp · ${roleLabel} · USD TREASURY`}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-blue/15 border border-accent-blue/30 text-accent-blue"
            >
              <Building2 className="h-4 w-4" />
            </div>
          ) : (
            <div className="rounded-xl border border-white/8 bg-white/[0.03] p-2.5 transition-colors hover:bg-white/[0.05]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-blue/15 border border-accent-blue/30 text-accent-blue">
                    <Building2 className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-white">Digital Bank Corp</p>
                    <p className="truncate text-[10px] font-mono text-sidebar-muted">{roleLabel} · USD TREASURY</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 3. Search / command palette */}
          {collapsed ? (
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              aria-label="Search or command"
              title="Search or command (Ctrl+K)"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/8 bg-white/[0.03] text-sidebar-muted hover:border-white/20 hover:bg-white/[0.08] hover:text-white transition-all"
            >
              <Search className="h-4 w-4" />
            </button>
          ) : (
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
          )}

          {/* 4. Navigation */}
          <nav aria-label="Workstation Navigation" className={cn("space-y-4", collapsed && "w-full flex flex-col items-center")}>
            {navGroups.map((group) => (
              <div key={group.group} className={cn("space-y-1", collapsed && "flex flex-col items-center gap-1 space-y-0")}>
                {!collapsed && (
                  <div className="px-2 mb-1.5">
                    <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-sidebar-muted/70">
                      {group.group}
                    </span>
                  </div>
                )}
                {collapsed && <div className="h-px w-6 bg-sidebar-border my-1 first:hidden" />}

                {group.items.map(({ href, label, icon: Icon, tag }) => {
                  const active = pathname === href || (href === "/dashboard" && pathname === "/");
                  return (
                    <Link
                      key={href}
                      href={href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      aria-label={collapsed ? label : undefined}
                      title={collapsed ? label : undefined}
                      className={cn(
                        "group flex items-center rounded-xl text-xs font-medium transition-all duration-150",
                        collapsed ? "h-10 w-10 justify-center" : "justify-between px-3 py-2",
                        active
                          ? "bg-accent-blue text-white font-semibold shadow-[0_0_20px_rgba(59,130,246,0.35)]"
                          : "text-sidebar-muted hover:bg-white/[0.06] hover:text-white"
                      )}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Icon className={cn("h-4 w-4 shrink-0 transition-colors", active ? "text-white" : "text-sidebar-muted group-hover:text-white")} />
                        {!collapsed && <span className="truncate">{label}</span>}
                      </div>
                      {!collapsed && tag && (
                        <span
                          className={cn(
                            "rounded px-1.5 font-mono text-[9px] font-bold tracking-wider",
                            active ? "bg-white/20 text-white" : "bg-white/[0.06] border border-white/[0.08] text-sidebar-muted"
                          )}
                        >
                          {tag}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
        </div>

        {/* 5. Bottom: real stream status and user */}
        <div className={cn("pt-3 border-t border-sidebar-border mt-auto w-full", collapsed ? "flex flex-col items-center gap-3" : "space-y-3")}>
          {collapsed ? (
            <div
              title={`Stream ${conn.label}${coverage !== null ? ` · reserve coverage ${coverage.toFixed(2)}x` : ""}`}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/8 bg-white/[0.03]"
            >
              <Cpu className={cn("h-4 w-4", conn.tone)} />
            </div>
          ) : (
            <div data-testid="sidebar-status" className="rounded-xl border border-white/8 bg-white/[0.02] p-2.5 space-y-1.5 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-sidebar-muted">
                  <Cpu className="h-3.5 w-3.5 text-accent-blue" />
                  <span>DATA STREAM</span>
                </span>
                <span className={cn("font-mono font-semibold", conn.tone)}>{conn.label}</span>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-white/[0.05]">
                <span className="flex items-center gap-1.5 text-sidebar-muted">
                  <Gauge className="h-3.5 w-3.5 text-accent-teal" />
                  <span>RESERVE COVERAGE</span>
                </span>
                <span className="font-mono text-[10px] font-semibold text-accent-teal">
                  {coverage !== null ? `${coverage.toFixed(2)}x` : "—"}
                </span>
              </div>
            </div>
          )}

          {collapsed ? (
            <>
              <div
                title={user?.displayName || user?.email || "Treasury Operator"}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-blue/20 border border-accent-blue/40 text-accent-blue text-xs font-bold font-mono"
              >
                {initial ?? <User className="h-4 w-4" />}
              </div>
              <button
                onClick={handleSignOut}
                title="Sign out"
                aria-label="Sign out"
                className="flex h-9 w-9 items-center justify-center text-sidebar-muted hover:text-accent-crimson hover:bg-white/[0.08] rounded-lg transition-colors"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </>
          ) : (
            <div className="flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.03] p-2 px-2.5 transition-colors hover:bg-white/[0.05]">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-blue/20 border border-accent-blue/40 text-accent-blue text-xs font-bold font-mono">
                  {initial ?? <User className="h-3.5 w-3.5" />}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-white">{user?.displayName || "Treasury Operator"}</p>
                  <p className="truncate text-[10px] font-mono text-sidebar-muted">
                    {isMock ? "Mock Dev Session" : user?.email || ""}
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
          )}
        </div>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </>
  );
}
