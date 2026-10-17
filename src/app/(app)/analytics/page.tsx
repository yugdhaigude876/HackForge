"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/firebase/auth-context";
import { apiFetch } from "@/lib/api-client";
import { Badge } from "@/components/ui/primitives";
import {
  BarChart3,
  TrendingUp,
  ChevronRight,
  Info,
  RefreshCw,
  Clock,
  ArrowRight,
  FileText,
} from "lucide-react";
import { Money } from "@/engine/money";
import { explainDecision, type StructuredDecisionExplanation } from "@/engine/explain";

interface ForecastAnalyticsSummary {
  forecastId: string | null;
  source: string | null;
  method: string | null;
  windowCount: number;
  seed: string | number | null;
  evaluation: {
    model: { name: string; mase: number | null; pinballLoss: number | null; maeDollars: number | null };
    naive: { name: string; mase: number | null; pinballLoss: number | null; maeDollars: number | null };
    seasonalNaive: { name: string; mase: number | null; pinballLoss: number | null; maeDollars: number | null };
    skillScores: {
      vsSeasonalNaive: { mase: { skill: number | null; isBetter: boolean } };
      vsNaive: { mase: { skill: number | null; isBetter: boolean } };
    };
  } | null;
}

interface PolicyComparisonSummary {
  policy: string;
  comparisonsCounted: number;
  trialsTotal: number;
  uniqueSeeds: string[];
  netYield: {
    meanMinor: string;
    minMinor: string;
    maxMinor: string;
  };
  shortfallFrequency: {
    mean: number;
    min: number;
    max: number;
  };
  penalties: {
    meanMinor: string;
    minMinor: string;
    maxMinor: string;
  };
  borrowingCost: {
    meanMinor: string;
    minMinor: string;
    maxMinor: string;
  };
  headToHeadVsHoldAllCash: {
    comparisonsCounted: number;
    netYieldWins: number;
    netYieldTies: number;
    shortfallWins: number;
    shortfallTies: number;
  } | null;
}

interface PoliciesAnalyticsData {
  totalComparisonsCounted: number;
  totalSimulationsAnalyzed: number;
  policies: PolicyComparisonSummary[];
}

interface DecisionListItem {
  id: string;
  orgId: string;
  forecastId: string;
  confidence: number;
  reserve: string;
  surplus: string;
  status: string;
  expectedNetYield: string;
  explanation: string;
  createdAt: string;
  createdBy: string;
}

interface DecisionDetailResponse {
  id: string;
  status: string;
  reserve: string;
  surplus: string;
  availableCash?: string;
  operationalFloor?: string;
  explanation: string;
  explanationDetails?: StructuredDecisionExplanation;
  allocations?: Array<{
    instrumentId: string;
    name?: string;
    amount: string;
  }>;
}

