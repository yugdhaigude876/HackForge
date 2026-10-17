"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Play, Pause, ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { Button, Badge } from "@/components/ui/primitives";
import { formatMinor, formatCompactMinor } from "@/lib/money";

export interface CashPointDTO {
  hour: number;
  p5CashMinor: string;
  medianCashMinor: string;
  p95CashMinor: string;
}

export interface TwinReplayScrubberProps {
  horizonHours: number;
  currentHour: number;
  onHourChange: (hour: number) => void;
  policyCashPaths: Record<string, CashPointDTO[]>;
  scenario?: {
    shockStartHour?: number;
    shockDurationHours?: number;
    outflowShockPct?: number;
    settlementDelayHours?: number;
  };
}

const POLICY_DISPLAY: Record<string, { label: string; colorClass: string }> = {
  "reserve-juggler": { label: "Reserve Juggler", colorClass: "text-[var(--policy-juggler)]" },
  "hold-all-cash": { label: "Hold All Cash", colorClass: "text-[var(--policy-cash)]" },
  "fixed-buffer": { label: "Fixed Buffer", colorClass: "text-[var(--policy-buffer)]" },
};

export function TwinReplayScrubber({
  horizonHours,
  currentHour,
  onHourChange,
  policyCashPaths,
  scenario,
}: TwinReplayScrubberProps) {
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Playback timer (advances 1 hour every 800ms)
  useEffect(() => {
    if (!isPlaying) return;

    const timer = setInterval(() => {
      onHourChange((currentHour + 1) > horizonHours ? 0 : currentHour + 1);
    }, 800);

    return () => clearInterval(timer);
  }, [isPlaying, currentHour, horizonHours, onHourChange]);

  const handleStepBack = useCallback(() => {
    setIsPlaying(false);
    onHourChange(Math.max(0, currentHour - 1));
  }, [currentHour, onHourChange]);

  const handleStepForward = useCallback(() => {
    setIsPlaying(false);
    onHourChange(Math.min(horizonHours, currentHour + 1));
  }, [currentHour, horizonHours, onHourChange]);

  const handleReset = useCallback(() => {
    setIsPlaying(false);
    onHourChange(0);
  }, [onHourChange]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        handleStepBack();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        handleStepForward();
      } else if (e.key === " ") {
        e.preventDefault();
        setIsPlaying((prev) => !prev);
      }
    },
    [handleStepBack, handleStepForward]
  );

  // Determine active stress condition at currentHour
  const shockStart = scenario?.shockStartHour ?? 0;
  const shockDuration = scenario?.shockDurationHours ?? horizonHours;
  const shockEnd = shockStart + shockDuration;
  const isShockActive = currentHour >= shockStart && currentHour <= shockEnd && (scenario?.outflowShockPct ?? 0) > 0;
  const isDelayActive = (scenario?.settlementDelayHours ?? 0) > 0;

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="space-y-4 rounded-lg border border-border bg-surface p-4 focus:outline-none focus:ring-1 focus:ring-primary/40"
      aria-label="Scenario Replay Controller"
      data-testid="twin-replay-scrubber"
    >
      {/* Top Header & Playback Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-foreground">Timeline Replay</span>
          <span className="text-xs font-mono font-medium text-muted tabular">
            Hour t = {currentHour}h / {horizonHours}h
          </span>
          {isShockActive ? (
            <Badge tone="warning">Outflow Shock Active (+{scenario?.outflowShockPct}%)</Badge>
          ) : isDelayActive ? (
            <Badge tone="info">Settlement Delay Active</Badge>
          ) : (
            <Badge tone="neutral">Standard Flow</Badge>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            onClick={handleReset}
            title="Reset to Hour 0"
            aria-label="Reset to Hour 0"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleStepBack}
            disabled={currentHour <= 0}
            title="Step Back 1 Hour (Left Arrow)"
            aria-label="Step Back 1 Hour"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => setIsPlaying((p) => !p)}
            title={isPlaying ? "Pause (Space)" : "Play Replay (Space)"}
            aria-label={isPlaying ? "Pause Timeline Replay" : "Play Timeline Replay"}
            data-testid="replay-play-pause-btn"
          >
            {isPlaying ? (
              <>
                <Pause className="h-3.5 w-3.5 mr-1" /> Pause
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5 mr-1" /> Play
              </>
            )}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleStepForward}
            disabled={currentHour >= horizonHours}
            title="Step Forward 1 Hour (Right Arrow)"
            aria-label="Step Forward 1 Hour"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Range Slider Scrubber */}
      <div className="space-y-1">
        <input
          type="range"
          min={0}
          max={horizonHours}
          step={1}
          value={currentHour}
          onChange={(e) => {
            setIsPlaying(false);
            onHourChange(Number(e.target.value));
          }}
          className="w-full accent-primary cursor-pointer"
          aria-label="Timeline Scrubber Slider"
          data-testid="replay-slider"
        />
        <div className="flex justify-between text-[10px] text-muted font-mono">
          <span>0h (t=0)</span>
          <span>{Math.round(horizonHours / 2)}h</span>
          <span>{horizonHours}h (Horizon)</span>
        </div>
      </div>

      {/* Readouts at Current Hour across All Policies */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1 border-t border-border/60">
        {Object.entries(policyCashPaths).map(([policyKey, points]) => {
          const pt = points[currentHour];
          const display = POLICY_DISPLAY[policyKey] ?? {
            label: policyKey,
            colorClass: "text-foreground",
          };
          const medianVal = pt ? BigInt(pt.medianCashMinor) : 0n;
          const p5Val = pt ? BigInt(pt.p5CashMinor) : 0n;
          const p95Val = pt ? BigInt(pt.p95CashMinor) : 0n;
          const isNegative = medianVal < 0n;

          return (
            <div
              key={policyKey}
              className="rounded-lg border border-border/80 bg-surface-2/40 p-2.5 space-y-1"
            >
              <div className="flex items-center justify-between text-xs">
                <span className={`font-semibold ${display.colorClass}`}>{display.label}</span>
                {isNegative ? (
                  <Badge tone="negative">Deficit</Badge>
                ) : (
                  <span className="text-[10px] text-muted font-mono">Liquid</span>
                )}
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-muted">Median Cash:</span>
                <span className="tabular font-semibold text-sm text-foreground">
                  {formatMinor(medianVal)}
                </span>
              </div>
              <div className="flex items-baseline justify-between text-[11px] text-muted">
                <span>p5 – p95:</span>
                <span className="tabular">
                  {formatCompactMinor(p5Val)} – {formatCompactMinor(p95Val)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
