"use client";

import { Clock, Download, Play, ShieldAlert, ShieldCheck, AlertTriangle, Menu } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { BrandLogo } from "@/components/brand/logo";

interface TopBarProps {
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
  onPlayToggle?: () => void;
  onStepHour?: () => void;
  onSpeedChange?: (speed: number) => void;
  onTriggerSweep?: () => void;
  onRunStressTest?: () => void;
  onExportAuditCsv?: () => void;
  onToggleMobileNav?: () => void;
}

export function TopBar({
  clockTimestamp = "2026-01-01 17:00:00 UTC",
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
  onPlayToggle,
  onStepHour,
  onSpeedChange,
  onTriggerSweep,
  onRunStressTest,
  onExportAuditCsv,
  onToggleMobileNav,
}: TopBarProps) {
  return (
    <header data-testid="top-bar" className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-[#1E2536] bg-[#0B0E14]/90 px-4 lg:px-6 backdrop-blur">
      {/* Left: Mobile Nav toggle + Clock & Replay Ticker */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleMobileNav}
          className="lg:hidden text-[#94A3B8] hover:text-[#F8FAFC]"
          aria-label="Open navigation menu"
        >
          <Menu className="h-5 w-5" />
        </Button>
        <BrandLogo size={30} className="lg:hidden" />

        {/* Simulation Clock Readout */}
        <div className="flex items-center gap-2 rounded-lg bg-[#121620] border border-[#1E2536] px-3 py-1.5 font-mono text-xs text-[#F8FAFC]">
          <Clock className="h-3.5 w-3.5 text-[#38BDF8]" />
          <span className="font-medium tracking-tight">{clockTimestamp}</span>
        </div>

        {/* Top Bar Replay Controls: Play/Pause, Step +1h, Speeds */}
        {onPlayToggle && (
          <div className="hidden sm:flex items-center gap-1 bg-[#121620] border border-[#1E2536] rounded-lg p-1">
            <button
              type="button"
              onClick={onPlayToggle}
              className={`flex items-center gap-1 rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
                isPlaying
                  ? "bg-[#EF4444]/20 text-[#EF4444] border border-[#EF4444]/30"
                  : "bg-[#A3E635] text-[#0B0E14] hover:bg-[#86efac]"
              }`}
            >
              {isPlaying ? (
                <>
                  <span className="h-2 w-2 rounded-full bg-[#EF4444] animate-pulse" />
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
                className="rounded px-2 py-1 text-xs font-mono text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-[#1E2536] transition-colors"
                title="Advance 1 Hour"
              >
                +1h
              </button>
            )}

            {onSpeedChange && (
              <div className="flex items-center border-l border-[#1E2536] pl-1 ml-1">
                {[1, 10, 60].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => onSpeedChange(s)}
                    className={`rounded px-1.5 py-0.5 text-[10px] font-mono font-bold transition-colors ${
                      playbackSpeed === s
                        ? "bg-[#38BDF8]/20 text-[#38BDF8]"
                        : "text-[#94A3B8] hover:text-[#F8FAFC]"
                    }`}
                  >
                    {s}x
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Overnight Repo Window Indicator with Flashing Badges */}
        {isRepoWindowOpen ? (
          <div className="hidden md:flex items-center gap-2 rounded-lg bg-[#818CF8]/15 border border-[#818CF8]/40 px-3 py-1.5 text-xs font-bold text-[#818CF8] animate-pulse">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#818CF8] opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#818CF8]" />
            </span>
            <span>REPO SWEEP WINDOW OPEN (17:00 UTC)</span>
          </div>
        ) : isRepoMaturing ? (
          <div className="hidden md:flex items-center gap-2 rounded-lg bg-[#22C55E]/20 border border-[#22C55E]/40 px-3 py-1.5 text-xs font-bold text-[#22C55E] animate-pulse">
            <span className="h-2 w-2 rounded-full bg-[#22C55E]" />
            <span>
              REPO MATURED: {repoMaturedYieldUsd != null ? `+$${repoMaturedYieldUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EARNED` : "—"}
            </span>
          </div>
        ) : (
          <div className="hidden md:flex items-center gap-2 rounded-lg bg-[#121620] border border-[#1E2536] px-3 py-1.5 text-xs font-mono text-[#94A3B8]">
            <span className="h-2 w-2 rounded-full bg-[#94A3B8]" />
            <span>REPO WINDOW CLOSED</span>
          </div>
        )}
      </div>


      {/* Right: Master Solvency Badge & Quick Actions */}
      <div className="flex items-center gap-3">
        {source === "offline-fallback" && (
          <div
            data-testid="fallback-badge"
            className="flex items-center gap-1.5 rounded-lg bg-amber-500/20 border border-amber-500/40 px-3 py-1.5 text-xs font-bold text-amber-300 font-mono shadow-[0_0_12px_rgba(245,158,11,0.2)]"
          >
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
            <span>Offline fallback</span>
          </div>
        )}

        {/* Master Solvency Status Badge */}
        {solvencyStatus === "HEALTHY" ? (
          <div
            data-testid="decision-status-value"
            className="flex items-center gap-2 rounded-lg bg-[#A3E635]/15 border border-[#A3E635]/40 px-3.5 py-1.5 text-xs font-bold text-[#A3E635] shadow-[0_0_12px_rgba(163,230,53,0.2)]"
          >
            <ShieldCheck className="h-4 w-4" />
            <span>HEALTHY</span>
            <span
              data-testid="mase-chip"
              className="hidden md:inline font-mono text-[10px] text-[#A3E635]/80 font-normal"
            >
              · MASE: {mase?.toFixed(2) ?? "0.85"}
            </span>
            <span
              data-testid="confidence-chip"
              className="hidden md:inline font-mono text-[10px] text-[#A3E635]/80 font-normal"
            >
              · VaR: {Math.round(confidence * 100)}% Conf.
            </span>
          </div>
        ) : solvencyStatus === "LOW_CONFIDENCE" ? (
          <div
            data-testid="decision-status-value"
            title="Warm-up period: needs 168 h of history"
            className="flex items-center gap-2 rounded-lg bg-[#F59E0B]/15 border border-[#F59E0B]/40 px-3.5 py-1.5 text-xs font-bold text-[#F59E0B] cursor-help"
          >
            <AlertTriangle className="h-4 w-4" />
            <span>LOW CONFIDENCE</span>
            <span
              title="Warm-up period: needs 168 h of history"
              className="hidden sm:inline font-mono text-[10px] text-[#F59E0B]/90 font-normal underline decoration-dotted"
            >
              (needs 168 h of history)
            </span>
            <span
              data-testid="mase-chip"
              className="hidden md:inline font-mono text-[10px] text-[#F59E0B]/80 font-normal"
            >
              · MASE: {mase?.toFixed(2) ?? "1.35"}
            </span>
            <span
              data-testid="confidence-chip"
              className="hidden md:inline font-mono text-[10px] text-[#F59E0B]/80 font-normal"
            >
              · Buffer Expanded 1.5x
            </span>
          </div>
        ) : (
          <div
            data-testid="decision-status-value"
            className="flex items-center gap-2 rounded-lg bg-[#EF4444]/20 border border-[#EF4444]/50 px-3.5 py-1.5 text-xs font-bold text-[#EF4444] animate-pulse"
          >
            <ShieldAlert className="h-4 w-4" />
            <span>UNDER-RESERVED</span>
            {deficitAmountUsd > 0 && (
              <span className="hidden md:inline font-mono text-[10px]">
                · Deficit: ${deficitAmountUsd.toLocaleString()}
              </span>
            )}
          </div>
        )}

        {/* Quick-action buttons */}
        <div className="hidden xl:flex items-center gap-2">
          {onTriggerSweep && (
            <Button
              size="sm"
              onClick={onTriggerSweep}
              className="bg-[#A3E635] text-[#0B0E14] font-semibold hover:bg-[#86efac] text-xs h-8 px-3 border-none"
            >
              <Play className="mr-1.5 h-3.5 w-3.5 fill-current" />
              Sweep 17:00
            </Button>
          )}

          {onRunStressTest && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRunStressTest}
              className="border-[#1E2536] bg-[#121620] text-[#F8FAFC] hover:bg-[#1A202C] text-xs h-8 px-3"
            >
              Stress Test
            </Button>
          )}

          {onExportAuditCsv && (
            <Button
              variant="outline"
              size="sm"
              onClick={onExportAuditCsv}
              className="border-[#1E2536] bg-[#121620] text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-[#1A202C] text-xs h-8 px-2.5"
              title="Export Audit CSV"
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
