"use client";

import React, { useState, useEffect, useId } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Sliders, Play, Loader2, AlertTriangle, ShieldAlert } from "lucide-react";
import { Panel } from "@/components/finance/panels";
import { Badge, Button } from "@/components/ui/primitives";
import { formatCompactMinor } from "@/lib/money";
import { useChartTheme } from "@/components/finance/use-chart-theme";
import { apiFetch } from "@/lib/api-client";
import { useAuth } from "@/lib/firebase/auth-context";

export interface StressSimulatorPanelProps {
  isLive?: boolean;
  userRole?: string;
}

export interface SimulationResultDTO {
  id?: string;
  seed: string;
  trials: number;
  horizonHours: number;
  source?: string;
  scenario: {
    outflowShockPct: number;
    settlementDelayHours: number;
    confidence: number;
  };
  policy: string;
  shortfallFrequency: number;
  expectedShortfallMinor: string;
  p95ShortfallMinor: string;
  emergencyBorrowingCostMinor: string;
  penaltiesPaidMinor: string;
  grossYieldMinor: string;
  netYieldMinor: string;
  minCash: {
    p5Minor: string;
    p50Minor: string;
    p95Minor: string;
  };
  idleCashHoursMinor: string;
  cashPath: Array<{
    hour: number;
    p5CashMinor: string;
    medianCashMinor: string;
    p95CashMinor: string;
  }>;
  executionDurationMs?: number;
  disclaimer: string;
}

