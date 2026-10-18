"use client";

import React, { useMemo, useState } from "react";
import {
  Clock,
  Download,
  Play,
  Pause,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Menu,
  Bell,
  ChevronRight,
  X,
  FileCheck,
  PanelLeftClose,
  PanelLeftOpen,
  MoreHorizontal,
  Zap,
  Flame,
} from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { BrandLogo } from "@/components/brand/logo";
import { useLiveTreasury } from "@/components/providers/live-treasury-provider";
import { ticksToNotifications, type LiveNotification } from "@/lib/live/adapters";
import type { LiveConnection } from "@/lib/live/types";
import { useSidebar } from "./sidebar-context";

const NOTIFICATION_LABELS: Record<LiveNotification["type"], string> = {
  SWEEP: "SWEEP EXECUTED",
  MATURITY: "REPO MATURITY",
  LIQUIDATION: "LIQUIDATION CASCADE",
  OVERDRAFT: "EMERGENCY OVERDRAFT",
  INFO: "INFO",
  STATUS: "SOLVENCY STATUS CHANGE",
};

const NOTIFICATION_STYLES: Record<LiveNotification["type"], string> = {
  SWEEP: "border-accent-teal/30 bg-accent-teal/10 text-accent-teal",
  MATURITY: "border-accent-blue/30 bg-accent-blue/10 text-accent-blue",
  LIQUIDATION: "border-accent-gold/40 bg-accent-gold/10 text-accent-gold",
  OVERDRAFT: "border-accent-crimson/40 bg-accent-crimson/10 text-accent-crimson",
  INFO: "border-border bg-surface-2 text-muted",
  STATUS: "border-accent-gold/40 bg-accent-gold/10 text-accent-gold",
};

const CONNECTION_STYLES: Record<LiveConnection, { label: string; className: string; dot: string }> = {
  live: { label: "LIVE", className: "border-accent-teal/35 bg-accent-teal/15 text-accent-teal", dot: "bg-accent-teal animate-pulse" },
  paused: { label: "PAUSED", className: "border-border bg-surface-2 text-muted", dot: "bg-muted" },
  completed: { label: "COMPLETED", className: "border-accent-blue/35 bg-accent-blue/15 text-accent-blue", dot: "bg-accent-blue" },
  connecting: { label: "CONNECTING", className: "border-border bg-surface-2 text-muted", dot: "bg-muted animate-pulse" },
  offline: { label: "OFFLINE", className: "border-accent-gold/40 bg-accent-gold/15 text-accent-gold", dot: "bg-accent-gold" },
  "permission-denied": { label: "NO ACCESS", className: "border-accent-crimson/40 bg-accent-crimson/15 text-accent-crimson", dot: "bg-accent-crimson" },
  empty: { label: "NO STREAM", className: "border-border bg-surface-2 text-muted", dot: "bg-muted" },
};

const CONNECTION_TITLES: Record<LiveConnection, string> = {
  live: "Realtime dataset stream is live",
  paused: "Dataset clock is paused",
  completed: "The whole dataset has been streamed",
  connecting: "Connecting to the realtime stream",
  offline: "Connection lost. Showing the last known state",
  "permission-denied": "No access to this organisation's stream. Check that the Firestore rules are deployed and you are a member",
  empty: "No realtime stream for this session",
};

function ConnectionPill({ connection }: { connection: LiveConnection }) {
  const s = CONNECTION_STYLES[connection];
  return (
    <div
      data-testid="connection-pill"
      data-connection={connection}
      className={`hidden md:flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2 py-1 text-[10px] font-mono font-bold ${s.className}`}
      title={CONNECTION_TITLES[connection]}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      <span>{s.label}</span>
    </div>
  );
}

/** "2026-01-01 00:00:00 UTC" becomes "2026-01-01 00:00 UTC" so it fits on one line. */
function compactClock(value: string): string {
  return value.replace(/:\d{2}(\s*UTC)$/, "$1");
}

