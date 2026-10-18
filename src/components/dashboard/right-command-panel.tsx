"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Play,
  Pause,
  SkipForward,
  RotateCcw,
  Sliders,
  Activity,
  Terminal,
} from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { formatCurrency } from "@/lib/money";

export interface RightCommandPanelProps {
  currentHour?: number;
  isPlaying?: boolean;
  onPlayToggle?: () => void;
  onStepHour?: () => void;
  onReset?: () => void;
  onSpeedChange?: (speed: number) => void;
  onJumpPreset?: (hour: number, name: string) => void;
  outflowShockPct?: number;
  onOutflowShockChange?: (val: number) => void;
  settlementDelayHours?: number;
  onSettlementDelayChange?: (val: number) => void;
  rateSpikeActive?: boolean;
  onRateSpikeToggle?: (active: boolean) => void;
  onApplyPreset?: (preset: "normal" | "payday" | "black_swan") => void;
  firstSweepHour?: number | null;
  firstLiquidationHour?: number | null;
  onJumpToFirstSweep?: () => void;
  onJumpToFirstLiquidation?: () => void;
  auditLogs?: Array<{
    id: string;
    timestamp: string;
    type: "SWEEP" | "MATURE" | "WARN" | "DEFICIT" | "INFO";
    message: string;
  }>;
  totalCashUsd?: number;
}

const DEFAULT_AUDIT_LOGS = [
  {
    id: "log-1",
    timestamp: "17:00:00",
    type: "SWEEP" as const,
    message: "$33.5M swept into Tier 1 Repo @ 4.29% APY",
  },
  {
    id: "log-2",
    timestamp: "08:00:00",
    type: "MATURE" as const,
    message: "Tier 1 Repo matured: +$2,450.12 interest credited",
  },
  {
    id: "log-3",
    timestamp: "14:00:00",
    type: "WARN" as const,
    message: "Volatility spike: VaR 99% increased required reserve to $18.2M",
  },
  {
    id: "log-4",
    timestamp: "02:15:00",
    type: "DEFICIT" as const,
    message: "Outflow surge detected. Auto-liquidated $2.1M from Tier 1 (0.5% fee). Avoided 12% emergency overdraft.",
  },
];

