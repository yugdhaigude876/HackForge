"use client";

import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/lib/firebase/auth-context";
import { apiFetch } from "@/lib/api-client";
import { KpiCard } from "@/components/finance/kpi-card";
import { DecisionStatusCard } from "@/components/finance/decision-status-card";
import { ForecastBandChart } from "@/components/finance/forecast-band-chart";
import { StressSimulatorPanel } from "@/components/finance/stress-simulator-panel";
import { AllocationDonut } from "@/components/finance/allocation-donut";
import { DecisionAuditFeed } from "@/components/finance/decision-audit-feed";
import { DataTable, Panel, type Column } from "@/components/finance/panels";
import { Badge } from "@/components/ui/primitives";
import { formatCompactMinor } from "@/lib/money";
import {
  sampleBalances,
  sampleInstruments,
  sampleNetFlow,
  type SampleInstrument,
} from "@/lib/sample-data";
import { ShieldAlert } from "lucide-react";

interface ApiDecision {
  id: string;
  createdAt: string | Date;
  status: "HEALTHY" | "UNDER_RESERVED" | "LOW_CONFIDENCE";
  reserve: string;
  surplus: string;
  confidence: number;
  explanation: string;
  allocations: Array<{ instrumentId: string; amount: string }>;
}

const instrumentColumns: Column<SampleInstrument>[] = [
  { key: "name", header: "Instrument", render: (r) => <span className="font-medium text-foreground">{r.name}</span> },
  { key: "dep", header: "Allocated", align: "right", render: (r) => <span className="font-mono">{formatCompactMinor(r.deployed)}</span> },
  { key: "rate", header: "APY / Rate", align: "right", render: (r) => <span className="font-mono text-positive">{`${(r.annualRateBps / 100).toFixed(2)}%`}</span> },
  { key: "lag", header: "Settles", align: "right", render: (r) => (r.settlementLagHours === 0 ? "Instant" : `${r.settlementLagHours}h`) },
  { key: "pen", header: "Early exit", align: "right", render: (r) => (r.penaltyBps === 0 ? "None" : `${(r.penaltyBps / 100).toFixed(2)}%`) },
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
  const [decisions, setDecisions] = useState<ApiDecision[]>([]);
  const [loadingDecisions, setLoadingDecisions] = useState(false);
  const [decisionsError, setDecisionsError] = useState<string | null>(null);

  const isLive = Boolean(user && !isMock);

  const fetchDecisions = async () => {
    if (!isLive) return;
    setLoadingDecisions(true);
    setDecisionsError(null);
    try {
      const res = await apiFetch<ApiDecision[]>("/api/decisions?limit=10");
      if (res.ok) {
        setDecisions(res.data);
      } else {
        setDecisionsError(res.error.message || "Failed to load decisions");
      }
    } catch (err) {
      setDecisionsError(err instanceof Error ? err.message : "Failed to load decisions");
    } finally {
      setLoadingDecisions(false);
    }
  };

  useEffect(() => {
    if (!isLive) return;

    let cancelled = false;
    apiFetch<ApiDecision[]>("/api/decisions?limit=10")
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          setDecisions(res.data);
          setDecisionsError(null);
        } else {
          setDecisionsError(res.error.message || "Failed to load decisions");
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setDecisionsError(
          err instanceof Error ? err.message : "Failed to load decisions"
        );
      });

    return () => {
      cancelled = true;
    };
  }, [isLive]);

  const latestDecision = decisions.length > 0 ? decisions[0] : null;

  // Values depending on live vs sample data
  const totalCashFormatted = isLive && latestDecision
    ? formatCompactMinor(BigInt(latestDecision.reserve) + BigInt(latestDecision.surplus))
    : formatCompactMinor(sampleBalances.totalCash);

  const requiredReserveFormatted = isLive && latestDecision
    ? formatCompactMinor(BigInt(latestDecision.reserve))
    : formatCompactMinor(sampleBalances.requiredReserve);

  const surplusFormatted = isLive && latestDecision
    ? formatCompactMinor(BigInt(latestDecision.surplus))
    : formatCompactMinor(sampleBalances.deployedSurplus);

  const decisionStatus = isLive && latestDecision
    ? latestDecision.status
    : "HEALTHY";

  const decisionConfidence = isLive && latestDecision
    ? latestDecision.confidence
    : 0.99;

  const maseMetric = isLive ? null : 0.85;

  const donutAllocations = useMemo(() => {
    if (isLive && latestDecision && latestDecision.allocations?.length > 0) {
      return latestDecision.allocations.map((a, idx) => ({
        name: `Instrument ${idx + 1}`,
        amount: Number(BigInt(a.amount || "0")),
      }));
    }
    return sampleInstruments.map((inst) => ({
      name: inst.name,
      amount: inst.deployed,
    }));
  }, [isLive, latestDecision]);

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
          {!isLive ? (
            <Badge tone="info" data-testid="sample-data-badge">
              Sample data — illustrative terminal
            </Badge>
          ) : (
            <Badge tone="positive" data-testid="live-data-badge">
              Live Org Telemetry
            </Badge>
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

      {/* Top KPI row (4 cards) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* 1. Available Cash */}
        <KpiCard
          label="Available Cash"
          value={totalCashFormatted}
          hint={isLive ? "Aggregated balance" : "Illustrative balance across accounts"}
          accent="blue"
          sample={!isLive}
        />

        {/* 2. Required Reserve (Basel III) */}
        <KpiCard
          label="Required Reserve (Basel III)"
          value={requiredReserveFormatted}
          hint={isLive ? "Statistical risk reserve" : "Value-at-risk reserve threshold"}
          accent="amber"
          sample={!isLive}
        />

        {/* 3. Deployable Surplus */}
        <KpiCard
          label="Deployable Surplus"
          value={surplusFormatted}
          hint="Optimized for yield deployment"
          accent="teal"
          sample={!isLive}
        />

        {/* 4. Decision Status Card */}
        <DecisionStatusCard
          status={decisionStatus}
          mase={maseMetric}
          confidence={decisionConfidence}
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
              history={sampleNetFlow.map((p, idx) => ({
                hour: idx,
                net: p.net,
              }))}
              predictions={sampleForecastPredictions}
              mase={maseMetric}
              captionExtra={!isLive ? "1.25-Tail Risk Outliers • 0.10% Eval Error" : undefined}
            />
          </Panel>
        </div>

        {/* Stress Scenario Simulator Panel (1 col) */}
        <div className="xl:col-span-1">
          <StressSimulatorPanel />
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
                <DataTable columns={instrumentColumns} rows={sampleInstruments} />
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
              decisions={decisions.map((d) => ({
                id: d.id,
                createdAt: d.createdAt,
                status: d.status,
                reserve: d.reserve,
                surplus: d.surplus,
                confidence: d.confidence,
                allocationsCount: d.allocations?.length ?? 0,
                explanation: d.explanation,
              }))}
              loading={loadingDecisions}
              error={decisionsError}
              onRefresh={isLive ? fetchDecisions : undefined}
            />
          </Panel>
        </div>
      </div>
    </div>
  );
}
