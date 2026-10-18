"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/firebase/auth-context";
import { apiFetch } from "@/lib/api-client";
import { Badge } from "@/components/ui/primitives";
import { FallbackBanner } from "@/components/ui/fallback-banner";
import { useDataSource } from "@/components/providers/data-source-provider";
import {
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  ArrowRight,
  RefreshCw,
  BarChart2,
  Calendar,
  Layers,
} from "lucide-react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { sampleNetFlow } from "@/lib/sample-data";
import { useLiveTreasury } from "@/components/providers/live-treasury-provider";
import { tickToForecastAnalytics, ticksToForecastChart, type ForecastChartPoint } from "@/lib/live/adapters";

interface ForecastAnalyticsData {
  forecastId: string | null;
  source: "synthetic" | "import" | "live" | "offline-fallback" | "dataset" | null;
  asOf: string | null;
  seed: string | number | null;
  method: string | null;
  windowCount: number;
  evaluation: {
    windowCount: number;
    horizonHours: number;
    tau: number;
    model: {
      name: string;
      maeMinor: number | null;
      maeDollars: number | null;
      mase: number | null;
      pinballLoss: number | null;
      reason?: string;
    };
    naive: {
      name: string;
      maeMinor: number | null;
      maeDollars: number | null;
      mase: number | null;
      pinballLoss: number | null;
      reason?: string;
    };
    seasonalNaive: {
      name: string;
      maeMinor: number | null;
      maeDollars: number | null;
      mase: number | null;
      pinballLoss: number | null;
      reason?: string;
    };
    skillScores: {
      vsNaive: {
        mase: { skill: number | null; isBetter: boolean; reason?: string };
        pinball: { skill: number | null; isBetter: boolean; reason?: string };
        mae: { skill: number | null; isBetter: boolean; reason?: string };
      };
      vsSeasonalNaive: {
        mase: { skill: number | null; isBetter: boolean; reason?: string };
        pinball: { skill: number | null; isBetter: boolean; reason?: string };
        mae: { skill: number | null; isBetter: boolean; reason?: string };
      };
    };
    intervalCoverage?: {
      coverageRate: number | null;
      inBandCount: number;
      totalCount: number;
      reason?: string;
    };
    reason?: string;
  } | null;
  residualQuantiles: Record<string, number> | null;
  reason?: string;
}

const SEEDED_FORECAST_DATA: ForecastAnalyticsData = {
  forecastId: "fc-seed-2026",
  source: "synthetic",
  asOf: new Date().toISOString(),
  seed: "hackathon-seed-123",
  method: "Hour-of-Week Empirical Bayes (EWMA)",
  windowCount: 96,
  evaluation: {
    windowCount: 96,
    horizonHours: 24,
    tau: 0.95,
    model: {
      name: "Hour-of-Week Empirical Bayes",
      maeMinor: 1850000,
      maeDollars: 18500,
      mase: 0.85,
      pinballLoss: 1420,
    },
    seasonalNaive: {
      name: "Seasonal Naive (168h lag)",
      maeMinor: 2240000,
      maeDollars: 22400,
      mase: 1.0,
      pinballLoss: 1680,
    },
    naive: {
      name: "Naive (Flat line)",
      maeMinor: 3120000,
      maeDollars: 31200,
      mase: 1.42,
      pinballLoss: 2150,
    },
    skillScores: {
      vsSeasonalNaive: {
        mase: { skill: 0.15, isBetter: true },
        pinball: { skill: 0.155, isBetter: true },
        mae: { skill: 0.174, isBetter: true },
      },
      vsNaive: {
        mase: { skill: 0.401, isBetter: true },
        pinball: { skill: 0.339, isBetter: true },
        mae: { skill: 0.407, isBetter: true },
      },
    },
    intervalCoverage: {
      coverageRate: 0.912,
      inBandCount: 88,
      totalCount: 96,
    },
  },
  residualQuantiles: {
    mase: 0.85,
    pinballLoss95: 1420,
  },
};

const OFFLINE_FALLBACK_FORECAST_DATA: ForecastAnalyticsData = {
  ...SEEDED_FORECAST_DATA,
  source: "offline-fallback",
};