export function StressSimulatorPanel({
  isLive: isLiveProp,
  userRole: userRoleProp,
}: StressSimulatorPanelProps) {
  const chartTheme = useChartTheme();
  const { user, isMock } = useAuth();

  const isLive = isLiveProp !== undefined ? isLiveProp : Boolean(user && !isMock);
  const userRole = userRoleProp ?? (isLive ? "analyst" : "viewer");
  const canRun = isLive && userRole !== "viewer";

  // Slider IDs for accessibility
  const outflowId = useId();
  const delayId = useId();
  const confidenceId = useId();
  const policyId = useId();

  // Control state
  const [outflowShockPct, setOutflowShockPct] = useState<number>(20);
  const [settlementDelayHours, setSettlementDelayHours] = useState<number>(0);
  const [confidence, setConfidence] = useState<number>(99.0);
  const [policy, setPolicy] = useState<"reserve-juggler" | "hold-all-cash" | "fixed-buffer">(
    "reserve-juggler"
  );

  // Execution state
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(null);
  const [result, setResult] = useState<SimulationResultDTO | null>(null);

  // Rate-limiter countdown
  useEffect(() => {
    if (retryAfterSeconds === null || retryAfterSeconds <= 0) return;
    const timer = setInterval(() => {
      setRetryAfterSeconds((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(timer);
          return null;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [retryAfterSeconds]);

  const handleRunSimulation = async () => {
    if (!canRun || isRunning || retryAfterSeconds !== null) return;

    setIsRunning(true);
    setError(null);

    try {
      const res = await apiFetch<SimulationResultDTO>("/api/simulations", {
        method: "POST",
        body: JSON.stringify({
          scenario: {
            outflowShockPct,
            settlementDelayHours,
            confidence: confidence / 100,
          },
          policy,
        }),
      });

      if (res.ok) {
        setResult(res.data);
        setError(null);
      } else {
        if (res.status === 429) {
          const details = res.error.details as { retryAfterSeconds?: number } | undefined;
          const retrySec = details?.retryAfterSeconds ?? 10;
          setRetryAfterSeconds(retrySec);
          setError(res.error.message || `Rate limited. Please wait ${retrySec}s.`);
        } else {
          setError(res.error.message || "Failed to execute stress simulation.");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Stress simulation request failed.");
    } finally {
      setIsRunning(false);
    }
  };

  // Prepare chart series from cashPath
  const chartData = (result?.cashPath ?? []).map((p) => {
    const p5 = Number(p.p5CashMinor);
    const p95 = Number(p.p95CashMinor);
    const median = Number(p.medianCashMinor);
    return {
      hour: `${p.hour}h`,
      median,
      bandRange: [p5, p95] as [number, number],
    };
  });

  return (
    <Panel
      title="Stress Scenario Simulator"
      description="Monte Carlo shock injection & Digital Twin"
      headerAction={
        result ? (
          <Badge tone="positive" data-testid="sim-complete-badge">
            Simulated
          </Badge>
        ) : (
          <Badge tone="neutral">Ready</Badge>
        )
      }
    >
      <div className="space-y-4 py-1">
        {/* Mock Mode Notice (Data Honesty) */}
        {!isLive && (
          <div
            role="status"
            className="flex items-center gap-2.5 rounded-lg border border-border/80 bg-surface-2/40 px-3.5 py-2.5 text-xs text-muted"
          >
            <ShieldAlert className="h-4 w-4 shrink-0 text-primary" />
            <div>
              <span className="font-semibold text-foreground">Demonstration Mode: </span>
              <span>Sign in with a real account to run simulations.</span>
            </div>
          </div>
        )}

        {/* Error notification */}
        {error && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-lg border border-negative/30 bg-negative/10 px-3 py-2 text-xs text-negative"
            data-testid="simulation-error"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Control 1: Outflow Shock */}
        <div className={`space-y-1.5 ${!isLive ? "opacity-60" : ""}`}>
          <div className="flex items-center justify-between text-xs font-medium">
            <label htmlFor={outflowId} className="text-foreground">
              Outflow Shock (0–50%)
            </label>
            <span className="font-mono text-muted" data-testid="outflow-shock-value">
              {outflowShockPct}%
            </span>
          </div>
          <input
            id={outflowId}
            type="range"
            min={0}
            max={50}
            value={outflowShockPct}
            onChange={(e) => setOutflowShockPct(Number(e.target.value))}
            disabled={!isLive || isRunning}
            aria-label="Outflow Shock"
            aria-valuenow={outflowShockPct}
            aria-valuemin={0}
            aria-valuemax={50}
            className="w-full accent-primary disabled:cursor-not-allowed"
          />
          <div className="flex justify-between text-[10px] text-muted">
            <span>0% (Baseline)</span>
            <span>25%</span>
            <span>50% (Extreme)</span>
          </div>
        </div>

        {/* Control 2: Settlement Delay */}
        <div className={`space-y-1.5 ${!isLive ? "opacity-60" : ""}`}>
          <div className="flex items-center justify-between text-xs font-medium">
            <label htmlFor={delayId} className="text-foreground">
              Settlement Delay (0–72h)
            </label>
            <span className="font-mono text-muted" data-testid="settlement-delay-value">
              {settlementDelayHours}h {settlementDelayHours === 0 ? "(Instant)" : ""}
            </span>
          </div>
          <input
            id={delayId}
            type="range"
            min={0}
            max={72}
            value={settlementDelayHours}
            onChange={(e) => setSettlementDelayHours(Number(e.target.value))}
            disabled={!isLive || isRunning}
            aria-label="Settlement Delay"
            aria-valuenow={settlementDelayHours}
            aria-valuemin={0}
            aria-valuemax={72}
            className="w-full accent-primary disabled:cursor-not-allowed"
          />
          <div className="flex justify-between text-[10px] text-muted">
            <span>Instant</span>
            <span>24h (T+1)</span>
            <span>72h (T+3)</span>
          </div>
        </div>

        {/* Control 3: Reserve Confidence */}
        <div className={`space-y-1.5 ${!isLive ? "opacity-60" : ""}`}>
          <div className="flex items-center justify-between text-xs font-medium">
            <label htmlFor={confidenceId} className="text-foreground">
              Reserve Confidence
            </label>
            <span className="font-mono text-muted" data-testid="confidence-value">
              {confidence.toFixed(1)}%
            </span>
          </div>
          <input
            id={confidenceId}
            type="range"
            min={90}
            max={99.9}
            step={0.1}
            value={confidence}
            onChange={(e) => setConfidence(Number(e.target.value))}
            disabled={!isLive || isRunning}
            aria-label="Reserve Confidence"
            aria-valuenow={confidence}
            aria-valuemin={90}
            aria-valuemax={99.9}
            className="w-full accent-primary disabled:cursor-not-allowed"
          />
          <div className="flex justify-between text-[10px] text-muted">
            <span>90.0% (alpha=0.10)</span>
            <span>95.0%</span>
            <span>99.9% (Basel III)</span>
          </div>
        </div>

        {/* Control 4: Policy Selector */}
        <div className={`space-y-1.5 ${!isLive ? "opacity-60" : ""}`}>
          <label htmlFor={policyId} className="text-xs font-medium text-foreground">
            Liquidity Policy
          </label>
          <select
            id={policyId}
            value={policy}
            onChange={(e) => setPolicy(e.target.value as "reserve-juggler" | "hold-all-cash" | "fixed-buffer")}
            disabled={!isLive || isRunning}
            className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none disabled:cursor-not-allowed"
          >
            <option value="reserve-juggler">Reserve Juggler (Basel III + Yield Optimizer)</option>
            <option value="hold-all-cash">Hold 100% Cash Buffer (No deployment)</option>
            <option value="fixed-buffer">Fixed Buffer (20% Liquid Floor)</option>
          </select>
        </div>

        {/* Run Action Button (Hidden for viewers) */}
        {userRole !== "viewer" && isLive && (
          <div className="pt-1">
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handleRunSimulation}
              disabled={isRunning || retryAfterSeconds !== null}
              data-testid="run-simulation-button"
              className="w-full gap-1.5"
            >
              {isRunning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Simulating 500 trials...</span>
                </>
              ) : retryAfterSeconds !== null ? (
                <span>Retry in {retryAfterSeconds}s</span>
              ) : (
                <>
                  <Play className="h-4 w-4 fill-current" />
                  <span>Run simulation</span>
                </>
              )}
            </Button>
          </div>
        )}

        {/* Results View */}
        {result && (
          <div className="space-y-3 rounded-lg border border-border/80 bg-surface-2/30 p-3 pt-3.5" data-testid="simulation-results">
            {/* Header label */}
            <div className="flex items-center justify-between text-[11px] text-muted">
              <span className="font-medium text-foreground">Simulation Results</span>
              <span>
                Simulated on {result.source ?? "synthetic"} data, seed {result.seed}, {result.trials} trials
              </span>
            </div>

            {/* Metrics grid */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded border border-border/60 bg-surface/60 p-2">
                <span className="text-[10px] text-muted">Shortfall Frequency</span>
                <p
                  className={`mt-0.5 font-mono font-semibold ${
                    result.shortfallFrequency > 0 ? "text-negative" : "text-positive"
                  }`}
                  data-testid="sim-shortfall-freq"
                >
                  {(result.shortfallFrequency * 100).toFixed(1)}%
                </p>
              </div>

              <div className="rounded border border-border/60 bg-surface/60 p-2">
                <span className="text-[10px] text-muted">Expected Shortfall</span>
                <p className="mt-0.5 font-mono font-semibold text-foreground" data-testid="sim-exp-shortfall">
                  {formatCompactMinor(BigInt(result.expectedShortfallMinor))}
                </p>
              </div>

              <div className="rounded border border-border/60 bg-surface/60 p-2">
                <span className="text-[10px] text-muted">Emergency Borrowing</span>
                <p className="mt-0.5 font-mono text-muted" data-testid="sim-borrowing-cost">
                  {formatCompactMinor(BigInt(result.emergencyBorrowingCostMinor))}
                </p>
              </div>

              <div className="rounded border border-border/60 bg-surface/60 p-2">
                <span className="text-[10px] text-muted">Penalties Paid</span>
                <p className="mt-0.5 font-mono text-muted" data-testid="sim-penalties">
                  {formatCompactMinor(BigInt(result.penaltiesPaidMinor))}
                </p>
              </div>

              <div className="col-span-2 rounded border border-border/60 bg-surface/60 p-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted">Net Realized Yield</span>
                  <span className="text-[10px] text-muted">
                    Gross: {formatCompactMinor(BigInt(result.grossYieldMinor))}
                  </span>
                </div>
                <p className="mt-0.5 font-mono text-sm font-semibold text-positive" data-testid="sim-net-yield">
                  {formatCompactMinor(BigInt(result.netYieldMinor))}
                </p>
              </div>
            </div>

            {/* Small Median-Path Chart with p5-p95 Band */}
            {chartData.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] text-muted">
                  <span>Cash Path (p5–p95 Band & Median)</span>
                  <span className="font-mono">Horizon: {result.horizonHours}h</span>
                </div>
                <div className="h-32 w-full" role="img" aria-label="Stress simulation cash path chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 8, right: 6, left: -16, bottom: 0 }}>
                      <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="hour"
                        stroke={chartTheme.axisText}
                        fontSize={10}
                        tickLine={false}
                        interval={Math.max(1, Math.floor(chartData.length / 5))}
                      />
                      <YAxis
                        stroke={chartTheme.axisText}
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v: number) => formatCompactMinor(v)}
                      />
                      <ReferenceLine y={0} stroke={chartTheme.negative} strokeDasharray="2 2" />
                      <Tooltip
                        cursor={{ stroke: chartTheme.grid }}
                        contentStyle={{
                          backgroundColor: chartTheme.tooltipBg,
                          border: `1px solid ${chartTheme.tooltipBorder}`,
                          borderRadius: 6,
                          color: chartTheme.tooltipText,
                          fontSize: 11,
                        }}
                        formatter={(v, name) => {
                          if (Array.isArray(v)) {
                            return [`${formatCompactMinor(v[0])} to ${formatCompactMinor(v[1])}`, "p5–p95 Band"];
                          }
                          return [formatCompactMinor(Number(v)), name === "median" ? "Median Cash" : String(name)];
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="bandRange"
                        stroke={chartTheme.forecastBandStroke}
                        fill={chartTheme.forecastBand}
                        isAnimationActive={false}
                        name="p5–p95 Band"
                      />
                      <Line
                        type="monotone"
                        dataKey="median"
                        stroke={chartTheme.actuals}
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                        name="Median Path"
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Disclaimer text */}
            <p className="text-[10px] leading-tight text-muted/80">
              {result.disclaimer}
            </p>
          </div>
        )}

        {/* Inactive footer when idle */}
        {!result && (
          <div className="flex items-center justify-between rounded-md border border-border/60 bg-surface-2/40 px-3 py-2 text-xs">
            <div className="flex items-center gap-2">
              <Sliders className="h-3.5 w-3.5 text-muted" />
              <span className="text-muted">Digital Twin Simulator</span>
            </div>
            <span className="font-mono text-[11px] text-muted">
              {isLive ? "Ready" : "Sign in to run"}
            </span>
          </div>
        )}
      </div>
    </Panel>
  );
}
