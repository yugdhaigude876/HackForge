"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import {
  LayoutDashboard,
  TrendingUp,
  Layers,
  Activity,
  ScrollText,
  Settings,
  Sun,
  Moon,
  Zap,
  Play,
  RotateCcw,
} from "lucide-react";
import { useTheme } from "@/components/providers/theme-provider";

interface CommandPaletteProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onTriggerPreset?: (presetName: string) => void;
  onTriggerRunEngine?: () => void;
}

export function CommandPalette({
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  onTriggerPreset,
  onTriggerRunEngine,
}: CommandPaletteProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();

  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  
  const setOpen = useCallback(
    (action: boolean | ((prev: boolean) => boolean)) => {
      if (isControlled && controlledOnOpenChange) {
        const nextVal = typeof action === "function" ? action(controlledOpen ?? false) : action;
        controlledOnOpenChange(nextVal);
      } else {
        setInternalOpen(action);
      }
    },
    [isControlled, controlledOnOpenChange, controlledOpen]
  );

  // Listen to ⌘K or Ctrl+K globally
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setOpen]);

  const handleNavigate = (path: string) => {
    setOpen(false);
    router.push(path);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 sm:pt-32 p-4 bg-black/60 backdrop-blur-sm transition-all"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-[20px] border border-border-strong bg-surface-card p-0 shadow-2xl backdrop-blur-2xl animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <Command
          className="flex flex-col w-full text-foreground"
          loop
        >
          {/* Search Input */}
          <div className="flex items-center border-b border-border px-4 py-3">
            <Command.Input
              autoFocus
              placeholder="Type a command, search pages, or run simulation presets..."
              className="w-full bg-transparent text-sm font-medium text-foreground outline-none placeholder:text-muted"
            />
            <kbd className="hidden sm:inline-flex items-center rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted">
              ESC
            </kbd>
          </div>

          {/* Results List */}
          <Command.List className="max-h-80 overflow-y-auto p-2 text-xs">
            <Command.Empty className="py-6 text-center text-xs text-muted">
              No matching commands or navigation targets found.
            </Command.Empty>

            {/* Navigation Group */}
            <Command.Group heading="Navigation Workspaces" className="px-2 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted">
              <Command.Item
                onSelect={() => handleNavigate("/dashboard")}
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium cursor-pointer aria-selected:bg-primary aria-selected:text-white transition-colors"
              >
                <LayoutDashboard className="h-4 w-4" />
                <span>Overview & Live Dashboard</span>
              </Command.Item>
              <Command.Item
                onSelect={() => handleNavigate("/forecast")}
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium cursor-pointer aria-selected:bg-primary aria-selected:text-white transition-colors"
              >
                <TrendingUp className="h-4 w-4" />
                <span>Cash Flow Forecast & 99% VaR</span>
              </Command.Item>
              <Command.Item
                onSelect={() => handleNavigate("/optimizer")}
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium cursor-pointer aria-selected:bg-primary aria-selected:text-white transition-colors"
              >
                <Layers className="h-4 w-4" />
                <span>4-Tier Yield Vaults & Optimizer</span>
              </Command.Item>
              <Command.Item
                onSelect={() => handleNavigate("/reserve")}
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium cursor-pointer aria-selected:bg-primary aria-selected:text-white transition-colors"
              >
                <Layers className="h-4 w-4" />
                <span>Liquid Reserve Determination</span>
              </Command.Item>
              <Command.Item
                onSelect={() => handleNavigate("/twin")}
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium cursor-pointer aria-selected:bg-primary aria-selected:text-white transition-colors"
              >
                <Activity className="h-4 w-4" />
                <span>Liquidity Digital Twin (Monte Carlo)</span>
              </Command.Item>
              <Command.Item
                onSelect={() => handleNavigate("/audit")}
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium cursor-pointer aria-selected:bg-primary aria-selected:text-white transition-colors"
              >
                <ScrollText className="h-4 w-4" />
                <span>Audit & Compliance Trail</span>
              </Command.Item>
              <Command.Item
                onSelect={() => handleNavigate("/settings")}
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium cursor-pointer aria-selected:bg-primary aria-selected:text-white transition-colors"
              >
                <Settings className="h-4 w-4" />
                <span>System Settings & Personas</span>
              </Command.Item>
            </Command.Group>

            {/* Quick Actions Group */}
            <Command.Group heading="Terminal Actions" className="mt-2 px-2 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted border-t border-border/60">
              <Command.Item
                onSelect={() => {
                  toggleTheme();
                  setOpen(false);
                }}
                className="flex items-center justify-between rounded-lg px-3 py-2 text-xs font-medium cursor-pointer aria-selected:bg-primary aria-selected:text-white transition-colors"
              >
                <div className="flex items-center gap-3">
                  {theme === "dark" ? <Sun className="h-4 w-4 text-warning" /> : <Moon className="h-4 w-4 text-primary" />}
                  <span>Switch to {theme === "dark" ? "Light Mode" : "Dark Mode"}</span>
                </div>
                <span className="font-mono text-[10px] opacity-75">Theme</span>
              </Command.Item>

              {onTriggerRunEngine && (
                <Command.Item
                  onSelect={() => {
                    setOpen(false);
                    onTriggerRunEngine();
                  }}
                  className="flex items-center justify-between rounded-lg px-3 py-2 text-xs font-medium cursor-pointer aria-selected:bg-primary aria-selected:text-white transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Play className="h-4 w-4 text-positive" />
                    <span>Run Engine Optimization</span>
                  </div>
                  <span className="font-mono text-[10px] opacity-75">Action</span>
                </Command.Item>
              )}
            </Command.Group>

            {/* Simulation Crisis Presets */}
            <Command.Group heading="Crisis Presets" className="mt-2 px-2 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted border-t border-border/60">
              <Command.Item
                onSelect={() => {
                  setOpen(false);
                  onTriggerPreset?.("Standard Day Baseline");
                  router.push("/dashboard");
                }}
                className="flex items-center justify-between rounded-lg px-3 py-2 text-xs font-medium cursor-pointer aria-selected:bg-primary aria-selected:text-white transition-colors"
              >
                <div className="flex items-center gap-3">
                  <RotateCcw className="h-4 w-4 text-primary" />
                  <span>Standard Day Baseline (00:00 UTC)</span>
                </div>
                <span className="font-mono text-[10px] opacity-75">Preset</span>
              </Command.Item>

              <Command.Item
                onSelect={() => {
                  setOpen(false);
                  onTriggerPreset?.("Payday Inflow Spike");
                  router.push("/dashboard");
                }}
                className="flex items-center justify-between rounded-lg px-3 py-2 text-xs font-medium cursor-pointer aria-selected:bg-primary aria-selected:text-white transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Zap className="h-4 w-4 text-positive" />
                  <span>Morning Payday Surge (08:00 UTC)</span>
                </div>
                <span className="font-mono text-[10px] opacity-75">Preset</span>
              </Command.Item>

              <Command.Item
                onSelect={() => {
                  setOpen(false);
                  onTriggerPreset?.("Black Swan Run");
                  router.push("/twin");
                }}
                className="flex items-center justify-between rounded-lg px-3 py-2 text-xs font-medium cursor-pointer aria-selected:bg-primary aria-selected:text-white transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Zap className="h-4 w-4 text-negative" />
                  <span>Black Swan Bank-Run Tail Stress</span>
                </div>
                <span className="font-mono text-[10px] opacity-75">Preset</span>
              </Command.Item>
            </Command.Group>
          </Command.List>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-border px-4 py-2 text-[10px] text-muted font-mono">
            <span>Navigation: ↑ ↓ Enter</span>
            <span>Close: Esc</span>
          </div>
        </Command>
      </div>
    </div>
  );
}
