"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/firebase/auth-context";
import { useDashboardData } from "@/hooks/use-dashboard-data";
import { explainDecision, type StructuredDecisionExplanation } from "@/engine/explain";
import { Badge } from "@/components/ui/primitives";
import {
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Info,
  ArrowRight,
  DollarSign,
  Scale,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  ReferenceLine,
} from "recharts";
import { Money } from "@/engine/money";

export default function ReservePage() {
  const { user, isMock } = useAuth();
  const { data: dashboardData } = useDashboardData();
  const isLive = Boolean(user && !isMock);

  // Fallback sample decision for demonstration / unauthenticated states
  const sampleDecision = useMemo(() => ({
    id: "dec-sample-001",
    status: "HEALTHY",
    confidence: 0.95,
    alpha: 0.05,
    horizonHours: 24,
    reserveMinor: "2100000000", // $21,000,000.00
    surplusMinor: "2850000000", // $28,500,000.00
    availableCashMinor: "6240000000", // $62,400,000.00
    operationalFloorMinor: "1500000000", // $15,000,000.00
    stressAddOnMinor: "0",
    expectedCumulativeFlowMinor: "-250000000", // -$2,500,000.00
    worstCaseResidualShortfallMinor: "-350000000", // -$3,500,000.00
    backtest: {
      mase: 0.85,
      sampleSize: 120,
    },
    allocations: [],
    source: "synthetic" as const,
  }), []);

  const activeDecision = useMemo(() => {
    if (!isLive || !dashboardData?.decision) {
      return sampleDecision;
    }
    const d = dashboardData.decision;
    return {
      id: d.id,
      status: d.status,
      confidence: d.confidence,
      alpha: d.alpha,
      horizonHours: d.horizonHours,
      reserveMinor: d.reserveMinor,
      surplusMinor: d.surplusMinor,
      availableCashMinor: d.availableCashMinor,
      operationalFloorMinor: d.operationalFloorMinor,
      expectedCumulativeFlowMinor: d.expectedCumulativeFlowMinor,
      worstCaseResidualShortfallMinor: d.worstCaseResidualShortfallMinor,
      backtest: d.backtest ? { mase: d.backtest.mase, sampleSize: d.backtest.sampleSize } : undefined,
      allocations: d.allocations,
      source: d.source === "offline-fallback" ? undefined : d.source,
    };
  }, [isLive, dashboardData, sampleDecision]);

  const explanation: StructuredDecisionExplanation = useMemo(() => {
    return explainDecision(activeDecision);
  }, [activeDecision]);

  // Waterfall Chart Data
  const waterfallData = useMemo(() => {
    const mu = activeDecision.expectedCumulativeFlowMinor
      ? Number(BigInt(activeDecision.expectedCumulativeFlowMinor)) / 100
      : -2500000;
    const q = activeDecision.worstCaseResidualShortfallMinor
      ? Number(BigInt(activeDecision.worstCaseResidualShortfallMinor)) / 100
      : -3500000;
    const floor = activeDecision.operationalFloorMinor
      ? Number(BigInt(activeDecision.operationalFloorMinor)) / 100
      : 15000000;
    const reserve = Number(BigInt(activeDecision.reserveMinor)) / 100;
    const cash = activeDecision.availableCashMinor
      ? Number(BigInt(activeDecision.availableCashMinor)) / 100
      : 62400000;
    const surplus = Number(BigInt(activeDecision.surplusMinor)) / 100;

    return [
      { name: "Exp. Drift (μ)", amount: mu, fill: mu < 0 ? "#ef4444" : "#10b981" },
      { name: "Residual (q)", amount: q, fill: "#ef4444" },
      { name: "Floor (F)", amount: floor, fill: "#3b82f6" },
      { name: "Reserve (R)", amount: reserve, fill: "#8b5cf6" },
      { name: "Avail. Cash (C)", amount: cash, fill: "#10b981" },
      { name: "Surplus (C-R)", amount: surplus, fill: surplus > 0 ? "#10b981" : "#f59e0b" },
    ];
  }, [activeDecision]);

  const renderSourceBadge = () => {
    if (!isLive) {
      return (
        <Badge tone="info" data-testid="sample-data-badge">
          Sample data
        </Badge>
      );
    }
    if (activeDecision.source === "synthetic") {
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

  const isHealthy = activeDecision.status === "HEALTHY";
  const isUnderReserved = activeDecision.status === "UNDER_RESERVED";
  const coverageRatio = useMemo(() => {
    try {
      const c = BigInt(activeDecision.availableCashMinor || "0");
      const r = BigInt(activeDecision.reserveMinor || "1");
      if (r === 0n) return 100;
      return Number((c * 10000n) / r) / 100;
    } catch {
      return 0;
    }
  }, [activeDecision]);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Liquid Reserve Determination</h1>
            {renderSourceBadge()}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Quantile-based buffer requirements conforming to Basel III liquidity risk principles.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/optimizer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Surplus Optimizer <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {/* Standing Regulatory Caveat Alert */}
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-foreground">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-amber-600 dark:text-amber-400">
              Standing Regulatory Caveat: Probabilistic Reserve is Not a Guarantee
            </p>
            <p className="mt-1 text-muted-foreground leading-relaxed">
              The required reserve target <code className="font-mono bg-muted px-1 rounded text-foreground font-semibold">R = max(0, −(μ + q)) + F + Z</code> is formulated at a statistical confidence level of{" "}
              <strong>{(activeDecision.confidence * 100).toFixed(0)}%</strong> against backtested empirical net outflow shocks. 
              While designed to protect intraday clearing, tail events beyond the {(100 - activeDecision.confidence * 100).toFixed(1)}% quantile (e.g. correlated bank-run outflows or systemic market freeze) can exceed probabilistic buffers.
            </p>
          </div>
        </div>
      </div>

      {/* Unauthenticated / Mock Demonstration Callout */}
      {!isLive && (
        <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-4 text-sm text-foreground">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-blue-500">Sample Reserve Profile</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Showing sample liquidity positions. Sign in with a live account and run the engine on the dashboard to calculate your institution&apos;s real-time Basel III reserve requirement.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Top Liquidity Status & KPI Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium uppercase tracking-wider">Required Reserve (R)</span>
            <ShieldCheck className="h-4 w-4 text-primary" />
          </div>
          <p className="mt-2 text-xl font-bold text-foreground">
            {Money.fromMinor(BigInt(activeDecision.reserveMinor)).format()}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Confidence: {(activeDecision.confidence * 100).toFixed(0)}%
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium uppercase tracking-wider">Available Cash (C)</span>
            <DollarSign className="h-4 w-4 text-emerald-500" />
          </div>
          <p className="mt-2 text-xl font-bold text-foreground">
            {activeDecision.availableCashMinor
              ? Money.fromMinor(BigInt(activeDecision.availableCashMinor)).format()
              : "not recorded"}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Liquid unencumbered funds
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium uppercase tracking-wider">Coverage Ratio (C / R)</span>
            <Scale className="h-4 w-4 text-primary" />
          </div>
          <p className={`mt-2 text-xl font-bold ${coverageRatio >= 100 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
            {coverageRatio.toFixed(1)}%
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {coverageRatio >= 100 ? "Solvent reserve target" : "Deficit alert: C < R"}
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium uppercase tracking-wider">Operational Status</span>
            {isHealthy ? (
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
            ) : (
              <ShieldAlert className="h-4 w-4 text-amber-500" />
            )}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span
              className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs font-semibold ${
                isHealthy
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : isUnderReserved
                  ? "bg-destructive/10 text-destructive"
                  : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
              }`}
            >
              {activeDecision.status}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground truncate">
            {explanation.statusTriggerRule}
          </p>
        </div>
      </div>

      {/* Waterfall Balance Breakdown Chart */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Reserve & Cash Balance Breakdown</h3>
            <p className="text-xs text-muted-foreground">
              Decomposition of expected drift, worst-case residual quantile, operational buffer, resulting reserve, and surplus.
            </p>
          </div>
        </div>

        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={waterfallData} margin={{ top: 10, right: 10, left: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.6} />
              <XAxis dataKey="name" stroke="var(--text-secondary)" fontSize={11} interval={0} />
              <YAxis
                stroke="var(--text-secondary)"
                fontSize={11}
                tickFormatter={(val) => `$${(val / 1000000).toFixed(1)}M`}
              />
              <ReferenceLine y={0} stroke="var(--border)" strokeWidth={1.5} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--bg-card)",
                  borderColor: "var(--border)",
                  borderRadius: "0.5rem",
                  fontSize: "12px",
                  color: "var(--text-primary)",
                }}
                formatter={(val: number | string | readonly (number | string)[] | undefined) => {
                  if (val === undefined || val === null) return ["-", "Amount"];
                  const n = Number(val);
                  return [`$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, "Amount"];
                }}
              />
              <Bar dataKey="amount" radius={[4, 4, 0, 0]}>
                {waterfallData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Step-by-Step Mathematical Explanation Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="p-4 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">Step-by-Step Deterministic Reserve Math</h3>
          <p className="text-xs text-muted-foreground">
            Strictly computed from stored engine outputs. Missing or unrecorded fields are explicitly labelled.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/50 text-muted-foreground uppercase tracking-wider text-[11px] border-b border-border">
              <tr>
                <th className="py-3 px-4 w-12 text-center">Step</th>
                <th className="py-3 px-4 w-16">Symbol</th>
                <th className="py-3 px-4 w-48">Parameter</th>
                <th className="py-3 px-4 w-36 text-right">Recorded Value</th>
                <th className="py-3 px-4">Mathematical Interpretation & Role</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-foreground">
              {explanation.steps.map((step) => (
                <tr key={step.step} className={step.symbol === "R" ? "bg-primary/5 font-semibold" : ""}>
                  <td className="py-3 px-4 text-center font-mono text-muted-foreground">
                    {step.step}
                  </td>
                  <td className="py-3 px-4 font-mono font-bold text-primary">
                    {step.symbol}
                  </td>
                  <td className="py-3 px-4 font-medium text-foreground">
                    {step.label}
                  </td>
                  <td
                    className={`py-3 px-4 text-right font-mono font-bold ${
                      step.valueFormatted.startsWith("-")
                        ? "text-destructive"
                        : step.valueFormatted === "not recorded"
                        ? "text-muted-foreground font-normal italic"
                        : "text-foreground"
                    }`}
                  >
                    {step.valueFormatted}
                  </td>
                  <td className="py-3 px-4 text-muted-foreground leading-relaxed">
                    {step.description}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-muted/30 p-3.5 border-t border-border text-[11px] text-muted-foreground">
          <strong>Decision Trigger Rule:</strong> {explanation.statusTriggerRule}
        </div>
      </div>
    </div>
  );
}
