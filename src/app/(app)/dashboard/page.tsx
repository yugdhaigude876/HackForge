"use client";

import { useMemo } from "react";
import { useAuth } from "@/lib/firebase/auth-context";
import { useDashboardData } from "@/hooks/use-dashboard-data";
import { KpiCard } from "@/components/finance/kpi-card";
import { DecisionStatusCard } from "@/components/finance/decision-status-card";
import { ForecastBandChart } from "@/components/finance/forecast-band-chart";
import { StressSimulatorPanel } from "@/components/finance/stress-simulator-panel";
import { AllocationDonut } from "@/components/finance/allocation-donut";
import { DecisionAuditFeed } from "@/components/finance/decision-audit-feed";
import {
  DataTable,
  Panel,
  LoadingState,
  ErrorState,
  type Column,
} from "@/components/finance/panels";
import { Badge, Button } from "@/components/ui/primitives";
import { formatCompactMinor } from "@/lib/money";
import { calculateAllocationPercentage } from "@/components/finance/forecast-band-utils";
import {
  sampleBalances,
  sampleInstruments,
  sampleNetFlow,
  type SampleInstrument,
} from "@/lib/sample-data";
import { ShieldAlert, Play, RefreshCw, Loader2 } from "lucide-react";

interface AllocationTableRow {
  id: string;
  name: string;
  deployed: bigint;
  annualRateBps: number;
  settlementLagHours: number;
  penaltyBps: number;
  capacity: bigint;
}

const liveInstrumentColumns: Column<AllocationTableRow>[] = [
  {
    key: "name",
    header: "Instrument",
    render: (r) => <span className="font-medium text-foreground">{r.name}</span>,
  },
  {
    key: "dep",
    header: "Allocated",
    align: "right",
    render: (r) => (
      <span className="font-mono">{formatCompactMinor(r.deployed)}</span>
    ),
  },
  {
    key: "rate",
    header: "APY / Rate",
    align: "right",
    render: (r) => (
      <span className="font-mono text-positive">
        {`${(r.annualRateBps / 100).toFixed(2)}%`}
      </span>
    ),
  },
  {
    key: "lag",
    header: "Settles",
    align: "right",
    render: (r) => (r.settlementLagHours === 0 ? "Instant" : `${r.settlementLagHours}h`),
  },
  {
    key: "pen",
    header: "Early exit",
    align: "right",
    render: (r) =>
      r.penaltyBps === 0 ? "None" : `${(r.penaltyBps / 100).toFixed(2)}%`,
  },
  {
    key: "util",
    header: "Utilisation",
    align: "right",
    render: (r) => {
      const pct = calculateAllocationPercentage(r.deployed, r.capacity);
      return (
        <div className="flex items-center justify-end gap-2">
          <div className="h-1.5 w-12 rounded-full bg-surface-2 overflow-hidden">
            <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
          <span className="font-mono text-xs">{pct}%</span>
        </div>
      );
    },
  },
];

const sampleInstrumentColumns: Column<SampleInstrument>[] = [
  {
    key: "name",
    header: "Instrument",
    render: (r) => <span className="font-medium text-foreground">{r.name}</span>,
  },
  {
    key: "dep",
    header: "Allocated",
    align: "right",
    render: (r) => (
      <span className="font-mono">{formatCompactMinor(r.deployed)}</span>
    ),
  },
  {
    key: "rate",
    header: "APY / Rate",
    align: "right",
    render: (r) => (
      <span className="font-mono text-positive">
        {`${(r.annualRateBps / 100).toFixed(2)}%`}
      </span>
    ),
  },
  {
    key: "lag",
    header: "Settles",
    align: "right",
    render: (r) => (r.settlementLagHours === 0 ? "Instant" : `${r.settlementLagHours}h`),
  },
  {
    key: "pen",
    header: "Early exit",
    align: "right",
    render: (r) =>
      r.penaltyBps === 0 ? "None" : `${(r.penaltyBps / 100).toFixed(2)}%`,
  },
  {
    key: "util",
    header: "Utilisation",
    align: "right",
    render: (r) => {
      const pct = Math.min(100, Math.round((r.deployed / r.capacity) * 100));
      return (
        <div className="flex items-center justify-end gap-2">
          <div className="h-1.5 w-12 rounded-full bg-surface-2 overflow-hidden">
            <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
          <span className="font-mono text-xs">{pct}%</span>
        </div>
      );
    },
  },
];