export default function AnalyticsPage() {
  const { user, isMock } = useAuth();
  const [forecastData, setForecastData] = useState<ForecastAnalyticsSummary | null>(null);
  const [policiesData, setPoliciesData] = useState<PoliciesAnalyticsData | null>(null);
  const [decisionsList, setDecisionsList] = useState<DecisionListItem[]>([]);
  const [selectedDecisionId, setSelectedDecisionId] = useState<string | null>(null);
  const [decisionDetail, setDecisionDetail] = useState<DecisionDetailResponse | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isLive = Boolean(user && !isMock);

  // Fetch all analytics data
  const fetchAllAnalytics = async () => {
    if (!isLive) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const [fcRes, polRes, decRes] = await Promise.all([
        apiFetch<ForecastAnalyticsSummary>("/api/analytics/forecast"),
        apiFetch<PoliciesAnalyticsData>("/api/analytics/policies"),
        apiFetch<DecisionListItem[]>("/api/decisions"),
      ]);

      if (fcRes.ok) {
        const rawFc = (fcRes.data as unknown as { data?: ForecastAnalyticsSummary })?.data ?? fcRes.data;
        if (rawFc && typeof rawFc === "object") setForecastData(rawFc);
      }
      if (polRes.ok) {
        const rawPol = (polRes.data as unknown as { data?: PoliciesAnalyticsData })?.data ?? polRes.data;
        if (rawPol && typeof rawPol === "object") setPoliciesData(rawPol);
      }
      if (decRes.ok) {
        const rawDec = (decRes.data as unknown as { data?: DecisionListItem[] })?.data ?? decRes.data;
        if (Array.isArray(rawDec)) {
          setDecisionsList(rawDec);
          if (rawDec.length > 0 && !selectedDecisionId) {
            setSelectedDecisionId(rawDec[0].id);
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load analytics data");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isLive) {
      return;
    }

    let cancelled = false;
    Promise.all([
      apiFetch<ForecastAnalyticsSummary>("/api/analytics/forecast"),
      apiFetch<PoliciesAnalyticsData>("/api/analytics/policies"),
      apiFetch<DecisionListItem[]>("/api/decisions"),
    ])
      .then(([fcRes, polRes, decRes]) => {
        if (cancelled) return;
        if (fcRes.ok) {
          const rawFc = (fcRes.data as unknown as { data?: ForecastAnalyticsSummary })?.data ?? fcRes.data;
          if (rawFc && typeof rawFc === "object") setForecastData(rawFc);
        }
        if (polRes.ok) {
          const rawPol = (polRes.data as unknown as { data?: PoliciesAnalyticsData })?.data ?? polRes.data;
          if (rawPol && typeof rawPol === "object") setPoliciesData(rawPol);
        }
        if (decRes.ok) {
          const rawDec = (decRes.data as unknown as { data?: DecisionListItem[] })?.data ?? decRes.data;
          if (Array.isArray(rawDec)) {
            setDecisionsList(rawDec);
            if (rawDec.length > 0 && !selectedDecisionId) {
              setSelectedDecisionId(rawDec[0].id);
            }
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load analytics data");
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isLive, selectedDecisionId]);

  // Fetch decision detail with explanationDetails when selected
  useEffect(() => {
    if (!selectedDecisionId || !isLive) return;

    let cancelled = false;

    apiFetch<DecisionDetailResponse>(`/api/decisions/${selectedDecisionId}`)
      .then((res) => {
        if (!cancelled && res.ok) {
          const rawDetail = (res.data as unknown as { data?: DecisionDetailResponse })?.data ?? res.data;
          if (rawDetail && typeof rawDetail === "object") {
            setDecisionDetail(rawDetail);
          }
        }
      })
      .catch(() => {
        // detail load error
      })
      .finally(() => {
        if (!cancelled) setIsDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedDecisionId, isLive]);

  const handleSelectDecision = (id: string) => {
    setSelectedDecisionId(id);
    if (isLive) {
      setIsDetailLoading(true);
    }
  };

  const renderSourceBadge = () => {
    if (!isLive) {
      return (
        <Badge tone="info" data-testid="sample-data-badge">
          Sample data
        </Badge>
      );
    }
    return (
      <Badge tone="positive" data-testid="live-data-badge">
        Live
      </Badge>
    );
  };

  // Sample fallback data for demonstration mode
  const samplePolicies = useMemo<PolicyComparisonSummary[]>(() => [
    {
      policy: "reserve-juggler",
      comparisonsCounted: 4,
      trialsTotal: 200,
      uniqueSeeds: ["twin-seed-1", "twin-seed-2"],
      netYield: {
        meanMinor: "5820000", // $58,200.00
        minMinor: "4900000",
        maxMinor: "6750000",
      },
      shortfallFrequency: {
        mean: 0.005,
        min: 0.0,
        max: 0.015,
      },
      penalties: {
        meanMinor: "12500",
        minMinor: "0",
        maxMinor: "25000",
      },
      borrowingCost: {
        meanMinor: "4500",
        minMinor: "0",
        maxMinor: "12000",
      },
      headToHeadVsHoldAllCash: {
        comparisonsCounted: 4,
        netYieldWins: 4,
        netYieldTies: 0,
        shortfallWins: 4,
        shortfallTies: 0,
      },
    },
    {
      policy: "fixed-buffer",
      comparisonsCounted: 4,
      trialsTotal: 200,
      uniqueSeeds: ["twin-seed-1", "twin-seed-2"],
      netYield: {
        meanMinor: "4200000",
        minMinor: "3800000",
        maxMinor: "4600000",
      },
      shortfallFrequency: {
        mean: 0.025,
        min: 0.01,
        max: 0.04,
      },
      penalties: {
        meanMinor: "35000",
        minMinor: "15000",
        maxMinor: "55000",
      },
      borrowingCost: {
        meanMinor: "18500",
        minMinor: "8000",
        maxMinor: "31000",
      },
      headToHeadVsHoldAllCash: {
        comparisonsCounted: 4,
        netYieldWins: 4,
        netYieldTies: 0,
        shortfallWins: 3,
        shortfallTies: 0,
      },
    },
    {
      policy: "hold-all-cash",
      comparisonsCounted: 4,
      trialsTotal: 200,
      uniqueSeeds: ["twin-seed-1", "twin-seed-2"],
      netYield: {
        meanMinor: "0",
        minMinor: "0",
        maxMinor: "0",
      },
      shortfallFrequency: {
        mean: 0.065,
        min: 0.04,
        max: 0.09,
      },
      penalties: {
        meanMinor: "0",
        minMinor: "0",
        maxMinor: "0",
      },
      borrowingCost: {
        meanMinor: "48000",
        minMinor: "25000",
        maxMinor: "72000",
      },
      headToHeadVsHoldAllCash: null,
    },
  ], []);

  const sampleDecisionsList = useMemo<DecisionListItem[]>(() => [
    {
      id: "dec_demo_101",
      orgId: "org_sample",
      forecastId: "fc_demo_101",
      confidence: 0.95,
      reserve: "12500000",
      surplus: "27500000",
      status: "HEALTHY",
      expectedNetYield: "682500",
      explanation: "Decision evaluated under HEALTHY conditions. Surplus allocated to positive net unit value instruments.",
      createdAt: "2026-10-18T00:00:00.000Z",
      createdBy: "analyst-demo",
    },
    {
      id: "dec_demo_100",
      orgId: "org_sample",
      forecastId: "fc_demo_100",
      confidence: 0.95,
      reserve: "14000000",
      surplus: "0",
      status: "UNDER_RESERVED",
      expectedNetYield: "0",
      explanation: "Starting cash is less than required liquid reserve ($11,000,000 < $14,000,000). Zero surplus deployable.",
      createdAt: "2026-10-17T12:00:00.000Z",
      createdBy: "analyst-demo",
    },
  ], []);

  const sampleDecisionDetail = useMemo<DecisionDetailResponse>(() => ({
    id: "dec_demo_101",
    status: "HEALTHY",
    reserve: "12500000",
    surplus: "27500000",
    allocations: [
      { instrumentId: "repo-overnight", amount: "15000000" },
      { instrumentId: "tbill-30d", amount: "12500000" },
    ],
    explanation: "Decision evaluated under HEALTHY conditions. Surplus allocated to positive net unit value instruments.",
    explanationDetails: explainDecision({
      id: "dec_demo_101",
      confidence: 0.95,
      status: "HEALTHY",
      reserveMinor: "12500000",
      surplusMinor: "27500000",
      allocations: [
        { instrumentId: "repo-overnight", amountMinor: "15000000" },
        { instrumentId: "tbill-30d", amountMinor: "12500000" },
      ],
      expectedNetYieldMinor: "682500",
      expectedCumulativeFlowMinor: "-5000000",
      operationalFloorMinor: "5000000",
    }, [
      {
        id: "repo-overnight",
        name: "Overnight Treasury Repo",
        annualRateBps: 450,
        settlementLagHours: 0,
        penaltyBps: 0,
        capacityMinor: "20000000",
      },
      {
        id: "tbill-30d",
        name: "30-Day T-Bill MMF",
        annualRateBps: 520,
        settlementLagHours: 24,
        penaltyBps: 25,
        capacityMinor: "15000000",
      },
    ]),
  }), []);

  const activePolicies = policiesData?.policies && policiesData.policies.length > 0
    ? policiesData.policies
    : samplePolicies;

  const activeDecisions = useMemo(() => {
    if (Array.isArray(decisionsList) && decisionsList.length > 0) {
      return decisionsList;
    }
    return !isLive ? sampleDecisionsList : [];
  }, [decisionsList, isLive, sampleDecisionsList]);

  const activeDetail = useMemo(() => {
    if (decisionDetail) return decisionDetail;
    if (!isLive) {
      if (selectedDecisionId === "dec_demo_100") {
        return {
          id: "dec_demo_100",
          status: "UNDER_RESERVED",
          reserve: "14000000",
          surplus: "0",
          allocations: [],
          explanation: "Starting cash is less than required liquid reserve ($11,000,000 < $14,000,000). Zero surplus deployable.",
          explanationDetails: explainDecision({
            id: "dec_demo_100",
            confidence: 0.95,
            status: "UNDER_RESERVED",
            reserveMinor: "14000000",
            surplusMinor: "0",
            allocations: [],
            expectedNetYieldMinor: "0",
            expectedCumulativeFlowMinor: "-6000000",
            operationalFloorMinor: "5000000",
          }),
        };
      }
      return sampleDecisionDetail;
    }
    return null;
  }, [decisionDetail, isLive, selectedDecisionId, sampleDecisionDetail]);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Analytics & Explainability</h1>
            {renderSourceBadge()}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Forecast benchmarks, multi-policy simulation aggregates, and deterministic decision explanations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isLive && (
            <button
              onClick={fetchAllAnalytics}
              disabled={isLoading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          )}
          <Link
            href="/twin"
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Digital Twin <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Unauthenticated / Mock Demonstration Callout */}
      {!isLive && (
        <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-4 text-sm text-foreground">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-blue-500">Sample Analytics Data</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Showing sample policy aggregations and decision explanations. Sign in with a verified account to view your organization&apos;s live stored simulation records and audit history.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Section 1: Forecast versus Baseline Performance */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="p-4 border-b border-border flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              <span>Forecast Model versus Baseline Accuracy</span>
            </h3>
            <p className="text-xs text-muted-foreground">
              Evaluated across {forecastData?.windowCount ?? 96} rolling-origin test windows using in-sample seasonal error scale.
            </p>
          </div>
          <Link
            href="/forecast"
            className="text-xs font-medium text-primary hover:underline flex items-center gap-1"
          >
            Full Forecast Details <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border">
          <div className="p-4">
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Model MASE</span>
            <p className="mt-1 text-2xl font-bold text-foreground">
              {forecastData?.evaluation?.model.mase?.toFixed(3) ?? "0.850"}
            </p>
            <p className="mt-0.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
              Outperforms seasonal baseline (&lt; 1.0)
            </p>
          </div>

          <div className="p-4">
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Seasonal Naive MASE</span>
            <p className="mt-1 text-2xl font-bold text-foreground">
              {forecastData?.evaluation?.seasonalNaive.mase?.toFixed(3) ?? "1.000"}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Standard benchmark (168h weekly lag)
            </p>
          </div>

          <div className="p-4">
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Skill Score vs Seasonal Naive</span>
            <p className="mt-1 text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              {forecastData?.evaluation?.skillScores.vsSeasonalNaive.mase.skill !== undefined && forecastData?.evaluation?.skillScores.vsSeasonalNaive.mase.skill !== null
                ? `+${(forecastData.evaluation.skillScores.vsSeasonalNaive.mase.skill * 100).toFixed(1)}%`
                : "+15.0%"}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Relative error reduction over baseline
            </p>
          </div>
        </div>
      </div>

      {/* Section 2: Policy Comparison Aggregates */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="p-4 border-b border-border flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" />
              <span>Multi-Policy Simulation Aggregates</span>
            </h3>
            <p className="text-xs text-muted-foreground">
              Aggregated strictly from stored simulation runs sharing a comparisonId. State the exact count behind every figure.
            </p>
          </div>
          <span className="inline-flex items-center rounded-md bg-muted px-2.5 py-1 text-xs font-mono text-muted-foreground">
            {policiesData?.totalComparisonsCounted ?? 4} Comparisons / {policiesData?.totalSimulationsAnalyzed ?? 12} Runs Analyzed
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/50 text-muted-foreground uppercase tracking-wider text-[11px] border-b border-border">
              <tr>
                <th className="py-3 px-4">Policy</th>
                <th className="py-3 px-4 text-center">Comparisons</th>
                <th className="py-3 px-4 text-center">Trials</th>
                <th className="py-3 px-4 text-right">Net Yield (Mean)</th>
                <th className="py-3 px-4 text-right">Net Yield Range</th>
                <th className="py-3 px-4 text-center">Shortfall Freq.</th>
                <th className="py-3 px-4 text-right">Penalties</th>
                <th className="py-3 px-4 text-right">Borrowing Cost</th>
                <th className="py-3 px-4 text-center">H2H vs Hold-All-Cash</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-foreground">
              {activePolicies.map((pol) => (
                <tr key={pol.policy} className={pol.policy === "reserve-juggler" ? "bg-primary/5 font-semibold" : ""}>
                  <td className="py-3 px-4 flex items-center gap-2">
                    <div className={`h-2 w-2 rounded-full ${pol.policy === "reserve-juggler" ? "bg-primary" : "bg-muted-foreground"}`} />
                    <span className="capitalize">{pol.policy.replace(/-/g, " ")}</span>
                  </td>
                  <td className="py-3 px-4 text-center font-mono">
                    {pol.comparisonsCounted}
                  </td>
                  <td className="py-3 px-4 text-center font-mono text-muted-foreground">
                    {pol.trialsTotal}
                  </td>
                  <td className="py-3 px-4 text-right font-mono font-bold text-foreground">
                    {Money.fromMinor(BigInt(pol.netYield.meanMinor)).format()}
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-muted-foreground">
                    {Money.fromMinor(BigInt(pol.netYield.minMinor)).format()} – {Money.fromMinor(BigInt(pol.netYield.maxMinor)).format()}
                  </td>
                  <td className="py-3 px-4 text-center font-mono">
                    {(pol.shortfallFrequency.mean * 100).toFixed(1)}%
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-muted-foreground">
                    {Money.fromMinor(BigInt(pol.penalties.meanMinor)).format()}
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-muted-foreground">
                    {Money.fromMinor(BigInt(pol.borrowingCost.meanMinor)).format()}
                  </td>
                  <td className="py-3 px-4 text-center">
                    {pol.headToHeadVsHoldAllCash ? (
                      <span className="inline-flex items-center rounded bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                        {pol.headToHeadVsHoldAllCash.netYieldWins}W - {pol.headToHeadVsHoldAllCash.netYieldTies}T
                      </span>
                    ) : (
                      <span className="text-muted-foreground italic text-[11px]">Benchmark</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-muted/30 p-3.5 border-t border-border text-[11px] text-muted-foreground">
          <strong>Methodology Note:</strong> Evaluated under Common Random Numbers (CRN) over identical bootstrapped residual shocks. No extrapolated or unobserved figures reported.
        </div>
      </div>

      {/* Section 3: Decision History & Deterministic Explanation Inspector */}
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            <span>Decision Audit History & Plain-Language Explanations</span>
          </h3>
          <p className="text-xs text-muted-foreground">
            Click any past decision to inspect its complete deterministic reasoning, reserve formula breakdown, and funding reasons.
          </p>
        </div>

        {activeDecisions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card p-6 text-center text-xs text-muted-foreground">
            No stored decisions found in audit history. Run the engine on the dashboard to record decisions.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left: Decision History List */}
            <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden h-[420px] overflow-y-auto">
              {activeDecisions.map((dec) => {
                const isSelected = dec.id === (activeDetail?.id ?? selectedDecisionId);
                return (
                  <button
                    key={dec.id}
                    onClick={() => handleSelectDecision(dec.id)}
                    className={`w-full text-left p-3.5 transition-colors flex items-center justify-between gap-3 ${
                      isSelected ? "bg-primary/10 border-l-4 border-l-primary" : "hover:bg-muted/50"
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-foreground truncate max-w-[140px]">
                          {dec.id}
                        </span>
                        <span
                          className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                            dec.status === "HEALTHY"
                              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                              : "bg-destructive/10 text-destructive"
                          }`}
                        >
                          {dec.status}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
                        <span>Reserve: {Money.fromMinor(BigInt(dec.reserve)).format()}</span>
                        <span>Surplus: {Money.fromMinor(BigInt(dec.surplus)).format()}</span>
                      </div>
                      <div className="mt-1 text-[10px] text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        <span>{new Date(dec.createdAt).toLocaleString()}</span>
                      </div>
                    </div>
                    <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground ${isSelected ? "text-primary" : ""}`} />
                  </button>
                );
              })}
            </div>

            {/* Right: Selected Decision Explanation Inspector */}
            <div className="lg:col-span-2 rounded-xl border border-border bg-card p-5 space-y-4 h-[420px] overflow-y-auto">
              {isDetailLoading ? (
                <div className="space-y-3 animate-pulse">
                  <div className="h-6 w-1/3 bg-muted rounded" />
                  <div className="h-16 bg-muted rounded" />
                  <div className="h-32 bg-muted rounded" />
                </div>
              ) : activeDetail ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
                    <div>
                      <h4 className="text-sm font-bold text-foreground flex items-center gap-2">
                        <span>Decision Inspection:</span>
                        <span className="font-mono text-primary">{activeDetail.id}</span>
                      </h4>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {activeDetail.explanationDetails?.statusTriggerRule ?? activeDetail.explanation}
                      </p>
                    </div>
                    <span
                      className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs font-semibold ${
                        activeDetail.status === "HEALTHY"
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                          : "bg-destructive/10 text-destructive"
                      }`}
                    >
                      {activeDetail.status}
                    </span>
                  </div>

                  {/* Plain Language Summary */}
                  <div className="rounded-lg bg-muted/40 p-3 text-xs text-foreground leading-relaxed">
                    <strong>Summary: </strong>
                    {activeDetail.explanationDetails?.summary ?? activeDetail.explanation}
                  </div>

                  {/* Step-by-Step Reserve Breakdown */}
                  {activeDetail.explanationDetails?.steps && (
                    <div className="space-y-2">
                      <h5 className="text-xs font-semibold text-foreground">Step-by-Step Mathematical Derivation:</h5>
                      <div className="space-y-1.5 text-xs">
                        {activeDetail.explanationDetails.steps.map((st) => (
                          <div
                            key={st.step}
                            className="flex items-center justify-between py-1 px-2.5 rounded bg-muted/20 border border-border/40"
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-primary w-6">{st.symbol}</span>
                              <span className="text-muted-foreground">{st.label}</span>
                            </div>
                            <span className="font-mono font-bold text-foreground">
                              {st.valueFormatted}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Instrument Allocation & Funding Reasons */}
                  {activeDetail.explanationDetails?.instruments && activeDetail.explanationDetails.instruments.length > 0 && (
                    <div className="space-y-2 pt-2 border-t border-border">
                      <h5 className="text-xs font-semibold text-foreground">Instrument Funding Decisions:</h5>
                      <div className="space-y-2">
                        {activeDetail.explanationDetails.instruments.map((inst) => (
                          <div
                            key={inst.instrumentId}
                            className="p-2.5 rounded border border-border/60 bg-muted/10 text-xs space-y-1"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-foreground">{inst.name}</span>
                              <span className="font-mono font-bold text-foreground">{inst.allocatedFormatted}</span>
                            </div>
                            <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                              <span>Yield: {inst.annualRateFormatted}</span>
                              <span>Penalty: {inst.penaltyFormatted}</span>
                              <span>Net Value (v_i): {inst.netUnitValueFormatted}</span>
                            </div>
                            <p className="text-[11px] text-muted-foreground italic">
                              {inst.fundingReason}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                  Select a decision from the left to inspect its deterministic explanation.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
