"use client";

import { Panel } from "@/components/finance/panels";
import { Badge } from "@/components/ui/primitives";
import { Sliders } from "lucide-react";

export function StressSimulatorPanel() {
  return (
    <Panel
      title="Stress Scenario Simulator"
      description="Monte Carlo shock injection (Digital Twin)"
      headerAction={<Badge tone="neutral">Phase 18 — Planned</Badge>}
    >
      <div className="space-y-4 py-1">
        <p className="text-xs text-muted">
          Stress controls will allow parameterising liquidity shocks, settlement delays,
          and haircut stress once the simulator engine is implemented in Phase 18.
        </p>

        {/* Control 1: Outflow Shock */}
        <div className="space-y-1.5 opacity-60">
          <div className="flex items-center justify-between text-xs font-medium">
            <span className="text-foreground">Outflow Shock (0–50%)</span>
            <span className="font-mono text-muted">20% (disabled)</span>
          </div>
          <input
            type="range"
            min={0}
            max={50}
            defaultValue={20}
            disabled
            aria-label="Outflow Shock"
            className="w-full cursor-not-allowed accent-primary"
          />
          <div className="flex justify-between text-[10px] text-muted">
            <span>0% (Baseline)</span>
            <span>25%</span>
            <span>50% (Extreme)</span>
          </div>
        </div>

        {/* Control 2: Settlement Delay */}
        <div className="space-y-1.5 opacity-60">
          <div className="flex items-center justify-between text-xs font-medium">
            <span className="text-foreground">Settlement Delay (0–72h)</span>
            <span className="font-mono text-muted">0h (disabled)</span>
          </div>
          <input
            type="range"
            min={0}
            max={72}
            defaultValue={0}
            disabled
            aria-label="Settlement Delay"
            className="w-full cursor-not-allowed accent-primary"
          />
          <div className="flex justify-between text-[10px] text-muted">
            <span>Instant</span>
            <span>24h (T+1)</span>
            <span>72h (T+3)</span>
          </div>
        </div>

        {/* Control 3: Reserve Confidence */}
        <div className="space-y-1.5 opacity-60">
          <div className="flex items-center justify-between text-xs font-medium">
            <span className="text-foreground">Reserve Confidence</span>
            <span className="font-mono text-muted">99.0% (disabled)</span>
          </div>
          <input
            type="range"
            min={90}
            max={99.9}
            step={0.1}
            defaultValue={99.0}
            disabled
            aria-label="Reserve Confidence"
            className="w-full cursor-not-allowed accent-primary"
          />
          <div className="flex justify-between text-[10px] text-muted">
            <span>90.0% (alpha=0.10)</span>
            <span>95.0%</span>
            <span>99.9% (Basel III)</span>
          </div>
        </div>

        {/* Status footer */}
        <div className="flex items-center justify-between rounded-md border border-border/60 bg-surface-2/40 px-3 py-2 text-xs">
          <div className="flex items-center gap-2">
            <Sliders className="h-3.5 w-3.5 text-muted" />
            <span className="text-muted">Digital Twin Simulator</span>
          </div>
          <span className="font-mono text-[11px] text-muted">Inactive (P18)</span>
        </div>
      </div>
    </Panel>
  );
}
