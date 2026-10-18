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
} from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { BrandLogo } from "@/components/brand/logo";
import { useLiveTreasury } from "@/components/providers/live-treasury-provider";
import { ticksToNotifications, type LiveNotification } from "@/lib/live/adapters";
import type { LiveConnection } from "@/lib/live/types";

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
  offline: { label: "OFFLINE · STALE", className: "border-accent-gold/40 bg-accent-gold/15 text-accent-gold", dot: "bg-accent-gold" },
  "permission-denied": { label: "NO ACCESS", className: "border-accent-crimson/40 bg-accent-crimson/15 text-accent-crimson", dot: "bg-accent-crimson" },
  empty: { label: "NO STREAM", className: "border-border bg-surface-2 text-muted", dot: "bg-muted" },
};

function ConnectionPill({ connection }: { connection: LiveConnection }) {
  const s = CONNECTION_STYLES[connection];
  return (
    <div
      data-testid="connection-pill"
      data-connection={connection}
      className={`hidden md:flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[10px] font-mono font-bold shadow-sm ${s.className}`}
      title="Realtime dataset stream connection"
    >
      <span className={`h-2 w-2 rounded-full ${s.dot}`} />
      <span>{s.label}</span>
    </div>
  );
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
  const live = useLiveTreasury();
  const notifications = useMemo(
    () => notificationsProp ?? (live.enabled ? ticksToNotifications(live.ticks) : []),
    [notificationsProp, live.enabled, live.ticks]
  );

  return (
    <>
      <header data-testid="top-bar" className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border bg-surface/85 px-4 lg:px-6 backdrop-blur-xl transition-colors duration-150">
        {/* Left: Mobile Nav toggle + Breadcrumb & Timeline Ticker */}
        <div className="flex items-center gap-3 min-w-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleMobileNav}
            className="lg:hidden text-muted hover:text-foreground"
            aria-label="Open navigation menu"
          >
            <Menu className="h-5 w-5" />
          </Button>

          <BrandLogo size={28} className="lg:hidden shrink-0" />

          {/* Interactive Breadcrumb Hierarchy */}
          <nav aria-label="Breadcrumb" className="hidden sm:flex items-center gap-1.5 text-xs font-medium text-muted">
            <span className="hover:text-foreground cursor-pointer transition-colors">Workstation</span>
            <ChevronRight className="h-3.5 w-3.5 text-muted/60" />
            <span className="font-semibold text-foreground">{breadcrumb}</span>
          </nav>

          <div className="hidden sm:block h-4 w-px bg-border mx-1" />

          {/* Simulation Clock Readout */}
          <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 py-1.5 font-mono text-xs text-foreground shadow-sm">
            <Clock className="h-3.5 w-3.5 text-accent-blue" />
            <span className="font-semibold tracking-tight tabular-nums">{clockTimestamp}</span>
          </div>

          {/* Timeline Playback Controls */}
          {onPlayToggle && (
            <div className="hidden md:flex items-center gap-1 rounded-xl border border-border bg-surface-2 p-1">
              <button
                type="button"
                onClick={onPlayToggle}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all duration-150 ${
                  isPlaying
                    ? "bg-accent-crimson text-white shadow-sm shadow-accent-crimson/25"
                    : "bg-accent-blue text-white shadow-sm shadow-accent-blue/25 hover:bg-accent-blue/90"
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
                  className="rounded-lg px-2 py-1 text-xs font-mono font-medium text-muted hover:bg-surface hover:text-foreground transition-colors"
                  title="Advance 1 Hour"
                >
                  +1h
                </button>
              )}

              {onSpeedChange && (
                <div className="flex items-center border-l border-border/80 pl-1 ml-1">
                  {[1, 10, 60].map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => onSpeedChange(s)}
                      className={`rounded-md px-1.5 py-0.5 text-[10px] font-mono font-bold transition-all ${
                        playbackSpeed === s
                          ? "bg-accent-blue/20 text-accent-blue"
                          : "text-muted hover:text-foreground"
                      }`}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Overnight Repo Window Indicator with Breathing Beacon */}
          {isRepoWindowOpen ? (
            <div className="hidden xl:flex items-center gap-2 rounded-xl border border-accent-indigo/35 bg-accent-indigo/15 px-3 py-1.5 text-xs font-bold text-accent-indigo shadow-sm shadow-accent-indigo/10">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-indigo opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-accent-indigo" />
              </span>
              <span>REPO SWEEP WINDOW OPEN (17:00 UTC)</span>
            </div>
          ) : isRepoMaturing ? (
            <div className="hidden xl:flex items-center gap-2 rounded-xl border border-accent-teal/35 bg-accent-teal/15 px-3 py-1.5 text-xs font-bold text-accent-teal shadow-sm shadow-accent-teal/10">
              <span className="h-2 w-2 rounded-full bg-accent-teal animate-breathing-beacon" />
              <span>REPO MATURED: +${repoMaturedYieldUsd?.toLocaleString() ?? "0"} EARNED</span>
            </div>
          ) : (
            <div className="hidden xl:flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 py-1.5 text-xs font-mono text-muted">
              <span className="h-2 w-2 rounded-full bg-muted/60" />
              <span>REPO WINDOW CLOSED</span>
            </div>
          )}
        </div>

        {/* Right: Master Solvency Badge, Theme Toggle & Audit Drawer */}
        <div className="flex items-center gap-2.5">
          {live.enabled && <ConnectionPill connection={live.connection} />}

          {source === "offline-fallback" && (
            <div
              data-testid="fallback-badge"
              className="flex items-center gap-1.5 rounded-xl border border-accent-gold/40 bg-accent-gold/15 px-3 py-1.5 text-xs font-bold text-accent-gold font-mono shadow-sm"
            >
              <AlertTriangle className="h-3.5 w-3.5 text-accent-gold" />
              <span>Offline fallback</span>
            </div>
          )}

          {/* Master Solvency Status Badge */}
          {solvencyStatus === "HEALTHY" ? (
            <div
              data-testid="decision-status-value"
              className="flex items-center gap-2 rounded-xl border border-accent-teal/35 bg-accent-teal/15 px-3 py-1.5 text-xs font-bold text-accent-teal shadow-sm"
            >
              <ShieldCheck className="h-4 w-4 text-accent-teal" />
              <span>HEALTHY</span>
              <span
                data-testid="mase-chip"
                className="hidden lg:inline font-mono text-[10px] text-accent-teal/80 font-normal"
              >
                · MASE: {mase?.toFixed(2) ?? "0.85"}
              </span>
              <span
                data-testid="confidence-chip"
                className="hidden lg:inline font-mono text-[10px] text-accent-teal/80 font-normal"
              >
                · VaR: {Math.round(confidence * 100)}% Conf.
              </span>
            </div>
          ) : solvencyStatus === "LOW_CONFIDENCE" ? (
            <div
              data-testid="decision-status-value"
              className="flex items-center gap-2 rounded-xl border border-accent-gold/40 bg-accent-gold/15 px-3 py-1.5 text-xs font-bold text-accent-gold shadow-sm"
            >
              <AlertTriangle className="h-4 w-4 text-accent-gold" />
              <span>LOW CONFIDENCE</span>
              <span
                data-testid="mase-chip"
                className="hidden lg:inline font-mono text-[10px] text-accent-gold/80 font-normal"
              >
                · MASE: {mase?.toFixed(2) ?? "1.35"}
              </span>
              <span
                data-testid="confidence-chip"
                className="hidden lg:inline font-mono text-[10px] text-accent-gold/80 font-normal"
              >
                · Buffer Expanded 1.5x
              </span>
            </div>
          ) : (
            <div
              data-testid="decision-status-value"
              className="flex items-center gap-2 rounded-xl border border-accent-crimson/50 bg-accent-crimson/20 px-3 py-1.5 text-xs font-bold text-accent-crimson shadow-sm animate-pulse"
            >
              <ShieldAlert className="h-4 w-4 text-accent-crimson" />
              <span>UNDER-RESERVED</span>
              {deficitAmountUsd > 0 && (
                <span className="hidden lg:inline font-mono text-[10px]">
                  · Deficit: ${deficitAmountUsd.toLocaleString()}
                </span>
              )}
            </div>
          )}

          {/* Quick Action Buttons */}
          <div className="hidden 2xl:flex items-center gap-1.5">
            {onTriggerSweep && (
              <Button
                size="sm"
                variant="primary"
                onClick={onTriggerSweep}
                className="text-xs h-8 px-3 font-semibold"
              >
                <Play className="mr-1 h-3 w-3 fill-current" />
                Sweep 17:00
              </Button>
            )}

            {onRunStressTest && (
              <Button
                variant="outline"
                size="sm"
                onClick={onRunStressTest}
                className="text-xs h-8 px-3 font-medium"
              >
                Stress Test
              </Button>
            )}

            {onExportAuditCsv && (
              <Button
                variant="outline"
                size="sm"
                onClick={onExportAuditCsv}
                className="text-xs h-8 px-2.5 text-muted hover:text-foreground"
                title="Export Audit CSV"
              >
                <Download className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>

          {/* Notification / Decision Audit Drawer trigger */}
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open Decision Audit Drawer"
            className="relative flex h-8 w-8 items-center justify-center rounded-xl border border-border bg-surface-2 text-muted hover:border-border-strong hover:text-foreground transition-all"
          >
            <Bell className="h-4 w-4" />
            {notifications.length > 0 && (
              <span
                data-testid="notification-dot"
                className="absolute top-1 right-1 h-2 w-2 rounded-full bg-accent-blue shadow-[0_0_6px_var(--accent-blue)]"
              />
            )}
          </button>

          {/* Theme Toggle */}
          <ThemeToggle className="h-8 w-8 rounded-xl border border-border bg-surface-2" />
        </div>
      </header>

      {/* Decision Audit Drawer Slide-over */}
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
                  className="rounded-lg p-1 text-muted hover:bg-surface-2 hover:text-foreground transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Event Feed */}
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
              <Button
                variant="outline"
                className="w-full text-xs font-semibold"
                onClick={() => setDrawerOpen(false)}
              >
                Close Audit Drawer
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