const sampleForecastPredictions = [
  { hour: 1, mean: 1_200_000_00 },
  { hour: 2, mean: 950_000_00 },
  { hour: 3, mean: -450_000_00 },
  { hour: 4, mean: -1_100_000_00 },
  { hour: 5, mean: -200_000_00 },
  { hour: 6, mean: 800_000_00 },
  { hour: 7, mean: 2_100_000_00 },
  { hour: 8, mean: 3_400_000_00 },
  { hour: 9, mean: 2_800_000_00 },
  { hour: 10, mean: 1_600_000_00 },
  { hour: 11, mean: 500_000_00 },
  { hour: 12, mean: -800_000_00 },
  { hour: 13, mean: -1_400_000_00 },
  { hour: 14, mean: -600_000_00 },
  { hour: 15, mean: 400_000_00 },
  { hour: 16, mean: 1_900_000_00 },
  { hour: 17, mean: 2_700_000_00 },
  { hour: 18, mean: 1_800_000_00 },
  { hour: 19, mean: 900_000_00 },
  { hour: 20, mean: -300_000_00 },
  { hour: 21, mean: -1_200_000_00 },
  { hour: 22, mean: -900_000_00 },
  { hour: 23, mean: -200_000_00 },
  { hour: 24, mean: 600_000_00 },
];

