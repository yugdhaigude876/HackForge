"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/firebase/auth-context";
import { useDashboardData } from "@/hooks/use-dashboard-data";
import { explainDecision, type StructuredDecisionExplanation } from "@/engine/explain";
import { AllocationDonut } from "@/components/finance/allocation-donut";
import { Badge } from "@/components/ui/primitives";
import {
  DollarSign,
  TrendingUp,
  Percent,
  CheckCircle2,
  XCircle,
  Info,
  ArrowRight,
  Layers,
  ShieldAlert,
} from "lucide-react";
import { Money } from "@/engine/money";

export default function OptimizerPage() {
  const { user, isMock } = useAuth();
  const { data: dashboardData } = useDashboardData();
  const isLive = Boolean(user && !isMock);

  // Fallback sample instruments for demonstration mode
  const sampleDecision = useMemo(() => ({
    id: "dec-sample-optimizer",
    status: "HEALTHY",
    confidence: 0.95,
    horizonHours: 24,
    reserveMinor: "2100000000",
    surplusMinor: "2850000000", // $28.5M surplus
    availableCashMinor: "6240000000",
    allocations: [
      {
        instrumentId: "overnight-repo",
        name: "Overnight Treasury Repo",
        amountMinor: "1500000000", // $15M
        annualRateBps: 520,
        settlementLagHours: 0,
        penaltyBps: 0,
        capacityMinor: "2500000000",
        earlyWithdrawalRisk: 0.0,
      },
      {
        instrumentId: "30d-tbill-mmf",
        name: "30-Day T-Bill MMF",
        amountMinor: "1350000000", // $13.5M
        annualRateBps: 485,
        settlementLagHours: 2,
        penaltyBps: 15,
        capacityMinor: "1500000000",
        earlyWithdrawalRisk: 0.05,
      },
      {
        instrumentId: "7d-term-deposit",
        name: "7-Day Term Deposit",
        amountMinor: "0",
        annualRateBps: 420,
        settlementLagHours: 24,
        penaltyBps: 50,
        capacityMinor: "1000000000",
        earlyWithdrawalRisk: 0.10,
      },
    ],
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
      horizonHours: d.horizonHours,
      reserveMinor: d.reserveMinor,
      surplusMinor: d.surplusMinor,
      availableCashMinor: d.availableCashMinor,
      allocations: d.allocations.map((a) => ({
        instrumentId: a.instrumentId,
        name: a.name,
        amountMinor: a.amountMinor,
        annualRateBps: a.annualRateBps,
        settlementLagHours: a.settlementLagHours,
        penaltyBps: a.penaltyBps,
        capacityMinor: a.capacityMinor,
      })),
      source: d.source,
    };
  }, [isLive, dashboardData, sampleDecision]);

  const explanation: StructuredDecisionExplanation = useMemo(() => {
    return explainDecision(activeDecision);
  }, [activeDecision]);

  // Transform allocations for AllocationDonut
  const donutData = useMemo(() => {
    return explanation.instruments
      .filter((i) => i.funded)
      .map((i) => ({
        name: i.name,
        amount: Number(BigInt(i.allocatedMinor || "0")),
      }));
  }, [explanation]);

  const totalDeployedMinor = useMemo(() => {
    return explanation.instruments.reduce((acc, curr) => acc + BigInt(curr.allocatedMinor || "0"), 0n);
  }, [explanation]);

  const totalSurplusMinor = BigInt(activeDecision.surplusMinor || "0");
  const unallocatedMinor = totalSurplusMinor > totalDeployedMinor ? totalSurplusMinor - totalDeployedMinor : 0n;

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

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Surplus Yield Optimizer</h1>
            {renderSourceBadge()}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Greedy surplus deployment across money-market instruments ordered by net unit value v_i net of exit penalties.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/analytics"
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Policy Comparison <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {/* Unauthenticated / Mock Demonstration Callout */}
      {!isLive && (
        <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-4 text-sm text-foreground">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-blue-500">Sample Portfolio Optimization</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Showing sample yield allocations. Sign in with a verified account to view your organization&apos;s live instrument portfolio and optimal capital deployment.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Under-Reserved Alert if status is UNDER_RESERVED */}
      {activeDecision.status === "UNDER_RESERVED" && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-xs text-destructive">
          <div className="flex items-start gap-3">
            <ShieldAlert className="h-5 w-5 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">All Surplus Yield Deployments Halted: Bank is UNDER_RESERVED</p>
              <p className="mt-1 leading-relaxed">
                Available unencumbered cash is below the required Basel III reserve target. All new yield deployments are suspended to preserve immediate liquidity. Existing holdings are prioritized for penalty-minimizing liquidation.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Top Portfolio Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium uppercase tracking-wider">Deployable Surplus</span>
            <DollarSign className="h-4 w-4 text-primary" />
          </div>
          <p className="mt-2 text-xl font-bold text-foreground">
            {Money.fromMinor(totalSurplusMinor).format()}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Budget (C − R)
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium uppercase tracking-wider">Total Deployed</span>
            <TrendingUp className="h-4 w-4 text-emerald-500" />
          </div>
          <p className="mt-2 text-xl font-bold text-emerald-600 dark:text-emerald-400">
            {Money.fromMinor(totalDeployedMinor).format()}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {totalSurplusMinor > 0n ? `${((Number(totalDeployedMinor) / Number(totalSurplusMinor)) * 100).toFixed(1)}% of surplus` : "0% deployed"}
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium uppercase tracking-wider">Unallocated Buffer</span>
            <Layers className="h-4 w-4 text-primary" />
          </div>
          <p className="mt-2 text-xl font-bold text-foreground">
            {Money.fromMinor(unallocatedMinor).format()}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Retained in liquid cash
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium uppercase tracking-wider">Optimization Status</span>
            <Percent className="h-4 w-4 text-primary" />
          </div>
          <p className="mt-2 text-xl font-bold text-foreground">
            {activeDecision.status}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {explanation.instruments.filter((i) => i.funded).length} of {explanation.instruments.length} funded
          </p>
        </div>
      </div>

      {/* Donut Chart & Strategy Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center rounded-xl border border-border bg-card p-5">
        <div className="flex flex-col items-center justify-center">
          <AllocationDonut allocations={donutData} totalMinor={Number(totalDeployedMinor)} />
          <span className="mt-2 text-xs font-medium text-muted-foreground">Capital Deployment Distribution</span>
        </div>

        <div className="md:col-span-2 space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Greedy Surplus Allocation Principles</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            The optimizer evaluates each money-market instrument by its net unit value:
            <code className="mx-1 font-mono bg-muted px-1.5 py-0.5 rounded text-foreground font-semibold">
              v_i = r_i · (H / 8760) − π_i · p_i
            </code>
            where <span className="font-semibold text-foreground">r_i</span> is annualized APY, <span className="font-semibold text-foreground">H</span> is horizon hours, <span className="font-semibold text-foreground">π_i</span> is early-exit penalty rate, and <span className="font-semibold text-foreground">p_i</span> is early withdrawal probability.
          </p>
          <ul className="text-xs space-y-1.5 text-muted-foreground">
            <li className="flex items-center gap-2">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
              <span>Instruments are sorted descending by net unit return <code className="font-mono text-foreground">v_i</code> and funded greedily up to institutional capacity <code className="font-mono text-foreground">K_i</code>.</span>
            </li>
            <li className="flex items-center gap-2">
              <XCircle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
              <span>Any instrument with non-positive net unit value (<code className="font-mono text-foreground">v_i ≤ 0</code>) is strictly rejected to prevent penalty drag.</span>
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
              <span>Guarantees zero breach of required liquid reserve R (<code className="font-mono text-foreground">Σ x_i ≤ C − R</code>).</span>
            </li>
          </ul>
        </div>
      </div>

      {/* Comprehensive Allocation Table with Funding Reasons */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="p-4 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">Instrument Evaluation & Allocation Matrix</h3>
          <p className="text-xs text-muted-foreground">
            Full audit of yield rates, settlement lags, exit penalty terms, net unit values, and deterministic funding decisions.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/50 text-muted-foreground uppercase tracking-wider text-[11px] border-b border-border">
              <tr>
                <th className="py-3 px-4">Instrument</th>
                <th className="py-3 px-4">Yield (r_i)</th>
                <th className="py-3 px-4">Lag</th>
                <th className="py-3 px-4">Exit Penalty (π_i)</th>
                <th className="py-3 px-4">Draw Prob. (p_i)</th>
                <th className="py-3 px-4">Net Unit Value (v_i)</th>
                <th className="py-3 px-4 text-right">Allocated</th>
                <th className="py-3 px-4 text-right">Capacity</th>
                <th className="py-3 px-4 text-center">Util.</th>
                <th className="py-3 px-4">Funding Reason & Policy Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-foreground">
              {explanation.instruments.map((inst) => (
                <tr key={inst.instrumentId} className={inst.funded ? "bg-primary/5" : ""}>
                  <td className="py-3 px-4 font-semibold text-foreground flex items-center gap-2">
                    <div className={`h-2 w-2 rounded-full ${inst.funded ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
                    <span>{inst.name}</span>
                  </td>
                  <td className="py-3 px-4 font-mono font-medium">
                    {inst.annualRateFormatted}
                  </td>
                  <td className="py-3 px-4 text-muted-foreground">
                    {inst.settlementLagHours !== null ? `${inst.settlementLagHours}h` : "not recorded"}
                  </td>
                  <td className="py-3 px-4 text-muted-foreground">
                    {inst.penaltyFormatted}
                  </td>
                  <td className="py-3 px-4 text-muted-foreground">
                    {inst.piFormatted}
                  </td>
                  <td className={`py-3 px-4 font-mono font-bold ${inst.netUnitValue !== null && inst.netUnitValue > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                    {inst.netUnitValueFormatted}
                  </td>
                  <td className="py-3 px-4 text-right font-mono font-bold text-foreground">
                    {inst.allocatedFormatted}
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-muted-foreground">
                    {inst.capacityFormatted}
                  </td>
                  <td className="py-3 px-4 text-center font-mono">
                    {inst.utilizationFormatted}
                  </td>
                  <td className="py-3 px-4 text-xs leading-relaxed">
                    <span className={`inline-block rounded px-2 py-0.5 font-medium ${
                      inst.funded
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                        : "bg-muted text-muted-foreground"
                    }`}>
                      {inst.fundingReason}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-muted/30 p-3.5 border-t border-border text-[11px] text-muted-foreground">
          <strong>Capacity Constraint:</strong> Instruments cannot be allocated beyond institutional capacity limits K_i regardless of surplus availability.
        </div>
      </div>
    </div>
  );
}
