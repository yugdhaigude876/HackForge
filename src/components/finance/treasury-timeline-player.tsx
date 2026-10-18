"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  AlertTriangle,
  Clock,
  Layers,
  Percent,
} from "lucide-react";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { Button } from "@/components/ui/primitives";
import { formatCompactMinor } from "@/lib/money";
import type {
  TimelineSimulationResult,
  TimelineFrame,
  TimelinePolicy,
} from "@/engine/simulator";

interface TreasuryTimelinePlayerProps {
  onFrameChange?: (frame: TimelineFrame) => void;
}

export function TreasuryTimelinePlayer({ onFrameChange }: TreasuryTimelinePlayerProps) {
  // Simulation configuration state
  const [maxHours, setMaxHours] = useState<number>(168);
  const [policy, setPolicy] = useState<TimelinePolicy>("reserve-juggler");
  const initialCashUsd = 50_000_000;
  const operationalFloorUsd = 5_000_000;

  // Stress sliders
  const [outflowShockPct, setOutflowShockPct] = useState<number>(0);
  const [settlementLagHours, setSettlementLagHours] = useState<number>(0);
  const [rateShiftBps, setRateShiftBps] = useState<number>(0);
  const [equityDrawdownShockPct, setEquityDrawdownShockPct] = useState<number>(0);
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);

  // Playback state
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(5); // steps per second
  const playTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Simulation execution results
  const [simResult, setSimResult] = useState<TimelineSimulationResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Fetch simulation data on configuration change
  useEffect(() => {
    let ignore = false;

    const fetchSimulationData = async () => {
      setIsLoading(true);
      try {
        const res = await fetch("/api/engine/replay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            maxHours,
            policy,
            initialCashUsd,
            operationalFloorUsd,
            outflowShockPct,
            settlementLagHours,
            rateShiftBps,
            equityDrawdownShockPct,
            subsampleStep: 1,
          }),
        });

        if (!ignore && res.ok) {
          const json = await res.json();
          if (json.ok && json.data) {
            setSimResult(json.data);
            setCurrentStep(0);
          }
        }
      } catch (err) {
        console.error("[TimelinePlayer] Simulation fetch failed:", err);
      } finally {
        if (!ignore) {
          setIsLoading(false);
        }
      }
    };

    fetchSimulationData();

    return () => {
      ignore = true;
    };
  }, [
    maxHours,
    policy,
    outflowShockPct,
    settlementLagHours,
    rateShiftBps,
    equityDrawdownShockPct,
    refreshTrigger,
  ]);

  const executeSimulation = useCallback(() => {
    setRefreshTrigger((prev) => prev + 1);
  }, []);

  // Current active frame
  const currentFrame = useMemo<TimelineFrame | null>(() => {
    if (!simResult || !simResult.frames || simResult.frames.length === 0) return null;
    const idx = Math.min(Math.max(0, currentStep), simResult.frames.length - 1);
    return simResult.frames[idx];
  }, [simResult, currentStep]);

  // Notify parent on frame change
  useEffect(() => {
    if (currentFrame && onFrameChange) {
      onFrameChange(currentFrame);
    }
  }, [currentFrame, onFrameChange]);

  // Playback loop
  useEffect(() => {
    if (isPlaying && simResult && simResult.frames.length > 0) {
      const intervalMs = Math.max(20, Math.floor(1000 / playbackSpeed));
      playTimerRef.current = setInterval(() => {
        setCurrentStep((prev) => {
          if (prev >= simResult.frames.length - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, intervalMs);
    } else {
      if (playTimerRef.current) {
        clearInterval(playTimerRef.current);
        playTimerRef.current = null;
      }
    }

    return () => {
      if (playTimerRef.current) {
        clearInterval(playTimerRef.current);
      }
    };
  }, [isPlaying, simResult, playbackSpeed]);

  // Chart data: current window up to currentStep (or surrounding window)
  const chartData = useMemo(() => {
    if (!simResult || !simResult.frames) return [];
    // Display past 48 hours up to current step, plus 24 hours future
    const windowStart = Math.max(0, currentStep - 36);
    const windowEnd = Math.min(simResult.frames.length, currentStep + 12);

    return simResult.frames.slice(windowStart, windowEnd).map((f) => {
      const p = f.portfolio;
      const cashMinor = BigInt(p.tier0Cash.amountMinor || "0");
      const reserveMinor = BigInt(f.requiredReserveMinor || "0");

      return {
        hour: `H${f.hourIndex}`,
        timestamp: f.timestamp.slice(11, 16),
        deposits: Math.round(f.depositsUsd / 1000),
        withdrawals: Math.round(f.withdrawalsUsd / 1000),
        netFlow: Math.round(f.netFlowUsd / 1000),
        cashBalance: Math.round(Number(cashMinor) / 100_000),
        requiredReserve: Math.round(Number(reserveMinor) / 100_000),
        isCurrent: f.hourIndex === currentFrame?.hourIndex,
      };
    });
  }, [simResult, currentStep, currentFrame]);

  // Step controls
  const handlePlayPause = () => setIsPlaying((prev) => !prev);
  const handleStepBack = () => {
    setIsPlaying(false);
    setCurrentStep((prev) => Math.max(0, prev - 1));
  };
  const handleStepForward = () => {
    setIsPlaying(false);
    if (simResult) {
      setCurrentStep((prev) => Math.min(simResult.frames.length - 1, prev + 1));
    }
  };
  const handleReset = () => {
    setIsPlaying(false);
    setCurrentStep(0);
  };

  const p = currentFrame?.portfolio;
  const cashMinor = p ? BigInt(p.tier0Cash.amountMinor || "0") : 0n;
  const repoMinor = p ? BigInt(p.tier1RepoPrincipal.amountMinor || "0") : 0n;
  const bondsMinor = p ? BigInt(p.tier2BondsMarketValue.amountMinor || "0") : 0n;
  const equitiesMinor = p ? BigInt(p.tier3EquitiesMarketValue.amountMinor || "0") : 0n;
  const overdraftMinor = p ? BigInt(p.emergencyOverdraftBalance.amountMinor || "0") : 0n;
  const totalMinor = p ? BigInt(p.totalAssets.amountMinor || "0") : 0n;
  const reserveMinor = currentFrame ? BigInt(currentFrame.requiredReserveMinor || "0") : 0n;
  const surplusMinor = currentFrame ? BigInt(currentFrame.deployableSurplusMinor || "0") : 0n;

  const totalGross = Number(cashMinor + repoMinor + bondsMinor + equitiesMinor);
  const cashPct = totalGross > 0 ? Math.round((Number(cashMinor) / totalGross) * 100) : 0;
  const repoPct = totalGross > 0 ? Math.round((Number(repoMinor) / totalGross) * 100) : 0;
  const bondsPct = totalGross > 0 ? Math.round((Number(bondsMinor) / totalGross) * 100) : 0;
  const equitiesPct = totalGross > 0 ? Math.round((Number(equitiesMinor) / totalGross) * 100) : 0;

  return (
    <div className="space-y-6" data-testid="treasury-timeline-player">
      {/* Top Controller Bar */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <h3 className="text-base font-semibold text-[var(--color-ink)]">
                4-Tier Treasury Timeline Engine
              </h3>
              <span className="rounded-md bg-sky-500/10 px-2 py-0.5 text-xs font-medium text-sky-400 border border-sky-500/20">
                Official Benchmark (8,760h)
              </span>
            </div>
            <p className="mt-1 text-xs text-[var(--color-muted)]">
              Step through 8,760 continuous hours with clock-aware 17:00 UTC Repo sweeps and Basel III dynamic reserve sizing.
            </p>
          </div>

          {/* Quick Config Selectors */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
              <span>Horizon:</span>
              <select
                aria-label="Simulation Horizon"
                value={maxHours}
                onChange={(e) => setMaxHours(Number(e.target.value))}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1.5 text-xs text-[var(--color-ink)] focus:outline-none focus:ring-1 focus:ring-sky-500"
              >
                <option value={168}>1 Week (168h)</option>
                <option value={720}>1 Month (720h)</option>
                <option value={2160}>1 Quarter (2,160h)</option>
                <option value={8760}>Full Year (8,760h)</option>
              </select>
            </div>

            <div className="flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
              <span>Policy:</span>
              <select
                aria-label="Treasury Policy"
                value={policy}
                onChange={(e) => setPolicy(e.target.value as TimelinePolicy)}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1.5 text-xs text-[var(--color-ink)] focus:outline-none focus:ring-1 focus:ring-sky-500"
              >
                <option value="reserve-juggler">Reserve Juggler (Dynamic Basel III)</option>
                <option value="hold-all-cash">Hold All Cash (0% Yield)</option>
                <option value="fixed-buffer">Fixed Buffer ($5M Floor)</option>
              </select>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={executeSimulation}
              disabled={isLoading}
              className="text-xs"
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Re-run
            </Button>
          </div>
        </div>

        {/* Playback Controls & Scrubber Slider */}
        <div className="mt-5 pt-4 border-t border-[var(--color-border)] flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleStepBack}
              disabled={currentStep <= 0}
              title="Step Backward (1 hour)"
            >
              <SkipBack className="h-4 w-4" />
            </Button>

            <Button
              variant="primary"
              size="sm"
              onClick={handlePlayPause}
              className="min-w-[90px]"
            >
              {isPlaying ? (
                <>
                  <Pause className="mr-1.5 h-4 w-4" /> Pause
                </>
              ) : (
                <>
                  <Play className="mr-1.5 h-4 w-4" /> Play
                </>
              )}
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleStepForward}
              disabled={Boolean(simResult && currentStep >= simResult.frames.length - 1)}
              title="Step Forward (1 hour)"
            >
              <SkipForward className="h-4 w-4" />
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleReset}
              title="Reset to Hour 0"
            >
              <RotateCcw className="h-4 w-4" />
            </Button>

            {/* Playback Speed Selector */}
            <div className="ml-3 flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
              <span>Speed:</span>
              <select
                aria-label="Playback Speed"
                value={playbackSpeed}
                onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
                className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs"
              >
                <option value={1}>1x (1s/hr)</option>
                <option value={5}>5x (200ms/hr)</option>
                <option value={20}>20x (50ms/hr)</option>
                <option value={50}>50x (20ms/hr)</option>
              </select>
            </div>
          </div>

          {/* Time & Clock Readout */}
          <div className="flex items-center gap-3 font-mono text-xs text-[var(--color-ink)]">
            <div className="flex items-center gap-1.5 rounded-md bg-[var(--color-bg)] px-3 py-1.5 border border-[var(--color-border)]">
              <Clock className="h-3.5 w-3.5 text-sky-400" />
              <span>Hour {currentFrame?.hourIndex ?? 0}</span>
              <span className="text-[var(--color-muted)]">/ {maxHours}</span>
            </div>

            <div className="rounded-md bg-[var(--color-bg)] px-3 py-1.5 border border-[var(--color-border)]">
              <span>{currentFrame?.timestamp ?? "2026-01-01T00:00:00Z"}</span>
            </div>

            {/* Clock Special Event Badges */}
            {currentFrame?.timestamp.includes("T17:00:00") && (
              <span className="rounded bg-amber-500/20 px-2 py-1 text-xs font-semibold text-amber-300 border border-amber-500/30">
                17:00 UTC Repo Sweep Open
              </span>
            )}
            {currentFrame?.timestamp.includes("T08:00:00") && (
              <span className="rounded bg-emerald-500/20 px-2 py-1 text-xs font-semibold text-emerald-300 border border-emerald-500/30">
                08:00 UTC Repo Matured
              </span>
            )}
          </div>
        </div>

        {/* Interactive Timeline Scrubber Slider */}
        <div className="mt-4">
          <input
            type="range"
            aria-label="Timeline Scrubber"
            min={0}
            max={Math.max(1, (simResult?.frames.length ?? maxHours) - 1)}
            value={currentStep}
            onChange={(e) => {
              setIsPlaying(false);
              setCurrentStep(Number(e.target.value));
            }}
            className="w-full h-2 bg-[var(--color-border)] rounded-lg appearance-none cursor-pointer accent-sky-500"
          />
          <div className="flex justify-between text-[10px] text-[var(--color-muted)] mt-1 font-mono">
            <span>{simResult?.summary.startTimestamp ?? "Start: Jan 1"}</span>
            <span>Current: Hour {currentStep}</span>
            <span>{simResult?.summary.endTimestamp ?? `End: Hour ${maxHours}`}</span>
          </div>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Card 1: Total Net Assets */}
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
          <div className="flex items-center justify-between text-xs text-[var(--color-muted)]">
            <span>Total Net Assets</span>
            <TrendingUp className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-[var(--color-ink)]">
            {formatCompactMinor(totalMinor)}
          </div>
          <div className="mt-1 flex items-center justify-between text-xs">
            <span className="text-[var(--color-muted)]">Initial: {formatCompactMinor(BigInt(initialCashUsd) * 100n)}</span>
            <span className={Number(totalMinor) >= initialCashUsd * 100 ? "text-emerald-400 font-mono" : "text-rose-400 font-mono"}>
              {simResult?.summary.annualizedNetReturnPct ?? 0}% APY
            </span>
          </div>
        </div>

        {/* Card 2: Cash vs Basel III Reserve */}
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
          <div className="flex items-center justify-between text-xs text-[var(--color-muted)]">
            <span>Cash Buffer (Tier 0)</span>
            {currentFrame?.liquidityStatus === "HEALTHY" ? (
              <span className="inline-flex items-center gap-1 text-emerald-400 text-xs">
                <ShieldCheck className="h-3.5 w-3.5" /> Healthy
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-rose-400 text-xs">
                <ShieldAlert className="h-3.5 w-3.5" /> {currentFrame?.liquidityStatus}
              </span>
            )}
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-[var(--color-ink)]">
            {formatCompactMinor(cashMinor)}
          </div>
          <div className="mt-1 flex items-center justify-between text-xs text-[var(--color-muted)]">
            <span>Basel III Reserve R:</span>
            <span className="font-mono text-amber-400 font-medium">{formatCompactMinor(reserveMinor)}</span>
          </div>
        </div>

        {/* Card 3: Deployable Surplus */}
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
          <div className="flex items-center justify-between text-xs text-[var(--color-muted)]">
            <span>Deployable Surplus (C - R)</span>
            <Layers className="h-4 w-4 text-sky-400" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-sky-400">
            {formatCompactMinor(surplusMinor)}
          </div>
          <div className="mt-1 flex items-center justify-between text-xs text-[var(--color-muted)]">
            <span>Gross Yield Earned:</span>
            <span className="font-mono text-emerald-400 font-medium">
              +{formatCompactMinor(BigInt(p?.cumulativeGrossYieldEarned.amountMinor || "0"))}
            </span>
          </div>
        </div>

        {/* Card 4: Liquidations & Overdraft */}
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
          <div className="flex items-center justify-between text-xs text-[var(--color-muted)]">
            <span>Deficit Liquidations</span>
            {overdraftMinor > 0n ? (
              <AlertTriangle className="h-4 w-4 text-rose-400 animate-pulse" />
            ) : (
              <Percent className="h-4 w-4 text-[var(--color-muted)]" />
            )}
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-[var(--color-ink)]">
            {simResult?.summary.shortfallEventsCount ?? 0} events
          </div>
          <div className="mt-1 flex items-center justify-between text-xs text-[var(--color-muted)]">
            <span>Overdraft Balance:</span>
            <span className={overdraftMinor > 0n ? "font-mono text-rose-400 font-semibold" : "font-mono"}>
              {formatCompactMinor(overdraftMinor)}
            </span>
          </div>
        </div>
      </div>

      {/* 4-Tier Asset Allocation Matrix */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
        <h4 className="text-sm font-semibold text-[var(--color-ink)] mb-3">
          Active 4-Tier Asset Allocation Breakdown
        </h4>

        {/* Visual Stacked Progress Bar */}
        <div className="h-3 w-full rounded-full bg-[var(--color-bg)] overflow-hidden flex border border-[var(--color-border)] mb-4">
          <div style={{ width: `${cashPct}%` }} className="bg-sky-500 transition-all duration-300" title={`Tier 0 Cash: ${cashPct}%`} />
          <div style={{ width: `${repoPct}%` }} className="bg-amber-500 transition-all duration-300" title={`Tier 1 Repo: ${repoPct}%`} />
          <div style={{ width: `${bondsPct}%` }} className="bg-emerald-500 transition-all duration-300" title={`Tier 2 Sovereign Debt: ${bondsPct}%`} />
          <div style={{ width: `${equitiesPct}%` }} className="bg-purple-500 transition-all duration-300" title={`Tier 3 Equities: ${equitiesPct}%`} />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {/* Tier 0 */}
          <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-sky-400">Tier 0: Cash Buffer</span>
              <span className="text-xs font-mono text-[var(--color-muted)]">0.0% APY</span>
            </div>
            <div className="mt-1 text-lg font-bold font-mono text-[var(--color-ink)]">
              {formatCompactMinor(cashMinor)}
            </div>
            <div className="text-[11px] text-[var(--color-muted)] mt-1 flex justify-between">
              <span>Share: {cashPct}%</span>
              <span>Haircut: 0%</span>
            </div>
          </div>

          {/* Tier 1 */}
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-amber-400">Tier 1: Overnight Repo</span>
              <span className="text-xs font-mono text-emerald-400">~4.29% APY</span>
            </div>
            <div className="mt-1 text-lg font-bold font-mono text-[var(--color-ink)]">
              {formatCompactMinor(repoMinor)}
            </div>
            <div className="text-[11px] text-[var(--color-muted)] mt-1 flex justify-between">
              <span>{p?.tier1IsActive ? "Locked Overnight" : "Matured / In Cash"}</span>
              <span>Early Break: 0.5%</span>
            </div>
          </div>

          {/* Tier 2 */}
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-emerald-400">Tier 2: 2Y Sovereign Debt</span>
              <span className="text-xs font-mono text-emerald-400">~4.80% YTM</span>
            </div>
            <div className="mt-1 text-lg font-bold font-mono text-[var(--color-ink)]">
              {formatCompactMinor(bondsMinor)}
            </div>
            <div className="text-[11px] text-[var(--color-muted)] mt-1 flex justify-between">
              <span>Duration: 1.92y</span>
              <span>Haircut: 2.0%</span>
            </div>
          </div>

          {/* Tier 3 */}
          <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-purple-400">Tier 3: Growth Equities</span>
              <span className="text-xs font-mono text-purple-400">~10.0% APY</span>
            </div>
            <div className="mt-1 text-lg font-bold font-mono text-[var(--color-ink)]">
              {formatCompactMinor(equitiesMinor)}
            </div>
            <div className="text-[11px] text-[var(--color-muted)] mt-1 flex justify-between">
              <span>Drawdown: {p?.tier3DrawdownPct ?? 0}%</span>
              <span>Slippage: 15.0%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Net Flow Chart with Cash and Reserve Envelope */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h4 className="text-sm font-semibold text-[var(--color-ink)]">
              Diurnal Net Cash Flow & Basel III Reserve Envelope ($k)
            </h4>
            <p className="text-xs text-[var(--color-muted)]">
              Rolling 48-hour window surrounding Hour {currentFrame?.hourIndex ?? 0}. Morning inflow peaks (08:00 UTC) vs afternoon outflow peaks (17:00 UTC).
            </p>
          </div>
        </div>

        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" opacity={0.5} />
              <XAxis dataKey="timestamp" stroke="var(--color-muted)" fontSize={11} />
              <YAxis stroke="var(--color-muted)" fontSize={11} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--color-surface)",
                  borderColor: "var(--color-border)",
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="netFlow" fill="#38bdf8" stroke="#0284c7" name="Net Flow ($k)" fillOpacity={0.2} />
              <Line type="monotone" dataKey="cashBalance" stroke="#10b981" strokeWidth={2} dot={false} name="Available Cash ($100k)" />
              <Line type="monotone" dataKey="requiredReserve" stroke="#f59e0b" strokeWidth={2} strokeDasharray="4 4" dot={false} name="Reserve Floor ($100k)" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Interactive Stress Testing Sliders */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
        <h4 className="text-sm font-semibold text-[var(--color-ink)] mb-1">
          Real-Time Liquidity Stress Testing Controls
        </h4>
        <p className="text-xs text-[var(--color-muted)] mb-4">
          Dynamically shock customer withdrawals, settlement lag, and market interest rates to stress test the 5-tier liquidation cascade.
        </p>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
          {/* Slider 1: Outflow Shock */}
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-[var(--color-muted)]">Outflow Shock</span>
              <span className="font-mono text-rose-400 font-semibold">+{outflowShockPct}%</span>
            </div>
            <input
              type="range"
              aria-label="Outflow Shock"
              min={0}
              max={50}
              step={5}
              value={outflowShockPct}
              onChange={(e) => setOutflowShockPct(Number(e.target.value))}
              className="w-full h-1.5 bg-[var(--color-border)] rounded-lg appearance-none cursor-pointer accent-rose-500"
            />
            <span className="text-[10px] text-[var(--color-muted)]">Simulates bank-run withdrawal surges</span>
          </div>

          {/* Slider 2: Settlement Lag */}
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-[var(--color-muted)]">Settlement Delay</span>
              <span className="font-mono text-amber-400 font-semibold">{settlementLagHours} hours</span>
            </div>
            <input
              type="range"
              aria-label="Settlement Delay"
              min={0}
              max={72}
              step={6}
              value={settlementLagHours}
              onChange={(e) => setSettlementLagHours(Number(e.target.value))}
              className="w-full h-1.5 bg-[var(--color-border)] rounded-lg appearance-none cursor-pointer accent-amber-500"
            />
            <span className="text-[10px] text-[var(--color-muted)]">Delays Tier 2 bond liquidation payouts</span>
          </div>

          {/* Slider 3: Interest Rate Shift */}
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-[var(--color-muted)]">Rate Shift</span>
              <span className="font-mono text-sky-400 font-semibold">{rateShiftBps > 0 ? `+${rateShiftBps}` : rateShiftBps} bps</span>
            </div>
            <input
              type="range"
              aria-label="Interest Rate Shift"
              min={-200}
              max={200}
              step={25}
              value={rateShiftBps}
              onChange={(e) => setRateShiftBps(Number(e.target.value))}
              className="w-full h-1.5 bg-[var(--color-border)] rounded-lg appearance-none cursor-pointer accent-sky-500"
            />
            <span className="text-[10px] text-[var(--color-muted)]">Central bank rate hike or cut</span>
          </div>

          {/* Slider 4: Equity Drawdown */}
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-[var(--color-muted)]">Equity Drawdown</span>
              <span className="font-mono text-purple-400 font-semibold">-{equityDrawdownShockPct}%</span>
            </div>
            <input
              type="range"
              aria-label="Equity Drawdown Shock"
              min={0}
              max={50}
              step={5}
              value={equityDrawdownShockPct}
              onChange={(e) => setEquityDrawdownShockPct(Number(e.target.value))}
              className="w-full h-1.5 bg-[var(--color-border)] rounded-lg appearance-none cursor-pointer accent-purple-500"
            />
            <span className="text-[10px] text-[var(--color-muted)]">Market crash haircut on Tier 3 equities</span>
          </div>
        </div>
      </div>

      {/* Live Chronological Audit Feed */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
        <h4 className="text-sm font-semibold text-[var(--color-ink)] mb-3">
          Live Chronological Audit Feed
        </h4>
        <div className="max-h-48 overflow-y-auto space-y-2 pr-2 font-mono text-xs">
          {simResult?.auditLogs && simResult.auditLogs.length > 0 ? (
            simResult.auditLogs.slice(-25).reverse().map((log, idx) => (
              <div
                key={idx}
                className={`p-2 rounded border flex items-start justify-between gap-3 ${
                  log.type === "OVERDRAFT"
                    ? "bg-rose-500/10 border-rose-500/30 text-rose-300"
                    : log.type === "LIQUIDATION"
                    ? "bg-amber-500/10 border-amber-500/30 text-amber-300"
                    : log.type === "MATURITY"
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                    : "bg-[var(--color-bg)] border-[var(--color-border)] text-[var(--color-ink)]"
                }`}
              >
                <div>
                  <span className="font-semibold mr-2">[{log.type}]</span>
                  <span>{log.message}</span>
                </div>
                <span className="text-[10px] text-[var(--color-muted)] whitespace-nowrap">
                  H{log.hour} ({log.timestamp.slice(11, 19)})
                </span>
              </div>
            ))
          ) : (
            <div className="text-[var(--color-muted)] text-center py-4 text-xs">
              No audit events recorded yet. Press Play to step through the dataset.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