export default function DashboardPage() {
  const { user, isMock } = useAuth();
  const {
    status,
    data,
    error,
    retryAfterSeconds,
    refresh,
    run,
    isRunning,
  } = useDashboardData();

  const isLive = Boolean(user && !isMock);
  const userRole = data?.userRole ?? "viewer";
  const canRunEngine = isLive && userRole !== "viewer";

  // Check decision and forecast from live data
  const liveDecision = data?.decision ?? null;
  const liveForecast = data?.forecast ?? null;

  // Derive donut allocations
  const donutAllocations = useMemo(() => {
    if (isLive && liveDecision && liveDecision.allocations?.length > 0) {
      return liveDecision.allocations.map((a) => ({
        name: a.name || a.instrumentId,
        amount: Number(BigInt(a.amountMinor || "0")),
      }));
    }
    return sampleInstruments.map((inst) => ({
      name: inst.name,
      amount: inst.deployed,
    }));
  }, [isLive, liveDecision]);

  // Derive live instrument table rows
  const liveInstrumentRows = useMemo<AllocationTableRow[]>(() => {
    if (!liveDecision || !liveDecision.allocations) return [];
    return liveDecision.allocations.map((a) => ({
      id: a.instrumentId,
      name: a.name || a.instrumentId,
      deployed: BigInt(a.amountMinor || "0"),
      annualRateBps: a.annualRateBps ?? 0,
      settlementLagHours: a.settlementLagHours ?? 0,
      penaltyBps: a.penaltyBps ?? 0,
      capacity: BigInt(a.capacityMinor || a.amountMinor || "0"),
    }));
  }, [liveDecision]);

  // Top-bar badge determination
  const renderBadge = () => {
    if (!isLive) {
      return (
        <Badge tone="info" data-testid="sample-data-badge">
          Sample data
        </Badge>
      );
    }

    if (liveDecision?.source === "synthetic" || liveForecast?.source === "synthetic") {
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

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            Liquidity Digital Twin & Optimizer
          </h1>
          <p className="text-xs text-muted">
            Continuous cash-flow forecasting, risk-based reserves, and automated surplus allocation.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {renderBadge()}

          {canRunEngine && (
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => run()}
              disabled={isRunning || retryAfterSeconds !== null}
              data-testid="run-engine-button"
              className="gap-1.5"
            >
              {isRunning ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Running engine...</span>
                </>
              ) : retryAfterSeconds !== null ? (
                <span>Retry in {retryAfterSeconds}s</span>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5 fill-current" />
                  <span>Run engine</span>
                </>
              )}
            </Button>
          )}

          {isLive && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={refresh}
              disabled={status === "loading" || isRunning}
              aria-label="Refresh telemetry"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${status === "loading" ? "animate-spin" : ""}`} />
            </Button>
          )}
        </div>
      </div>

      {/* Mock Mode Notice (Data Honesty) */}
      {!isLive && (
        <div
          role="status"
          className="flex items-center gap-3 rounded-lg border border-border/80 bg-surface-2/40 px-4 py-3 text-xs text-muted"
        >
          <ShieldAlert className="h-4 w-4 shrink-0 text-primary" />
          <div className="flex-1">
            <span className="font-semibold text-foreground">Demonstration Mode: </span>
            <span>
              Metrics below are illustrative placeholders. Sign in with a real Firebase account and
              configure an organisation to run live forecasts and evaluate persisted decisions.
            </span>
          </div>
        </div>
      )}

      {/* Loading state skeleton */}
      {status === "loading" && (
        <div data-testid="dashboard-loading" aria-busy="true">
          <LoadingState rows={6} />
        </div>
      )}

      {/* Error state */}
      {status === "error" && (
        <div data-testid="dashboard-error">
          <ErrorState message={error || "Failed to load dashboard telemetry."} onRetry={refresh} />
        </div>
      )}

      {/* Empty state: signed in but no runs executed yet */}
      {status === "empty" && (
        <div
          data-testid="dashboard-empty"
          className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface/50 p-8 text-center"
        >
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Play className="h-6 w-6 ml-0.5 fill-current" />
          </div>
          <h2 className="mt-3 text-base font-semibold text-foreground">No runs yet</h2>
          <p className="mt-1 max-w-sm text-xs text-muted">
            Run the engine to create the first automated forecast and Basel III reserve decision for
            this organisation.
          </p>
          {canRunEngine && (
            <div className="mt-4">
              <Button
                type="button"
                onClick={() => run()}
                disabled={isRunning || retryAfterSeconds !== null}
                className="gap-1.5"
              >
                {isRunning ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Running engine...</span>
                  </>
                ) : retryAfterSeconds !== null ? (
                  <span>Retry in {retryAfterSeconds}s</span>
                ) : (
                  <>
                    <Play className="h-4 w-4 fill-current" />
                    <span>Run engine</span>
                  </>
                )}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Dashboard Content: rendered when ready (live) OR unauthenticated (sample mode) */}
      {(status === "ready" || status === "unauthenticated") && (
        <>
          {/* Top KPI row (4 cards) */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {/* 1. Available Cash */}
            <KpiCard
              label="Available Cash"
              value={
                isLive && liveDecision
                  ? formatCompactMinor(BigInt(liveDecision.availableCashMinor))
                  : formatCompactMinor(sampleBalances.totalCash)
              }
              hint={isLive ? "Stored available cash" : "Illustrative balance across accounts"}
              accent="blue"
              sample={!isLive}
            />

            {/* 2. Required Reserve (Basel III) */}
            <KpiCard
              label="Required Reserve (Basel III)"
              value={
                isLive && liveDecision
                  ? formatCompactMinor(BigInt(liveDecision.reserveMinor))
                  : formatCompactMinor(sampleBalances.requiredReserve)
              }
              hint={isLive ? "Statistical risk reserve" : "Value-at-risk reserve threshold"}
              accent="amber"
              sample={!isLive}
            />

            {/* 3. Deployable Surplus */}
            <KpiCard
              label="Deployable Surplus"
              value={
                isLive && liveDecision
                  ? formatCompactMinor(BigInt(liveDecision.surplusMinor))
                  : formatCompactMinor(sampleBalances.deployedSurplus)
              }
              hint="Optimized for yield deployment"
              accent="teal"
              sample={!isLive}
            />

            {/* 4. Decision Status Card */}
            <DecisionStatusCard
              status={
                isLive && liveDecision
                  ? (liveDecision.status as "HEALTHY" | "UNDER_RESERVED" | "LOW_CONFIDENCE")
                  : "HEALTHY"
              }
              mase={
                isLive
                  ? (liveDecision?.backtest?.mase ?? liveForecast?.backtest?.mase ?? null)
                  : 0.85
              }
              confidence={isLive && liveDecision ? liveDecision.confidence : 0.99}
              sample={!isLive}
            />
          </div>

          {/* Middle Row: Forecast Panel (wide, left) + Stress Panel (right) */}
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
            {/* Forecast Panel (2 cols) */}
            <div className="xl:col-span-2">
              <Panel
                title="Cash Flow Forecasting & Backtesting"
                description="Continuous hourly net-flow actuals and rolling horizon forecast with uncertainty bands"
                sample={!isLive}
              >
                <ForecastBandChart
                  history={
                    isLive
                      ? (data?.actuals ?? []).map((a, idx) => ({
                          hour: idx,
                          net: Number(a.netMinor),
                        }))
                      : sampleNetFlow.map((p, idx) => ({
                          hour: idx,
                          net: p.net,
                        }))
                  }
                  predictions={
                    isLive && liveForecast && liveForecast.points?.length > 0
                      ? liveForecast.points.map((p, idx) => ({
                          hour: idx + 1,
                          mean: Number(p.meanMinor),
                          bandLower: p.bandLowerMinor ? Number(p.bandLowerMinor) : undefined,
                          bandUpper: p.bandUpperMinor ? Number(p.bandUpperMinor) : undefined,
                        }))
                      : sampleForecastPredictions
                  }
                  mase={
                    isLive
                      ? (liveDecision?.backtest?.mase ?? liveForecast?.backtest?.mase ?? null)
                      : 0.85
                  }
                  captionExtra={
                    isLive && liveForecast?.backtest?.sampleSize
                      ? `N = ${liveForecast.backtest.sampleSize} windows`
                      : !isLive
                      ? "1.25-Tail Risk Outliers • 0.10% Eval Error"
                      : undefined
                  }
                />
              </Panel>
            </div>

            {/* Stress Scenario Simulator Panel (1 col) */}
            <div className="xl:col-span-1">
              <StressSimulatorPanel isLive={isLive} userRole={data?.userRole} />
            </div>
          </div>

          {/* Bottom Row: Yield Optimizer Allocations (left) + Decision & Audit Feed (right) */}
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
            {/* Yield Optimizer Allocations (2 cols) */}
            <div className="xl:col-span-2">
              <Panel
                title="Yield Optimizer Allocations"
                description="Greedy rate-maximizing surplus placement respecting settlement lag and liquidation penalty"
                sample={!isLive}
              >
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_auto]">
                  <div className="min-w-0 overflow-x-auto">
                    {isLive && liveInstrumentRows.length > 0 ? (
                      <DataTable columns={liveInstrumentColumns} rows={liveInstrumentRows} />
                    ) : (
                      <DataTable columns={sampleInstrumentColumns} rows={sampleInstruments} />
                    )}
                  </div>
                  <div className="flex items-center justify-center border-t border-border/50 pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-4">
                    <AllocationDonut allocations={donutAllocations} />
                  </div>
                </div>
              </Panel>
            </div>

            {/* Liquidity Decision Engine & Audit Log (1 col) */}
            <div className="xl:col-span-1">
              <Panel
                title="Decision Engine & Audit"
                description="Chronological stream of persisted decisions and SHA-256 audit hashes"
              >
                <DecisionAuditFeed
                  decisions={
                    isLive && liveDecision
                      ? [
                          {
                            id: liveDecision.id,
                            createdAt: liveDecision.createdAt,
                            status: liveDecision.status as "HEALTHY" | "UNDER_RESERVED" | "LOW_CONFIDENCE",
                            reserve: liveDecision.reserveMinor,
                            surplus: liveDecision.surplusMinor,
                            confidence: liveDecision.confidence,
                            allocationsCount: liveDecision.allocations?.length ?? 0,
                            explanation: liveDecision.explanation,
                          },
                        ]
                      : []
                  }
                  loading={isRunning}
                  error={error}
                  onRefresh={isLive ? refresh : undefined}
                />
              </Panel>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