export interface TopBarProps {
  clockTimestamp?: string;
  isRepoWindowOpen?: boolean;
  isRepoMaturing?: boolean;
  repoMaturedYieldUsd?: number | null;
  solvencyStatus?: "HEALTHY" | "LOW_CONFIDENCE" | "UNDER_RESERVED";
  mase?: number | null;
  confidence?: number;
  deficitAmountUsd?: number;
  source?: string;
  isPlaying?: boolean;
  playbackSpeed?: number;
  breadcrumb?: string;
  onPlayToggle?: () => void;
  onStepHour?: () => void;
  onSpeedChange?: (speed: number) => void;
  onTriggerSweep?: () => void;
  onRunStressTest?: () => void;
  onExportAuditCsv?: () => void;
  onToggleMobileNav?: () => void;
  /** Overrides the notifications derived from the live stream (used for local sample mode). */
  notifications?: LiveNotification[];
}

export function TopBar({
  clockTimestamp = "2026-03-15 17:00:00 UTC",
  isRepoWindowOpen = true,
  isRepoMaturing = false,
  repoMaturedYieldUsd = null,
  solvencyStatus = "HEALTHY",
  mase = 0.85,
  confidence = 0.99,
  deficitAmountUsd = 0,
  source,
  isPlaying = false,
  playbackSpeed = 10,
  breadcrumb = "Overview",
  onPlayToggle,
  onStepHour,
  onSpeedChange,
  onTriggerSweep,
  onRunStressTest,
  onExportAuditCsv,
  onToggleMobileNav,
  notifications: notificationsProp,
}: TopBarProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const live = useLiveTreasury();
  const { collapsed, toggle } = useSidebar();
  const notifications = useMemo(
    () => notificationsProp ?? (live.enabled ? ticksToNotifications(live.ticks) : []),
    [notificationsProp, live.enabled, live.ticks]
  );
  const hasActions = Boolean(onTriggerSweep || onRunStressTest || onExportAuditCsv);

  const statusTone =
    solvencyStatus === "HEALTHY"
      ? "border-accent-teal/35 bg-accent-teal/15 text-accent-teal"
      : solvencyStatus === "LOW_CONFIDENCE"
      ? "border-accent-gold/40 bg-accent-gold/15 text-accent-gold"
      : "border-accent-crimson/50 bg-accent-crimson/20 text-accent-crimson animate-pulse";

  return (
    <>
      <header
        data-testid="top-bar"
        className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-surface/85 px-3 lg:px-5 backdrop-blur-xl transition-colors duration-150"
      >
        {/* Left: navigation controls and breadcrumb */}
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleMobileNav}
            className="lg:hidden shrink-0 text-muted hover:text-foreground"
            aria-label="Open navigation menu"
          >
            <Menu className="h-5 w-5" />
          </Button>

          <button
            type="button"
            onClick={toggle}
            data-testid="topbar-sidebar-toggle"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar (Ctrl+B)" : "Collapse sidebar (Ctrl+B)"}
            className="hidden lg:flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2 text-muted hover:text-foreground hover:border-border-strong transition-colors"
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>

          <BrandLogo size={28} className="lg:hidden shrink-0" />

          <nav aria-label="Breadcrumb" className="hidden md:flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted">
            <span className="truncate">Workstation</span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted/60" />
            <span className="truncate font-semibold text-foreground">{breadcrumb}</span>
          </nav>
        </div>

        {/* Center: simulation clock, replay controls, repo window */}
        <div className="flex shrink-0 items-center gap-2">
          <div
            className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 font-mono text-xs text-foreground"
            title="Dataset clock (UTC)"
          >
            <Clock className="h-3.5 w-3.5 shrink-0 text-accent-blue" />
            <span className="font-semibold tabular-nums">{compactClock(clockTimestamp)}</span>
          </div>

          {onPlayToggle && (
            <div className="hidden lg:flex items-center gap-1 rounded-lg border border-border bg-surface-2 p-0.5">
              <button
                type="button"
                onClick={onPlayToggle}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-semibold transition-all duration-150 ${
                  isPlaying ? "bg-accent-crimson text-white" : "bg-accent-blue text-white hover:bg-accent-blue/90"
                }`}
              >
                {isPlaying ? (
                  <>
                    <Pause className="h-3 w-3 fill-current" />
                    <span>Pause</span>
                  </>
                ) : (
                  <>
                    <Play className="h-3 w-3 fill-current" />
                    <span>Play</span>
                  </>
                )}
              </button>

              {onStepHour && (
                <button
                  type="button"
                  onClick={onStepHour}
                  className="rounded-md px-2 py-1 text-xs font-mono font-medium text-muted hover:bg-surface hover:text-foreground transition-colors"
                  title="Advance 1 Hour"
                >
                  +1h
                </button>
              )}

              {onSpeedChange && (
                <div className="flex items-center border-l border-border/80 pl-1 ml-0.5">
                  {[1, 10, 60].map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => onSpeedChange(s)}
                      className={`rounded px-1.5 py-0.5 text-[10px] font-mono font-bold transition-all ${
                        playbackSpeed === s ? "bg-accent-blue/20 text-accent-blue" : "text-muted hover:text-foreground"
                      }`}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {isRepoWindowOpen ? (
            <div className="hidden 2xl:flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-accent-indigo/35 bg-accent-indigo/15 px-2.5 py-1.5 text-[11px] font-bold text-accent-indigo">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-indigo opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-accent-indigo" />
              </span>
              <span>REPO SWEEP WINDOW OPEN (17:00 UTC)</span>
            </div>
          ) : isRepoMaturing ? (
            <div className="hidden 2xl:flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-accent-teal/35 bg-accent-teal/15 px-2.5 py-1.5 text-[11px] font-bold text-accent-teal">
              <span className="h-1.5 w-1.5 rounded-full bg-accent-teal animate-breathing-beacon" />
              <span>REPO MATURED: +${repoMaturedYieldUsd?.toLocaleString() ?? "0"} EARNED</span>
            </div>
          ) : (
            <div className="hidden 2xl:flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-[11px] font-mono text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-muted/60" />
              <span>REPO WINDOW CLOSED</span>
            </div>
          )}
        </div>

        {/* Right: status and actions */}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {live.enabled && <ConnectionPill connection={live.connection} />}

          {source === "offline-fallback" && (
            <div
              data-testid="fallback-badge"
              className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-accent-gold/40 bg-accent-gold/15 px-2 py-1 text-[10px] font-bold text-accent-gold font-mono"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>Offline fallback</span>
            </div>
          )}

          {/* Master solvency badge */}
          <div
            data-testid="decision-status-value"
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1 text-xs font-bold ${statusTone}`}
            title={
              solvencyStatus === "UNDER_RESERVED" && deficitAmountUsd > 0
                ? `Deficit: $${deficitAmountUsd.toLocaleString()}`
                : undefined
            }
          >
            {solvencyStatus === "HEALTHY" ? (
              <ShieldCheck className="h-4 w-4" />
            ) : solvencyStatus === "LOW_CONFIDENCE" ? (
              <AlertTriangle className="h-4 w-4" />
            ) : (
              <ShieldAlert className="h-4 w-4" />
            )}
            <span>
              {solvencyStatus === "HEALTHY" ? "HEALTHY" : solvencyStatus === "LOW_CONFIDENCE" ? "LOW CONFIDENCE" : "UNDER-RESERVED"}
            </span>
            <span data-testid="mase-chip" className="hidden xl:inline font-mono text-[10px] font-normal opacity-80">
              · MASE: {mase !== null && mase !== undefined ? mase.toFixed(2) : "n/a"}
            </span>
            <span data-testid="confidence-chip" className="hidden xl:inline font-mono text-[10px] font-normal opacity-80">
              {solvencyStatus === "LOW_CONFIDENCE"
                ? "· Buffer Expanded 1.5x"
                : `· VaR: ${Math.round(confidence * 100)}% Conf.`}
            </span>
            {solvencyStatus === "UNDER_RESERVED" && deficitAmountUsd > 0 && (
              <span className="hidden xl:inline font-mono text-[10px] font-normal">
                · Deficit: ${deficitAmountUsd.toLocaleString()}
              </span>
            )}
          </div>

          {/* Actions menu (replaces the crowded quick-action buttons) */}
          {hasActions && (
            <div className="relative hidden md:block">
              <button
                type="button"
                onClick={() => setMenuOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label="More actions"
                data-testid="topbar-actions"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface-2 text-muted hover:text-foreground hover:border-border-strong transition-colors"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
              {menuOpen && (
                <>
                  <button
                    type="button"
                    aria-label="Close actions menu"
                    className="fixed inset-0 z-30 cursor-default"
                    onClick={() => setMenuOpen(false)}
                  />
                  <div
                    role="menu"
                    className="absolute right-0 top-10 z-40 w-48 rounded-xl border border-border bg-surface-card p-1.5 shadow-xl"
                  >
                    {onTriggerSweep && (
                      <button
                        role="menuitem"
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          onTriggerSweep();
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-foreground hover:bg-surface-2"
                      >
                        <Zap className="h-3.5 w-3.5 text-accent-blue" /> Sweep 17:00
                      </button>
                    )}
                    {onRunStressTest && (
                      <button
                        role="menuitem"
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          onRunStressTest();
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-foreground hover:bg-surface-2"
                      >
                        <Flame className="h-3.5 w-3.5 text-accent-gold" /> Stress Test
                      </button>
                    )}
                    {onExportAuditCsv && (
                      <button
                        role="menuitem"
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          onExportAuditCsv();
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-foreground hover:bg-surface-2"
                      >
                        <Download className="h-3.5 w-3.5 text-muted" /> Export Audit CSV
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Notification / decision audit drawer trigger */}
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open Decision Audit Drawer"
            className="relative flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface-2 text-muted hover:border-border-strong hover:text-foreground transition-all"
          >
            <Bell className="h-4 w-4" />
            {notifications.length > 0 && (
              <span
                data-testid="notification-dot"
                className="absolute top-1 right-1 h-2 w-2 rounded-full bg-accent-blue shadow-[0_0_6px_var(--accent-blue)]"
              />
            )}
          </button>

          <ThemeToggle className="h-8 w-8 rounded-lg border border-border bg-surface-2" />
        </div>
      </header>

      {/* Decision audit drawer slide-over */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-sm transition-opacity"
          onClick={() => setDrawerOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-md h-full bg-surface-card border-l border-border p-6 shadow-2xl flex flex-col justify-between overflow-y-auto animate-in slide-in-from-right duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-5">
              <div className="flex items-center justify-between border-b border-border pb-4">
                <div className="flex items-center gap-2">
                  <FileCheck className="h-5 w-5 text-accent-blue" />
                  <h3 className="text-sm font-bold text-foreground">Decision & Audit Events</h3>
                </div>
                <button
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Close drawer"
                  className="rounded-lg p-1 text-muted hover:bg-surface-2 hover:text-foreground transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-3 font-mono text-xs" data-testid="notification-list">
                {notifications.length === 0 ? (
                  <p className="rounded-xl border border-border bg-surface-2 p-3 font-sans text-[11px] text-muted">
                    No events yet. Sweeps, maturities, liquidations, overdraft draws and solvency changes appear here as
                    the dataset clock advances.
                  </p>
                ) : (
                  notifications.map((n) => (
                    <div
                      key={n.id}
                      data-testid="notification-item"
                      className={`rounded-xl border p-3 space-y-1 ${NOTIFICATION_STYLES[n.type]}`}
                    >
                      <div className="flex items-center justify-between text-[11px] font-semibold">
                        <span>{NOTIFICATION_LABELS[n.type]}</span>
                        <span>{n.timestamp.slice(0, 16).replace("T", " ")} UTC</span>
                      </div>
                      <p className="text-foreground text-[11px] font-sans">{n.message}</p>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="pt-4 border-t border-border">
              <Button variant="outline" className="w-full text-xs font-semibold" onClick={() => setDrawerOpen(false)}>
                Close Audit Drawer
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