export function RightCommandPanel({
  currentHour = 17,
  isPlaying = false,
  onPlayToggle,
  onStepHour,
  onReset,
  onSpeedChange,
  onJumpPreset,
  outflowShockPct,
  onOutflowShockChange,
  settlementDelayHours,
  onSettlementDelayChange,
  rateSpikeActive,
  onRateSpikeToggle,
  onApplyPreset,
  firstSweepHour,
  firstLiquidationHour,
  onJumpToFirstSweep,
  onJumpToFirstLiquidation,
  auditLogs = DEFAULT_AUDIT_LOGS,
  totalCashUsd = 50_000_000,
}: RightCommandPanelProps) {
  const [speed, setSpeed] = useState<number>(10);
  const [localOutflowShock, setLocalOutflowShock] = useState<number>(0);
  const [localSettlementDelay, setLocalSettlementDelay] = useState<number>(0);
  const [localRateSpike, setLocalRateSpike] = useState<boolean>(false);
  const terminalRef = useRef<HTMLDivElement>(null);

  const outflowShock = outflowShockPct !== undefined ? outflowShockPct : localOutflowShock;
  const settlementDelay = settlementDelayHours !== undefined ? settlementDelayHours : localSettlementDelay;
  const rateSpike = rateSpikeActive !== undefined ? rateSpikeActive : localRateSpike;

  // Auto-scroll terminal to bottom when new logs arrive
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [auditLogs]);

  const handleSpeedSelect = (val: number) => {
    setSpeed(val);
    onSpeedChange?.(val);
  };

  const handleOutflowChange = (val: number) => {
    setLocalOutflowShock(val);
    onOutflowShockChange?.(val);
  };

  const handleSettlementChange = (val: number) => {
    setLocalSettlementDelay(val);
    onSettlementDelayChange?.(val);
  };

  const handleRateSpikeToggle = () => {
    const next = !rateSpike;
    setLocalRateSpike(next);
    onRateSpikeToggle?.(next);
  };

  const shockDollarImpact = Math.round((totalCashUsd * outflowShock) / 100);

  return (
    <aside
      aria-label="Command Panel"
      className="flex flex-col gap-4 rounded-2xl border border-border bg-surface/80 p-4 text-foreground shadow-2xl backdrop-blur-xl transition-all"
    >
      {/* Panel Header */}
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-accent-blue" />
          <h2 className="text-xs font-bold uppercase tracking-wider text-foreground">
            COMMAND & EXECUTION RAIL
          </h2>
        </div>
        <div className="flex items-center gap-1.5 font-mono text-[10px] text-accent-teal font-semibold">
          <span className="h-1.5 w-1.5 rounded-full bg-accent-teal animate-pulse" />
          <span>H{currentHour} REPLAY</span>
        </div>
      </div>

      {/* 1. Timeline Replay Controller */}
      <div className="space-y-3 rounded-xl bg-surface-2 border border-border p-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-mono uppercase tracking-wider text-muted font-semibold">
            Timeline Engine
          </span>
          <div className="flex items-center gap-1 font-mono text-[10px]">
            <span className="text-muted">Speed:</span>
            {[1, 10, 60].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => handleSpeedSelect(s)}
                className={`rounded px-1.5 py-0.5 font-bold transition-all ${
                  speed === s
                    ? "bg-accent-blue text-white shadow-sm"
                    : "bg-surface text-muted hover:text-foreground border border-border"
                }`}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>

        {/* Playback Controls */}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={onPlayToggle}
            className={`flex-1 font-semibold text-xs h-8 border-none transition-all ${
              isPlaying
                ? "bg-accent-crimson text-white hover:opacity-90"
                : "bg-accent-blue text-white hover:opacity-90"
            }`}
          >
            {isPlaying ? (
              <>
                <Pause className="mr-1.5 h-3.5 w-3.5 fill-current" /> Pause
              </>
            ) : (
              <>
                <Play className="mr-1.5 h-3.5 w-3.5 fill-current" /> Play
              </>
            )}
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onStepHour}
            className="border-border bg-surface text-foreground hover:bg-surface-raised text-xs h-8 px-2.5"
            title="Step Hour (+1h)"
          >
            <SkipForward className="h-3.5 w-3.5" />
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onReset}
            className="border-border bg-surface text-muted hover:text-foreground hover:bg-surface-raised text-xs h-8 px-2.5"
            title="Reset Simulation"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* 1-Click Crisis Presets */}
        <div className="pt-2 border-t border-border space-y-1.5">
          <div className="text-[10px] font-mono text-muted uppercase flex items-center justify-between font-semibold">
            <span>1-Click Crisis Presets:</span>
            <span className="text-[9px] text-accent-blue">STRESS ENGINE</span>
          </div>
          <div className="grid grid-cols-1 gap-1.5">
            <button
              type="button"
              onClick={() => {
                onJumpPreset?.(17, "Normal Business Day");
                onApplyPreset?.("normal");
              }}
              className="flex items-center justify-between rounded-lg bg-surface hover:bg-surface-raised px-2.5 py-1.5 text-left text-[11px] font-medium text-accent-teal border border-accent-teal/30 transition-all hover:scale-[1.01]"
            >
              <span>Normal Business Day</span>
              <span className="font-mono text-[10px] text-muted">0% Shock · Solvent</span>
            </button>
            <button
              type="button"
              onClick={() => {
                onJumpPreset?.(8, "Payday Morning Surge (08:00)");
                onApplyPreset?.("payday");
              }}
              className="flex items-center justify-between rounded-lg bg-surface hover:bg-surface-raised px-2.5 py-1.5 text-left text-[11px] font-medium text-accent-blue border border-accent-blue/30 transition-all hover:scale-[1.01]"
            >
              <span>Payday Morning Surge</span>
              <span className="font-mono text-[10px] text-accent-blue">08:00 Inflow Surge</span>
            </button>
            <button
              type="button"
              onClick={() => {
                onJumpPreset?.(2, "Black Swan Liquidity Run");
                onApplyPreset?.("black_swan");
              }}
              className="flex items-center justify-between rounded-lg bg-accent-crimson/10 hover:bg-accent-crimson/20 px-2.5 py-1.5 text-left text-[11px] font-medium text-accent-crimson border border-accent-crimson/30 transition-all hover:scale-[1.01]"
            >
              <span>Black Swan Liquidity Run</span>
              <span className="font-mono text-[10px] text-accent-crimson font-bold">+45% Outflow Run</span>
            </button>
            {onJumpToFirstSweep && (
              <button
                type="button"
                onClick={onJumpToFirstSweep}
                disabled={firstSweepHour == null}
                className={`flex items-center justify-between rounded bg-[#121620] px-2.5 py-1.5 text-left text-[11px] font-medium border transition-colors ${
                  firstSweepHour != null
                    ? "text-[#A3E635] border-[#A3E635]/30 hover:bg-[#1A202C]"
                    : "text-[#94A3B8]/40 border-[#1E2536] cursor-not-allowed"
                }`}
              >
                <span>Jump to first sweep</span>
                <span className="font-mono text-[10px]">
                  {firstSweepHour != null ? `H${firstSweepHour}` : "None"}
                </span>
              </button>
            )}
            {onJumpToFirstLiquidation && (
              <button
                type="button"
                onClick={onJumpToFirstLiquidation}
                disabled={firstLiquidationHour == null}
                className={`flex items-center justify-between rounded bg-[#121620] px-2.5 py-1.5 text-left text-[11px] font-medium border transition-colors ${
                  firstLiquidationHour != null
                    ? "text-[#F59E0B] border-[#F59E0B]/30 hover:bg-[#1A202C]"
                    : "text-[#94A3B8]/40 border-[#1E2536] cursor-not-allowed"
                }`}
              >
                <span>Jump to first liquidation</span>
                <span className="font-mono text-[10px]">
                  {firstLiquidationHour != null ? `H${firstLiquidationHour}` : "None"}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 2. Stress Sandbox Sliders */}
      <div className="space-y-3 rounded-xl bg-surface-2 border border-border p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-muted font-semibold">
            <Sliders className="h-3.5 w-3.5 text-accent-gold" />
            <span>Stress Sandbox</span>
          </div>
          <span className="rounded bg-accent-gold/15 px-1.5 py-0.5 text-[9px] font-mono font-bold text-accent-gold border border-accent-gold/30">
            LIVE SHOCK
          </span>
        </div>

        {/* Outflow Shock */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-muted">Outflow Surge:</span>
            <span className="font-mono font-bold text-accent-crimson tabular-nums">
              +{outflowShock}%
              {shockDollarImpact > 0 && (
                <span className="ml-1 text-[10px] text-accent-crimson/80">
                  (-{formatCurrency(shockDollarImpact)})
                </span>
              )}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={50}
            step={5}
            value={outflowShock}
            onChange={(e) => handleOutflowChange(Number(e.target.value))}
            className="w-full h-1.5 bg-surface rounded-lg appearance-none cursor-pointer accent-accent-crimson"
          />
        </div>

        {/* Settlement Delay */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-muted">Settlement Delay:</span>
            <span className="font-mono font-bold text-accent-gold tabular-nums">
              {settlementDelay} hours
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={72}
            step={6}
            value={settlementDelay}
            onChange={(e) => handleSettlementChange(Number(e.target.value))}
            className="w-full h-1.5 bg-surface rounded-lg appearance-none cursor-pointer accent-accent-gold"
          />
        </div>

        {/* Market Volatility / Rate Spike Toggle */}
        <div className="pt-2 border-t border-border flex items-center justify-between">
          <div>
            <div className="text-xs font-medium text-foreground">Rate Spike (+200bps)</div>
            <div className="text-[10px] text-muted">
              Bond haircut & equity volatility
            </div>
          </div>
          <button
            type="button"
            onClick={handleRateSpikeToggle}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
              rateSpike ? "bg-accent-blue" : "bg-surface border border-border"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-foreground shadow-lg ring-0 transition duration-200 ease-in-out ${
                rateSpike ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </button>
        </div>
      </div>

      {/* 3. Live Decision & Liquidation Stream (Audit Trail) */}
      <div className="flex-1 flex flex-col space-y-2 rounded-xl bg-surface-2 border border-border p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-muted font-semibold">
            <Activity className="h-3.5 w-3.5 text-accent-blue" />
            <span>Audit Cascade Stream</span>
          </div>
          <span className="font-mono text-[9px] text-accent-blue animate-pulse font-bold">
            LIVE SEC-256
          </span>
        </div>

        {/* Auto-scrolling Terminal Feed */}
        <div
          ref={terminalRef}
          className="h-48 overflow-y-auto space-y-2 rounded-lg bg-surface border border-border p-2.5 font-mono text-[11px] leading-relaxed scrollbar-thin"
        >
          {auditLogs.map((log) => {
            const dotColor =
              log.type === "SWEEP"
                ? "bg-accent-teal shadow-[0_0_8px_var(--accent-teal)]"
                : log.type === "MATURE"
                ? "bg-accent-blue shadow-[0_0_8px_var(--accent-blue)]"
                : log.type === "WARN"
                ? "bg-accent-gold shadow-[0_0_8px_var(--accent-gold)]"
                : log.type === "DEFICIT"
                ? "bg-accent-crimson shadow-[0_0_8px_var(--accent-crimson)]"
                : "bg-muted";

            const badgeTextColor =
              log.type === "SWEEP"
                ? "text-accent-teal"
                : log.type === "MATURE"
                ? "text-accent-blue"
                : log.type === "WARN"
                ? "text-accent-gold"
                : log.type === "DEFICIT"
                ? "text-accent-crimson"
                : "text-muted";

            return (
              <div
                key={log.id}
                className="flex items-start gap-2 border-b border-border/40 pb-1.5 last:border-none"
              >
                <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${dotColor}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[10px]">
                    <span className="text-muted tabular-nums">[{log.timestamp}]</span>
                    <span className={`font-bold ${badgeTextColor}`}>[{log.type}]</span>
                  </div>
                  <div className="text-foreground break-words text-[10.5px]">
                    {log.message}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
