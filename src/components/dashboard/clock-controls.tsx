"use client";

import { useState } from "react";
import { Pause, Play, RotateCcw, SkipForward, Radio } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { useLiveTreasury } from "@/components/providers/live-treasury-provider";
import { SPEED_PRESETS, useClockControls } from "@/hooks/use-clock";

/**
 * Controls for the shared dataset clock. Everything shown comes from the live clock document.
 * Buttons appear only for roles the server allows; the server enforces permissions regardless.
 */
export function ClockControls() {
  const { clock, connection, ticks } = useLiveTreasury();
  const controls = useClockControls();
  const [confirmReset, setConfirmReset] = useState(false);

  const status = clock?.status ?? "stopped";
  const applied = clock?.appliedHours ?? 0;
  const total = clock?.datasetLength ?? 8760;
  const speed = clock?.speedHoursPerMinute ?? 12;
  const completed = status === "completed";
  const running = status === "running";
  const waiting = !completed && !running && applied === 0 && ticks.length === 0;

  const speedValue = SPEED_PRESETS.some((p) => p.hoursPerMinute === speed) ? String(speed) : "custom";

  return (
    <section
      data-testid="clock-controls"
      aria-label="Dataset clock controls"
      className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2 text-xs"
    >
      <div className="flex items-center gap-2 font-mono">
        <span className="relative flex h-2 w-2">
          {running && (
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-teal opacity-75" />
          )}
          <span
            className={`relative inline-flex rounded-full h-2 w-2 ${
              running ? "bg-accent-teal" : completed ? "bg-accent-blue" : "bg-muted"
            }`}
          />
        </span>
        <Radio className={`h-3.5 w-3.5 ${running ? "text-accent-teal" : "text-muted"}`} aria-hidden />
        <span className="font-semibold text-foreground">Dataset clock</span>
        <span data-testid="clock-position" className="text-muted font-mono tabular-nums">
          hour {applied.toLocaleString("en-US")} / {total.toLocaleString("en-US")}
        </span>
        <span
          data-testid="clock-status"
          className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase font-mono tabular-nums ${
            running
              ? "border-accent-teal/40 bg-accent-teal/15 text-accent-teal"
              : "border-border text-muted"
          }`}
        >
          {completed ? "completed" : running ? "running" : "paused"}
        </span>
      </div>

      {connection === "offline" && (
        <span data-testid="clock-stale" className="font-mono text-[10px] text-accent-gold">
          Connection lost. Showing last known state.
        </span>
      )}

      {waiting && controls.canControl && (
        <span data-testid="clock-waiting" className="text-muted">
          Waiting for the clock to start.
        </span>
      )}
      {waiting && !controls.canControl && (
        <span data-testid="clock-waiting" className="text-muted">
          Waiting for an analyst to start the clock.
        </span>
      )}
      {completed && (
        <span data-testid="clock-completed" className="text-muted">
          The whole dataset has been streamed.
        </span>
      )}

      {controls.canControl && !completed && (
        <div className="flex flex-wrap items-center gap-1.5">
          {running ? (
            <Button size="sm" variant="outline" onClick={() => void controls.pause()} disabled={controls.busy} data-testid="clock-pause" className="h-7 gap-1 px-2.5 text-xs">
              <Pause className="h-3 w-3" /> Pause
            </Button>
          ) : (
            <Button size="sm" variant="primary" onClick={() => void controls.start()} disabled={controls.busy} data-testid="clock-start" className="h-7 gap-1 px-2.5 text-xs">
              <Play className="h-3 w-3 fill-current" /> {applied > 0 ? "Resume" : "Start"}
            </Button>
          )}
          {running && !controls.isDriver && (
            <Button size="sm" variant="outline" onClick={() => void controls.start()} disabled={controls.busy} data-testid="clock-takeover" className="h-7 px-2.5 text-xs" title="Drive the clock from this session">
              Take over
            </Button>
          )}
          {!running && (
            <Button size="sm" variant="outline" onClick={() => void controls.step()} disabled={controls.busy} data-testid="clock-step" className="h-7 gap-1 px-2.5 text-xs" title="Advance one dataset hour">
              <SkipForward className="h-3 w-3" /> +1 h
            </Button>
          )}
          <label className="flex items-center gap-1 text-muted">
            <span className="sr-only">Clock speed</span>
            <select
              data-testid="clock-speed"
              value={speedValue}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) void controls.setSpeed(v);
              }}
              disabled={controls.busy}
              className="h-7 rounded-md border border-border bg-surface px-1.5 font-mono text-[11px] text-foreground"
            >
              {speedValue === "custom" && <option value="custom">{speed} h/min</option>}
              {SPEED_PRESETS.map((p) => (
                <option key={p.hoursPerMinute} value={p.hoursPerMinute}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {controls.canReset && (applied > 0 || completed) && (
        <div className="ml-auto flex items-center gap-1.5">
          {confirmReset ? (
            <>
              <span className="text-accent-crimson">Remove all streamed data and restart at hour 0?</span>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  const ok = await controls.reset();
                  if (ok) setConfirmReset(false);
                }}
                disabled={controls.busy}
                data-testid="clock-reset-confirm"
                className="h-7 border-accent-crimson/40 px-2.5 text-xs text-accent-crimson"
              >
                Confirm reset
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmReset(false)} className="h-7 px-2 text-xs">
                Cancel
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirmReset(true)} data-testid="clock-reset" className="h-7 gap-1 px-2 text-xs text-muted">
              <RotateCcw className="h-3 w-3" /> Reset
            </Button>
          )}
        </div>
      )}

      {controls.error && (
        <p role="alert" data-testid="clock-error" className="basis-full font-mono text-[11px] text-accent-crimson">
          {controls.error}
        </p>
      )}
    </section>
  );
}
