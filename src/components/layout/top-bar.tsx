"use client";

import { Clock, Download, Play, ShieldAlert, ShieldCheck, AlertTriangle, Menu } from "lucide-react";
import { Button } from "@/components/ui/primitives";

interface TopBarProps {
  clockTimestamp?: string;
  isRepoWindowOpen?: boolean;
  isRepoMaturing?: boolean;
  solvencyStatus?: "HEALTHY" | "LOW_CONFIDENCE" | "UNDER_RESERVED";
  mase?: number | null;
  confidence?: number;
  deficitAmountUsd?: number;
  onTriggerSweep?: () => void;
  onRunStressTest?: () => void;
  onExportAuditCsv?: () => void;
  onToggleMobileNav?: () => void;
}

export function TopBar({
  clockTimestamp = "2026-01-01 17:00:00 UTC",
  isRepoWindowOpen = true,
  isRepoMaturing = false,
  solvencyStatus = "HEALTHY",
  mase = 0.85,
  confidence = 0.99,
  deficitAmountUsd = 0,
  onTriggerSweep,
  onRunStressTest,
  onExportAuditCsv,
  onToggleMobileNav,
}: TopBarProps) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-[#1E2536] bg-[#0B0E14]/90 px-4 lg:px-6 backdrop-blur">
      {/* Left: Mobile Nav toggle + Clock & Window */}
      <div className="flex items-center gap-3.5">
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleMobileNav}
          className="lg:hidden text-[#94A3B8] hover:text-[#F8FAFC]"
          aria-label="Open navigation menu"
        >
          <Menu className="h-5 w-5" />
        </Button>

        {/* Simulation Clock Readout */}
        <div className="flex items-center gap-2 rounded-lg bg-[#121620] border border-[#1E2536] px-3 py-1.5 font-mono text-xs text-[#F8FAFC]">
          <Clock className="h-3.5 w-3.5 text-[#38BDF8]" />
          <span className="font-medium tracking-tight">{clockTimestamp}</span>
        </div>

        {/* Overnight Repo Window Indicator */}
        {isRepoWindowOpen ? (
          <div className="hidden sm:flex items-center gap-2 rounded-lg bg-[#818CF8]/10 border border-[#818CF8]/30 px-3 py-1.5 text-xs font-semibold text-[#818CF8]">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#818CF8] opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#818CF8]" />
            </span>
            <span>REPO WINDOW OPEN (17:00 UTC)</span>
          </div>
        ) : isRepoMaturing ? (
          <div className="hidden sm:flex items-center gap-2 rounded-lg bg-[#22C55E]/10 border border-[#22C55E]/30 px-3 py-1.5 text-xs font-semibold text-[#22C55E]">
            <span className="h-2 w-2 rounded-full bg-[#22C55E]" />
            <span>REPO MATURING (08:00 UTC)</span>
          </div>
        ) : (
          <div className="hidden sm:flex items-center gap-2 rounded-lg bg-[#121620] border border-[#1E2536] px-3 py-1.5 text-xs font-mono text-[#94A3B8]">
            <span className="h-2 w-2 rounded-full bg-[#94A3B8]" />
            <span>REPO WINDOW CLOSED</span>
          </div>
        )}
      </div>

      {/* Right: Master Solvency Badge & Quick Actions */}
      <div className="flex items-center gap-3">
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
            className="flex items-center gap-2 rounded-lg bg-[#F59E0B]/15 border border-[#F59E0B]/40 px-3.5 py-1.5 text-xs font-bold text-[#F59E0B]"
          >
            <AlertTriangle className="h-4 w-4" />
            <span>LOW CONFIDENCE</span>
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
