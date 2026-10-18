"use client";

import { useState, useEffect, useRef } from "react";
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
  // Local states for sliders & speed if not controlled externally
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

  // Dollar impact of shock
  const shockDollarImpact = Math.round((totalCashUsd * outflowShock) / 100);

  return (
    <aside
      aria-label="Command Panel"
      className="flex flex-col gap-4 rounded-xl border border-[#1E2536] bg-[#121620] p-4 text-[#F8FAFC] shadow-xl"
    >
      {/* Panel Header */}
      <div className="flex items-center justify-between border-b border-[#1E2536] pb-3">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-[#A3E635]" />
          <h2 className="text-xs font-bold uppercase tracking-wider text-[#F8FAFC]">
            COMMAND & EXECUTION RAIL
          </h2>
        </div>
        <div className="flex items-center gap-1.5 font-mono text-[10px] text-[#A3E635]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#A3E635] animate-pulse" />
          <span>H{currentHour} REPLAY</span>
        </div>
      </div>

      {/* 1. Timeline Replay Controller */}
      <div className="space-y-3 rounded-lg bg-[#0B0E14] border border-[#1E2536] p-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-mono uppercase tracking-wider text-[#94A3B8]">
            Timeline Engine
          </span>
          <div className="flex items-center gap-1 font-mono text-[10px]">
            <span className="text-[#94A3B8]">Speed:</span>
            {[1, 10, 60].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => handleSpeedSelect(s)}
                className={`rounded px-1.5 py-0.5 font-bold transition-colors ${
                  speed === s
                    ? "bg-[#A3E635] text-[#0B0E14]"
                    : "bg-[#1E2536] text-[#94A3B8] hover:text-[#F8FAFC]"
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
            className={`flex-1 font-semibold text-xs h-8 border-none ${
              isPlaying
                ? "bg-[#EF4444] text-white hover:bg-red-600"
                : "bg-[#A3E635] text-[#0B0E14] hover:bg-[#86efac]"
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
            className="border-[#1E2536] bg-[#121620] text-[#F8FAFC] hover:bg-[#1A202C] text-xs h-8 px-2.5"
            title="Step Hour (+1h)"
          >
            <SkipForward className="h-3.5 w-3.5" />
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onReset}
            className="border-[#1E2536] bg-[#121620] text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-[#1A202C] text-xs h-8 px-2.5"
            title="Reset Simulation"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* 1-Click Crisis Presets */}
        <div className="pt-2 border-t border-[#1E2536]/80 space-y-1.5">
          <div className="text-[10px] font-mono text-[#94A3B8] uppercase flex items-center justify-between">
            <span>1-Click Crisis Presets:</span>
            <span className="text-[9px] text-[#A3E635]">BREAK THE BANK</span>
          </div>
          <div className="grid grid-cols-1 gap-1.5">
            <button
              type="button"
              onClick={() => {
                onJumpPreset?.(17, "Normal Business Day");
                onApplyPreset?.("normal");
              }}
              className="flex items-center justify-between rounded bg-[#121620] hover:bg-[#1A202C] px-2.5 py-1.5 text-left text-[11px] font-medium text-[#A3E635] border border-[#A3E635]/30 transition-colors"
            >
              <span>Normal Business Day</span>
              <span className="font-mono text-[10px] text-[#94A3B8]">0% Shock · Solvent</span>
            </button>
            <button
              type="button"
              onClick={() => {
                onJumpPreset?.(8, "Payday Morning Surge (08:00)");
                onApplyPreset?.("payday");
              }}
              className="flex items-center justify-between rounded bg-[#121620] hover:bg-[#1A202C] px-2.5 py-1.5 text-left text-[11px] font-medium text-[#38BDF8] border border-[#38BDF8]/30 transition-colors"
            >
              <span>Payday Morning Surge</span>
              <span className="font-mono text-[10px] text-[#38BDF8]">08:00 Inflow Surge</span>
            </button>
            <button
              type="button"
              onClick={() => {
                onJumpPreset?.(2, "Black Swan Liquidity Run");
                onApplyPreset?.("black_swan");
              }}
              className="flex items-center justify-between rounded bg-[#EF4444]/15 hover:bg-[#EF4444]/25 px-2.5 py-1.5 text-left text-[11px] font-medium text-[#EF4444] border border-[#EF4444]/40 transition-colors"
            >
              <span>Black Swan Liquidity Run</span>
              <span className="font-mono text-[10px] text-[#EF4444] font-bold">+45% Outflow Run</span>
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
      <div className="space-y-3 rounded-lg bg-[#0B0E14] border border-[#1E2536] p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-[#94A3B8]">
            <Sliders className="h-3.5 w-3.5 text-[#F59E0B]" />
            <span>Stress Sandbox</span>
          </div>
          <span className="rounded bg-[#F59E0B]/15 px-1.5 py-0.2 text-[9px] font-mono font-bold text-[#F59E0B]">
            LIVE SHOCK
          </span>
        </div>

        {/* Outflow Shock */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-[#94A3B8]">Outflow Surge:</span>
            <span className="font-mono font-bold text-[#EF4444] tabular-nums">
              +{outflowShock}%
              {shockDollarImpact > 0 && (
                <span className="ml-1 text-[10px] text-[#EF4444]/80">
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
            className="w-full h-1.5 bg-[#1E2536] rounded-lg appearance-none cursor-pointer accent-[#EF4444]"
          />
        </div>

        {/* Settlement Delay */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-[#94A3B8]">Settlement Delay:</span>
            <span className="font-mono font-bold text-[#F59E0B] tabular-nums">
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
            className="w-full h-1.5 bg-[#1E2536] rounded-lg appearance-none cursor-pointer accent-[#F59E0B]"
          />
        </div>

        {/* Market Volatility / Rate Spike Toggle */}
        <div className="pt-2 border-t border-[#1E2536]/80 flex items-center justify-between">
          <div>
            <div className="text-xs font-medium text-[#F8FAFC]">Rate Spike (+200bps)</div>
            <div className="text-[10px] text-[#94A3B8]">
              Bond haircut & equity volatility
            </div>
          </div>
          <button
            type="button"
            onClick={handleRateSpikeToggle}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
              rateSpike ? "bg-[#A3E635]" : "bg-[#1E2536]"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-[#0B0E14] shadow-lg ring-0 transition duration-200 ease-in-out ${
                rateSpike ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </button>
        </div>
      </div>

      {/* 3. Live Decision & Liquidation Stream (Audit Trail) */}
      <div className="flex-1 flex flex-col space-y-2 rounded-lg bg-[#0B0E14] border border-[#1E2536] p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-[#94A3B8]">
            <Activity className="h-3.5 w-3.5 text-[#38BDF8]" />
            <span>Audit Cascade Stream</span>
          </div>
          <span className="font-mono text-[9px] text-[#38BDF8] animate-pulse">
            LIVE SEC-256
          </span>
        </div>

        {/* Auto-scrolling Terminal Feed */}
        <div
          ref={terminalRef}
          className="h-48 overflow-y-auto space-y-2 rounded bg-[#07090D] border border-[#1E2536]/70 p-2 font-mono text-[11px] leading-relaxed scrollbar-thin scrollbar-thumb-[#1E2536]"
        >
          {auditLogs.map((log) => {
            const dotColor =
              log.type === "SWEEP"
                ? "bg-[#22C55E] shadow-[0_0_6px_#22C55E]" // Green dot
                : log.type === "MATURE"
                ? "bg-[#38BDF8] shadow-[0_0_6px_#38BDF8]" // Blue dot
                : log.type === "WARN"
                ? "bg-[#F59E0B] shadow-[0_0_6px_#F59E0B]" // Amber dot
                : log.type === "DEFICIT"
                ? "bg-[#EF4444] shadow-[0_0_6px_#EF4444]" // Red dot
                : "bg-[#94A3B8]";

            const badgeTextColor =
              log.type === "SWEEP"
                ? "text-[#22C55E]"
                : log.type === "MATURE"
                ? "text-[#38BDF8]"
                : log.type === "WARN"
                ? "text-[#F59E0B]"
                : log.type === "DEFICIT"
                ? "text-[#EF4444]"
                : "text-[#94A3B8]";

            return (
              <div
                key={log.id}
                className="flex items-start gap-2 border-b border-[#1E2536]/40 pb-1.5 last:border-none"
              >
                <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${dotColor}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[10px]">
                    <span className="text-[#94A3B8]">[{log.timestamp}]</span>
                    <span className={`font-bold ${badgeTextColor}`}>[{log.type}]</span>
                  </div>
                  <div className="text-[#F8FAFC] break-words text-[10.5px]">
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