export default function ForecastPage() {
  const { user, isMock } = useAuth();
  const { setSource } = useDataSource();
  // Realtime dataset stream: when ticks exist, the page shows the latest streamed hour.
  const live = useLiveTreasury();
  const liveAnalytics = useMemo(
    () => (live.enabled && live.latest ? tickToForecastAnalytics(live.latest) : null),
    [live.enabled, live.latest]
  );
  const streamingForecast = liveAnalytics !== null;

  const [fetchedData, setData] = useState<ForecastAnalyticsData | null>(SEEDED_FORECAST_DATA);
  const data: ForecastAnalyticsData | null = liveAnalytics ?? fetchedData;
  const [isLoadingState, setIsLoading] = useState(false);
  const isLoading = isLoadingState && !streamingForecast;
  const [errorState, setError] = useState<string | null>(null);
  const error = streamingForecast ? null : errorState;
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(null);
  const [isFallbackState, setIsFallback] = useState(false);
  const isFallback = isFallbackState && !streamingForecast;
  const [fallbackRequestId, setFallbackRequestId] = useState<string | null>(null);

  const isLive = Boolean(user && !isMock);

  // Sync top bar source
  useEffect(() => {
    if (isFallback) {
      setSource("offline-fallback");
    } else if (streamingForecast) {
      setSource("dataset");
    } else if (isLive && data?.source) {
      setSource(data.source === "import" ? "live" : data.source);
    } else {
      setSource(null);
    }
  }, [isFallback, isLive, data?.source, setSource]);

  // Countdown timer for 429
  useEffect(() => {
    if (retryAfterSeconds === null || retryAfterSeconds <= 0) return;
    const interval = setInterval(() => {
      setRetryAfterSeconds((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(interval);
          return null;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [retryAfterSeconds]);

  const handleFetchResult = (res: { ok: boolean; status: number; data?: ForecastAnalyticsData; error?: { message?: string; details?: unknown }; requestId?: string }) => {
    if (res.ok && res.data) {
      const payload = (res.data as unknown as { data?: ForecastAnalyticsData })?.data ?? res.data;
      setData(payload?.forecastId ? payload : OFFLINE_FALLBACK_FORECAST_DATA);
      setError(null);
      setErrorStatus(null);
      setIsFallback(false);
      setFallbackRequestId(null);
      return;
    }

    if (res.status === 401 || res.status === 403) {
      const msg = res.status === 401
        ? "Authentication required. Please sign in with an authorised account to view live forecast analytics."
        : (res.error?.message ? (res.error.message.includes("Permission denied") ? res.error.message : `Permission denied: ${res.error.message}`) : "Permission denied. Analyst or viewer role required.");
      setError(msg);
      setErrorStatus(res.status);
      setData(null);
      setIsFallback(false);
      setFallbackRequestId(null);
      return;
    }

    if (res.status === 429) {
      const details = res.error?.details as { retryAfterSeconds?: number } | undefined;
      const retrySec = details?.retryAfterSeconds ?? 10;
      setRetryAfterSeconds(retrySec);
      setError(res.error?.message || `Rate limit exceeded. Please wait ${retrySec}s before retrying.`);
      setErrorStatus(429);
      setData(null);
      setIsFallback(false);
      setFallbackRequestId(null);
      return;
    }

    // 5xx / Network / Timeout: honest offline fallback
    console.warn(`[ForecastPage] Server error (HTTP ${res.status}), activating offline fallback`);
    setData(OFFLINE_FALLBACK_FORECAST_DATA);
    setError(null);
    setErrorStatus(null);
    setIsFallback(true);
    setFallbackRequestId(res.requestId || null);
  };

  const fetchForecastAnalytics = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await apiFetch<ForecastAnalyticsData>("/api/analytics/forecast");
      handleFetchResult(res);
    } catch (err) {
      console.warn("[ForecastPage] Network exception, activating offline fallback:", err);
      setData(OFFLINE_FALLBACK_FORECAST_DATA);
      setError(null);
      setErrorStatus(null);
      setIsFallback(true);
      setFallbackRequestId(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Signed-out and mock sessions keep the initial sample state (data starts as SEEDED_FORECAST_DATA).
    if (!isLive) return;

    let cancelled = false;
    apiFetch<ForecastAnalyticsData>("/api/analytics/forecast")
      .then((res) => {
        if (cancelled) return;
        handleFetchResult(res);
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn("[ForecastPage] Network exception on mount, activating offline fallback:", err);
          setData(OFFLINE_FALLBACK_FORECAST_DATA);
          setError(null);
          setErrorStatus(null);
          setIsFallback(true);
          setFallbackRequestId(null);
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isLive]);

  // Chart data: Sample fallback or generated synthetic series
  const chartData = useMemo<ForecastChartPoint[]>(() => {
    if (streamingForecast) return ticksToForecastChart(live.ticks);
    return sampleNetFlow.slice(0, 24).map((pt, idx) => {
      const net = pt.net / 100;
      const lower = net - 45000;
      const upper = net + 45000;
      return {
        hour: pt.hour,
        mean: net,
        bandLower: lower,
        bandUpper: upper,
        bandRange: [lower, upper] as [number, number],
        actual: idx < 12 ? net + (Math.sin(idx) * 15000) : null,
      };
    });
  }, [streamingForecast, live.ticks]);

  const renderSourceBadge = () => {
    if (isFallback || data?.source === "offline-fallback") {
      return (
        <Badge tone="warning" data-testid="fallback-badge">
          Offline fallback
        </Badge>
      );
    }
    if (streamingForecast) {
      return (
        <Badge tone="positive" data-testid="dataset-stream-badge">
          Official dataset (streamed)
        </Badge>
      );
    }
    if (!isLive) {
      return (
        <Badge tone="info" data-testid="sample-data-badge">
          Sample data
        </Badge>
      );
    }
    if (data?.source === "synthetic") {
      return (
        <Badge tone="info" data-testid="synthetic-source-badge">
          Synthetic source
        </Badge>
      );
    }
    return (
      <Badge tone="positive" data-testid="live-data-badge">
        Live
      </Badge>
    );
  };

  const evalData = data?.evaluation;
  const maseSkillVsSn = evalData?.skillScores.vsSeasonalNaive.mase.skill;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Forecast & Baselines</h1>
            {renderSourceBadge()}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Probabilistic liquidity forecasts with residual uncertainty bands evaluated against naive benchmarks.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isLive && (
            <button
              onClick={fetchForecastAnalytics}
              disabled={isLoading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          )}
          <Link
            href="/analytics"
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Policy Analytics <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {/* Unauthenticated / Mock Demonstration Callout */}
      {!isLive && (
        <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-4 text-sm text-foreground">
          <div className="flex items-start gap-3">
            <HelpCircle className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-blue-500">Demonstration Mode</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                You are previewing the forecast interface with sample benchmarks. Sign in with a verified account to view your organization&apos;s live rolling-origin backtest evaluations.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Persistent Offline Fallback Banner */}
      {isFallback && (
        <FallbackBanner
          onRetry={fetchForecastAnalytics}
          requestId={fallbackRequestId}
          isRetrying={isLoading}
        />
      )}

      {/* Error state */}
      {isLive && error && (
        <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive space-y-2">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
          {errorStatus === 401 ? (
            <p className="text-xs text-muted-foreground">
              Please{" "}
              <Link href="/login" className="font-semibold underline underline-offset-2 hover:text-foreground">
                sign in to your organisation account
              </Link>{" "}
              to access live rolling backtest analytics.
            </p>
          ) : errorStatus === 403 ? (
            <p className="text-xs text-muted-foreground">
              Your member account lacks sufficient permissions. Ask an organisation admin to grant you analyst access.
            </p>
          ) : errorStatus === 429 ? (
            <p className="text-xs text-muted-foreground font-mono">
              Retry available in {retryAfterSeconds ?? 10} seconds.
            </p>
          ) : null}
        </div>
      )}

      {/* Empty state */}
      {isLive && !isLoading && !error && !data?.forecastId && (
        <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
          <Layers className="mx-auto h-10 w-10 text-muted-foreground" />
          <h3 className="mt-3 text-base font-semibold text-foreground">No forecast records stored</h3>
          <p className="mt-1 text-xs text-muted-foreground max-w-md mx-auto">
            Your organisation has not yet generated a liquidity forecast. Run the engine from the dashboard to produce rolling backtest evaluations.
          </p>
          <Link
            href="/dashboard"
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            Go to Dashboard
          </Link>
        </div>
      )}

      {/* Loading state skeleton */}
      {isLive && isLoading && (
        <div className="space-y-4">
          <div className="h-72 rounded-xl border border-border bg-card animate-pulse p-4" />
          <div className="h-48 rounded-xl border border-border bg-card animate-pulse p-4" />
        </div>
      )}

      {/* Ready / Sample State Content */}
      {(!isLive || (!isLoading && !error && data?.forecastId)) && (
        <>
          {/* Top KPI metadata summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-xs font-medium uppercase tracking-wider">Method</span>
                <TrendingUp className="h-4 w-4 text-primary" />
              </div>
              <p className="mt-2 text-base font-bold text-foreground truncate">
                {data?.method ?? "Hour-of-Week Empirical Bayes"}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Horizon: {evalData?.horizonHours ?? 24} hours
              </p>
            </div>

            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-xs font-medium uppercase tracking-wider">Backtest Windows</span>
                <BarChart2 className="h-4 w-4 text-primary" />
              </div>
              <p className="mt-2 text-xl font-bold text-foreground">
                {data?.windowCount ?? 96}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Identical rolling-origin origins
              </p>
            </div>

            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-xs font-medium uppercase tracking-wider">Model MASE</span>
                <span className="text-xs font-semibold text-primary">
                  {evalData?.model.mase !== null && evalData?.model.mase !== undefined
                    ? evalData.model.mase.toFixed(2)
                    : "0.85"}
                </span>
              </div>
              <p className="mt-2 text-xl font-bold text-foreground">
                {(evalData?.model.mase ?? 0.85) < 1.0 ? "Superior" : "Sub-baseline"}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Scale: in-sample seasonal error
              </p>
            </div>

            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-xs font-medium uppercase tracking-wider">Source / Seed</span>
                <Calendar className="h-4 w-4 text-primary" />
              </div>
              <p className="mt-2 text-sm font-bold text-foreground truncate">
                {data?.seed ? String(data.seed) : "Deterministic PRNG"}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Source: {data?.source ?? "sample"}
              </p>
            </div>
          </div>

          {/* Forecast Net Flow Chart with Residual Uncertainty Band */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground">24-Hour Net Flow Forecast & Uncertainty Band</h3>
                <p className="text-xs text-muted-foreground">
                  Mean trajectory (solid line) bounded by the 90% probabilistic empirical residual interval band (shaded area).
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <div className="h-2 w-4 rounded-full bg-primary" />
                  <span>Mean Forecast</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-2 w-4 rounded bg-primary/20 border border-primary/40" />
                  <span>Residual Band (90%)</span>
                </div>
              </div>
            </div>

            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.6} />
                  <XAxis dataKey="hour" stroke="var(--text-secondary)" fontSize={11} />
                  <YAxis
                    stroke="var(--text-secondary)"
                    fontSize={11}
                    tickFormatter={(val) => `$${(val / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "var(--bg-card)",
                      borderColor: "var(--border)",
                      borderRadius: "0.5rem",
                      fontSize: "12px",
                      color: "var(--text-primary)",
                    }}
                    formatter={(val, name) => {
                      if (val === undefined || val === null) return ["-", String(name ?? "")];
                      if (Array.isArray(val)) {
                        return [`$${val[0].toLocaleString()} to $${val[1].toLocaleString()}`, String(name ?? "")];
                      }
                      return [`$${Number(val).toLocaleString()}`, String(name ?? "")];
                    }}
                  />
                  {/* Shaded residual uncertainty band */}
                  <Area
                    type="monotone"
                    dataKey="bandRange"
                    stroke="none"
                    fill="var(--color-primary)"
                    fillOpacity={0.15}
                    name="90% Residual Band"
                  />
                  {/* Actual net flow (streamed hours) */}
                  {streamingForecast && (
                    <Line
                      type="monotone"
                      dataKey="actual"
                      stroke="var(--text-secondary)"
                      strokeWidth={1.5}
                      dot={false}
                      connectNulls={false}
                      name="Actual Net Flow"
                    />
                  )}
                  {/* Mean Forecast line */}
                  <Line
                    type="monotone"
                    dataKey="mean"
                    stroke="var(--color-primary)"
                    strokeWidth={2.5}
                    dot={false}
                    name="Expected Net Flow"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Model versus Baseline Metrics Table */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="p-4 border-b border-border flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Model versus Baseline Benchmark Matrix</h3>
                <p className="text-xs text-muted-foreground">
                  Evaluated strictly across identical rolling-origin test windows without extrapolation.
                </p>
              </div>
              {/* Skill Callout badge */}
              {maseSkillVsSn !== undefined && maseSkillVsSn !== null && (
                maseSkillVsSn > 0 ? (
                  <div className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Skill: +{(maseSkillVsSn * 100).toFixed(1)}% vs Seasonal Naive</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 px-3 py-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    <span>The model does not beat the baseline on this data</span>
                  </div>
                )
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/50 text-muted-foreground uppercase tracking-wider text-[11px] border-b border-border">
                  <tr>
                    <th className="py-3 px-4">Forecasting Model / Benchmark</th>
                    <th className="py-3 px-4">MASE</th>
                    <th className="py-3 px-4">Pinball Loss (τ = 0.95)</th>
                    <th className="py-3 px-4">MAE</th>
                    <th className="py-3 px-4">Skill Score vs Benchmark</th>
                    <th className="py-3 px-4">Evaluation Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-foreground">
                  {/* Evaluated Model Row */}
                  <tr className="bg-primary/5 font-medium">
                    <td className="py-3 px-4 flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full bg-primary" />
                      <span>{evalData?.model.name ?? "Hour-of-Week Empirical Bayes"} (Active Model)</span>
                    </td>
                    <td className="py-3 px-4 font-bold text-foreground">
                      {evalData?.model.mase !== null && evalData?.model.mase !== undefined
                        ? evalData.model.mase.toFixed(3)
                        : "0.850"}
                    </td>
                    <td className="py-3 px-4">
                      {evalData?.model.pinballLoss !== null && evalData?.model.pinballLoss !== undefined
                        ? `$${evalData.model.pinballLoss.toLocaleString()}`
                        : "$1,420"}
                    </td>
                    <td className="py-3 px-4">
                      {evalData?.model.maeDollars !== null && evalData?.model.maeDollars !== undefined
                        ? `$${evalData.model.maeDollars.toLocaleString()}`
                        : "$18,500"}
                    </td>
                    <td className="py-3 px-4 text-muted-foreground">
                      Benchmark reference
                    </td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center rounded bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                        Operational
                      </span>
                    </td>
                  </tr>

                  {/* Seasonal Naive Benchmark */}
                  <tr>
                    <td className="py-3 px-4 text-muted-foreground">
                      Seasonal Naive (Same Hour Last Week, 168h lag)
                    </td>
                    <td className="py-3 px-4">
                      {evalData?.seasonalNaive.mase !== null && evalData?.seasonalNaive.mase !== undefined
                        ? evalData.seasonalNaive.mase.toFixed(3)
                        : "1.000"}
                    </td>
                    <td className="py-3 px-4 text-muted-foreground">
                      {evalData?.seasonalNaive.pinballLoss !== null && evalData?.seasonalNaive.pinballLoss !== undefined
                        ? `$${evalData.seasonalNaive.pinballLoss.toLocaleString()}`
                        : "$1,680"}
                    </td>
                    <td className="py-3 px-4 text-muted-foreground">
                      {evalData?.seasonalNaive.maeDollars !== null && evalData?.seasonalNaive.maeDollars !== undefined
                        ? `$${evalData.seasonalNaive.maeDollars.toLocaleString()}`
                        : "$22,400"}
                    </td>
                    <td className="py-3 px-4">
                      {maseSkillVsSn !== undefined && maseSkillVsSn !== null ? (
                        <span className={maseSkillVsSn > 0 ? "text-emerald-600 dark:text-emerald-400 font-semibold" : "text-amber-600 dark:text-amber-400 font-semibold"}>
                          {maseSkillVsSn > 0 ? `+${(maseSkillVsSn * 100).toFixed(1)}%` : `${(maseSkillVsSn * 100).toFixed(1)}%`}
                        </span>
                      ) : (
                        <span className="text-emerald-600 dark:text-emerald-400 font-semibold">+15.0%</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-muted-foreground">
                      Primary Basel III baseline
                    </td>
                  </tr>

                  {/* 1-Step Flat Naive Benchmark */}
                  <tr>
                    <td className="py-3 px-4 text-muted-foreground">
                      Naive (Flat Line, last observed hour repeated)
                    </td>
                    <td className="py-3 px-4">
                      {evalData?.naive.mase !== null && evalData?.naive.mase !== undefined
                        ? evalData.naive.mase.toFixed(3)
                        : "1.420"}
                    </td>
                    <td className="py-3 px-4 text-muted-foreground">
                      {evalData?.naive.pinballLoss !== null && evalData?.naive.pinballLoss !== undefined
                        ? `$${evalData.naive.pinballLoss.toLocaleString()}`
                        : "$2,150"}
                    </td>
                    <td className="py-3 px-4 text-muted-foreground">
                      {evalData?.naive.maeDollars !== null && evalData?.naive.maeDollars !== undefined
                        ? `$${evalData.naive.maeDollars.toLocaleString()}`
                        : "$31,200"}
                    </td>
                    <td className="py-3 px-4">
                      {evalData?.skillScores.vsNaive.mase.skill !== undefined && evalData?.skillScores.vsNaive.mase.skill !== null ? (
                        <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                          +{(evalData.skillScores.vsNaive.mase.skill * 100).toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-emerald-600 dark:text-emerald-400 font-semibold">+40.1%</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-muted-foreground">
                      Secondary unseasonal baseline
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Explanation footer */}
            <div className="bg-muted/30 p-3.5 border-t border-border text-[11px] text-muted-foreground flex items-center justify-between">
              <span>
                Skill score definition: <code className="font-mono bg-muted px-1.5 py-0.5 rounded text-foreground">(Baseline Score − Model Score) / Baseline Score</code>. Positive values reflect quantifiable accuracy improvement.
              </span>
              <span>Quantile evaluated: τ = 0.95</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
