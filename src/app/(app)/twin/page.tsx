"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  Activity,
  Play,
  RotateCcw,
  Copy,
  Check,
  AlertTriangle,
  ShieldAlert,
  Loader2,
  Clock,
  Sparkles,
  ExternalLink,
} from "lucide-react";
import { Panel, EmptyState, LoadingState } from "@/components/finance/panels";
import { Button, Badge, Card } from "@/components/ui/primitives";
import { apiFetch } from "@/lib/api-client";
import { useAuth } from "@/lib/firebase/auth-context";
import { useOrgRole } from "@/hooks/use-org-role";
import {
  TwinComparisonChart,
  type CashPointDTO,
} from "@/components/finance/twin-comparison-chart";
import {
  TwinComparisonTable,
  type SerializedPolicyMetricRecord,
  type PolicyDeltasDTO,
} from "@/components/finance/twin-comparison-table";
import { TwinReplayScrubber } from "@/components/finance/twin-replay-scrubber";
import { compareScenarioAcrossPolicies } from "@/engine/simulate";
import { generateTransactions } from "@/engine/generator";
import { buildContinuousTimeSeries } from "@/engine/timeseries";
import { Money } from "@/engine/money";
import { FallbackBanner } from "@/components/ui/fallback-banner";
import { useDataSource } from "@/components/providers/data-source-provider";

interface InstrumentDTO {
  id: string;
  name: string;
  annualRateBps: number;
}

interface StoredComparisonSummary {
  comparisonId: string;
  scenario: unknown;
  seed: string | number;
  policies: string[];
  source?: string;
  createdAt: string;
  trials?: number;
  horizonHours?: number;
}

interface ComparisonResponseData {
  comparisonId: string;
  seed: string;
  trials: number;
  horizonHours: number;
  scenario: {
    outflowShockPct?: number;
    shockStartHour?: number;
    shockDurationHours?: number;
    settlementDelayHours?: number;
    correlatedRun?: {
      intensityPct: number;
      decay: number;
    };
    yieldRateShockBps?: number;
    instrumentOutageIds?: string[];
    confidence: number;
  };
  policies: string[];
  policyResults: Record<
    string,
    {
      policy: string;
      seed: string;
      trials: number;
      horizonHours: number;
      shortfallFrequency: number;
      expectedShortfallMinor: string;
      p95ShortfallMinor: string;
      emergencyBorrowingCostMinor: string;
      penaltiesPaidMinor: string;
      grossYieldMinor: string;
      netYieldMinor: string;
      meanIdleCashMinor?: string;
      idleCashHoursMinor: string;
      cashPath: CashPointDTO[];
    }
  >;
  deltas?: Record<string, PolicyDeltasDTO>;
  winners?: {
    netYield: string;
    shortfallFrequency: string;
    expectedShortfall: string;
    p95Shortfall: string;
    penaltiesPaid: string;
    emergencyBorrowingCost: string;
  };
  source?: string;
  createdAt?: string;
  disclaimer: string;
}

const PRESETS = [
  {
    name: "Deposit outflow shock",
    description: "+35% outflow surge during hours 2–14",
    config: {
      outflowShockPct: 35,
      shockStartHour: 2,
      shockDurationHours: 12,
      settlementDelayHours: 0,
      enableRun: false,
      runIntensity: 40,
      runDecay: 0.85,
      yieldRateShockBps: 0,
      confidence: 99.0,
      horizonHours: 24,
      trials: 500,
    },
  },
  {
    name: "Settlement delay",
    description: "12-hour freeze on inbound settlements",
    config: {
      outflowShockPct: 15,
      shockStartHour: 0,
      shockDurationHours: 24,
      settlementDelayHours: 12,
      enableRun: false,
      runIntensity: 30,
      runDecay: 0.85,
      yieldRateShockBps: 0,
      confidence: 99.0,
      horizonHours: 24,
      trials: 500,
    },
  },
  {
    name: "Bank-run tail",
    description: "Acute outflow shock with exponential decay tail",
    config: {
      outflowShockPct: 40,
      shockStartHour: 1,
      shockDurationHours: 18,
      settlementDelayHours: 4,
      enableRun: true,
      runIntensity: 50,
      runDecay: 0.85,
      yieldRateShockBps: 0,
      confidence: 99.5,
      horizonHours: 24,
      trials: 500,
    },
  },
  {
    name: "Rate drop",
    description: "-150 bps market rate plunge",
    config: {
      outflowShockPct: 10,
      shockStartHour: 0,
      shockDurationHours: 24,
      settlementDelayHours: 0,
      enableRun: false,
      runIntensity: 20,
      runDecay: 0.85,
      yieldRateShockBps: -150,
      confidence: 99.0,
      horizonHours: 24,
      trials: 500,
    },
  },
  {
    name: "Instrument outage",
    description: "Outage freezes liquidation of selected yield positions",
    config: {
      outflowShockPct: 25,
      shockStartHour: 4,
      shockDurationHours: 12,
      settlementDelayHours: 6,
      enableRun: false,
      runIntensity: 25,
      runDecay: 0.85,
      yieldRateShockBps: 0,
      confidence: 99.0,
      horizonHours: 24,
      trials: 500,
    },
  },
];

export default function DigitalTwinPage() {
  const { user, isMock } = useAuth();
  const isLive = Boolean(user && !isMock);
  const { role: serverRole, loading: isRoleLoading } = useOrgRole();
  const userRole = isLive ? (serverRole ?? "viewer") : "viewer";
  const canRun = isLive && !isRoleLoading && Boolean(serverRole) && (userRole as string) !== "viewer";

  // Scenario Builder state
  const [outflowShockPct, setOutflowShockPct] = useState<number>(25);
  const [shockStartHour, setShockStartHour] = useState<number>(2);
  const [shockDurationHours, setShockDurationHours] = useState<number>(12);
  const [settlementDelayHours, setSettlementDelayHours] = useState<number>(0);
  const [enableCorrelatedRun, setEnableCorrelatedRun] = useState<boolean>(false);
  const [runIntensityPct, setRunIntensityPct] = useState<number>(40);
  const [runDecay, setRunDecay] = useState<number>(0.85);
  const [yieldRateShockBps, setYieldRateShockBps] = useState<number>(0);
  const [selectedOutages, setSelectedOutages] = useState<string[]>([]);
  const [confidence, setConfidence] = useState<number>(99.0);
  const [horizonHours, setHorizonHours] = useState<number>(24);
  const [trials, setTrials] = useState<number>(500);
  const [bufferPct, setBufferPct] = useState<number>(20);
  const [seed, setSeed] = useState<string>("sim-twin-seed");
  const [copiedSeed, setCopiedSeed] = useState<boolean>(false);

  // Available instruments loaded from org
  const [orgInstruments, setOrgInstruments] = useState<InstrumentDTO[]>([]);

  // Execution & Replay state
  const orgId = process.env.NEXT_PUBLIC_DEFAULT_ORG_ID || "org_demo";
  const { setSource } = useDataSource();
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isBaselineMissing, setIsBaselineMissing] = useState<boolean>(false);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(null);
  const [activeComparison, setActiveComparison] = useState<ComparisonResponseData | null>(null);
  const [scrubbedHour, setScrubbedHour] = useState<number>(0);
  const [isFallback, setIsFallback] = useState<boolean>(false);
  const [fallbackRequestId, setFallbackRequestId] = useState<string | null>(null);

  // Sync top bar source
  useEffect(() => {
    if (isFallback || activeComparison?.source === "offline-fallback") {
      setSource("offline-fallback");
    } else {
      setSource(null);
    }
  }, [isFallback, activeComparison?.source, setSource]);

  // History state
  const [historyList, setHistoryList] = useState<StoredComparisonSummary[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(false);

  // Load Org Instruments on Mount
  useEffect(() => {
    if (!isLive) return;
    apiFetch<{ instruments: InstrumentDTO[] }>("/api/instruments")
      .then((res) => {
        if (res.ok && res.data?.instruments) {
          setOrgInstruments(res.data.instruments);
        }
      })
      .catch(() => {});
  }, [isLive]);

  // Refresh Recent Comparisons
  const refreshHistory = () => {
    if (!isLive) return;
    setIsLoadingHistory(true);
    apiFetch<{ comparisons: StoredComparisonSummary[] }>("/api/simulations/compare")
      .then((res) => {
        if (res.ok && res.data?.comparisons) {
          setHistoryList(res.data.comparisons);
        }
      })
      .catch(() => {})
      .finally(() => setIsLoadingHistory(false));
  };

  // Initial load of history
  useEffect(() => {
    if (!isLive) return;
    let cancelled = false;
    apiFetch<{ comparisons: StoredComparisonSummary[] }>("/api/simulations/compare")
      .then((res) => {
        if (!cancelled && res.ok && res.data?.comparisons) {
          setHistoryList(res.data.comparisons);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isLive]);

  // Rate limiter countdown
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

  // Apply Preset
  const handleApplyPreset = (preset: (typeof PRESETS)[number]) => {
    const c = preset.config;
    setOutflowShockPct(c.outflowShockPct);
    setShockStartHour(c.shockStartHour);
    setShockDurationHours(c.shockDurationHours);
    setSettlementDelayHours(c.settlementDelayHours);
    setEnableCorrelatedRun(c.enableRun);
    setRunIntensityPct(c.runIntensity);
    setRunDecay(c.runDecay);
    setYieldRateShockBps(c.yieldRateShockBps);
    setConfidence(c.confidence);
    setHorizonHours(c.horizonHours);
    setTrials(c.trials);

    if (preset.name === "Instrument outage" && orgInstruments.length > 0) {
      setSelectedOutages([orgInstruments[0].id]);
    } else {
      setSelectedOutages([]);
    }
  };

  // Copy Seed
  const handleCopySeed = () => {
    navigator.clipboard.writeText(seed);
    setCopiedSeed(true);
    setTimeout(() => setCopiedSeed(false), 2000);
  };

  // Randomize Seed
  const handleRandomizeSeed = () => {
    setSeed(`twin-${Math.random().toString(36).slice(2, 8)}`);
  };

  // Run local Monte Carlo comparison fallback
  const runLocalComparison = (reqId?: string) => {
    const endDate = new Date("2026-03-01T00:00:00.000Z");
    const startDate = new Date(endDate.getTime() - 28 * 24 * 3600_000);
    const txs = generateTransactions({
      seed,
      startDate,
      endDate,
      baseVolumePerHour: Money.fromMajor(20_000_000, "USD"),
    });
    const history = buildContinuousTimeSeries(txs, { startDate, endDate, currency: "USD" });

    const localComp = compareScenarioAcrossPolicies({
      history,
      startingCash: Money.fromMajor(50_000_000, "USD"),
      instruments: [
        {
          id: "tier1_repo",
          name: "Tier 1: Overnight Repo",
          apy: 0.0429,
          capacity: Money.fromMajor(25_000_000, "USD"),
          withdrawalPenalty: 0.005,
          settlementLagHours: 0,
          earlyWithdrawalRisk: 0.0,
        },
        {
          id: "tier2_bonds",
          name: "Tier 2: 2Y Sovereign Bonds",
          apy: 0.048,
          capacity: Money.fromMajor(15_000_000, "USD"),
          withdrawalPenalty: 0.02,
          settlementLagHours: 0,
          earlyWithdrawalRisk: 0.05,
        },
        {
          id: "tier3_equities",
          name: "Tier 3: Growth Equities",
          apy: 0.10,
          capacity: Money.fromMajor(10_000_000, "USD"),
          withdrawalPenalty: 0.15,
          settlementLagHours: 0,
          earlyWithdrawalRisk: 0.15,
        },
      ],
      scenario: {
        outflowShockPct,
        shockStartHour,
        shockDurationHours,
        settlementDelayHours,
        correlatedRun: enableCorrelatedRun
          ? { intensityPct: runIntensityPct, decay: runDecay }
          : undefined,
        yieldRateShockBps,
        instrumentOutageIds: selectedOutages,
        confidence: confidence / 100,
      },
      policies: ["reserve-juggler", "hold-all-cash", "fixed-buffer"],
      policyParams: { bufferPct: bufferPct / 100 },
      trials: Math.min(trials, 100),
      horizonHours,
      seed,
    });

    const policyResultsFormatted: ComparisonResponseData["policyResults"] = {};
    for (const [pol, res] of Object.entries(localComp.policyResults)) {
      policyResultsFormatted[pol] = {
        policy: pol,
        seed,
        trials: localComp.trials,
        horizonHours: localComp.horizonHours,
        shortfallFrequency: res.shortfallFrequency,
        expectedShortfallMinor: res.expectedShortfall.amountMinor.toString(),
        p95ShortfallMinor: res.p95Shortfall.amountMinor.toString(),
        emergencyBorrowingCostMinor: res.emergencyBorrowingCost.amountMinor.toString(),
        penaltiesPaidMinor: res.penaltiesPaid.amountMinor.toString(),
        grossYieldMinor: res.grossYield.amountMinor.toString(),
        netYieldMinor: res.netYield.amountMinor.toString(),
        meanIdleCashMinor: res.meanIdleCash.amountMinor.toString(),
        idleCashHoursMinor: res.idleCashHours.amountMinor.toString(),
        cashPath: res.cashPath.map((p) => ({
          hour: p.hour,
          p5CashMinor: p.p5Cash.amountMinor.toString(),
          medianCashMinor: p.medianCash.amountMinor.toString(),
          p95CashMinor: p.p95Cash.amountMinor.toString(),
        })),
      };
    }

    const deltasFormatted: Record<string, PolicyDeltasDTO> = {};
    for (const [pol, d] of Object.entries(localComp.deltas)) {
      deltasFormatted[pol] = {
        vsHoldAllCash: d.vsHoldAllCash
          ? {
              netYieldMinor: d.vsHoldAllCash.netYield.amountMinor.toString(),
              shortfallFrequency: d.vsHoldAllCash.shortfallFrequency,
              expectedShortfallMinor: d.vsHoldAllCash.expectedShortfall.amountMinor.toString(),
              p95ShortfallMinor: d.vsHoldAllCash.p95Shortfall.amountMinor.toString(),
              penaltiesPaidMinor: d.vsHoldAllCash.penaltiesPaid.amountMinor.toString(),
              emergencyBorrowingCostMinor: d.vsHoldAllCash.emergencyBorrowingCost.amountMinor.toString(),
            }
          : undefined,
        vsFixedBuffer: d.vsFixedBuffer
          ? {
              netYieldMinor: d.vsFixedBuffer.netYield.amountMinor.toString(),
              shortfallFrequency: d.vsFixedBuffer.shortfallFrequency,
              expectedShortfallMinor: d.vsFixedBuffer.expectedShortfall.amountMinor.toString(),
              p95ShortfallMinor: d.vsFixedBuffer.p95Shortfall.amountMinor.toString(),
              penaltiesPaidMinor: d.vsFixedBuffer.penaltiesPaid.amountMinor.toString(),
              emergencyBorrowingCostMinor: d.vsFixedBuffer.emergencyBorrowingCost.amountMinor.toString(),
            }
          : undefined,
      };
    }

    const localData: ComparisonResponseData = {
      comparisonId: `cmp-local-${Date.now()}`,
      seed,
      trials: localComp.trials,
      horizonHours: localComp.horizonHours,
      scenario: localComp.scenario,
      policies: localComp.policies,
      policyResults: policyResultsFormatted,
      deltas: deltasFormatted,
      winners: localComp.winners,
      disclaimer: localComp.disclaimer,
      source: "offline-fallback",
      createdAt: new Date().toISOString(),
    };

    setActiveComparison(localData);
    setScrubbedHour(0);
    setError(null);
    setIsFallback(true);
    setFallbackRequestId(reqId || null);
  };

  // Run Comparison
  const handleRunComparison = async () => {
    if (!canRun || isRunning || retryAfterSeconds !== null) return;

    setIsRunning(true);
    setError(null);
    setIsBaselineMissing(false);

    try {
      const res = await apiFetch<ComparisonResponseData>("/api/simulations/compare", {
        method: "POST",
        body: JSON.stringify({
          scenario: {
            outflowShockPct,
            shockStartHour,
            shockDurationHours,
            settlementDelayHours,
            correlatedRun: enableCorrelatedRun
              ? { intensityPct: runIntensityPct, decay: runDecay }
              : undefined,
            yieldRateShockBps,
            instrumentOutageIds: selectedOutages,
            confidence: confidence / 100,
          },
          policies: ["reserve-juggler", "hold-all-cash", "fixed-buffer"],
          policyParams: {
            bufferPct: bufferPct / 100,
          },
          horizonHours,
          trials,
          seed,
        }),
      });

      if (res.ok) {
        setActiveComparison(res.data);
        setScrubbedHour(0);
        setError(null);
        setIsFallback(false);
        setFallbackRequestId(null);
        refreshHistory();
      } else {
        if (res.status === 401 || res.status === 403) {
          const msg = res.status === 401
            ? "Authentication required. Please sign in with an analyst account to run simulations."
            : (res.error?.message || "Permission denied. Analyst or admin access required to run simulations.");
          setError(msg);
          setIsFallback(false);
          setFallbackRequestId(null);
          return;
        }

        if (res.status === 429) {
          const details = res.error?.details as { retryAfterSeconds?: number } | undefined;
          const retrySec = details?.retryAfterSeconds ?? 10;
          setRetryAfterSeconds(retrySec);
          setError(res.error?.message || `Rate limited. Please wait ${retrySec}s.`);
          setIsFallback(false);
          setFallbackRequestId(null);
          return;
        }

        // 5xx / Network / Timeout: honest offline fallback
        console.warn(`[DigitalTwin] Server error (HTTP ${res.status}), activating offline fallback solver`);
        runLocalComparison(res.requestId);
      }
    } catch (err) {
      console.warn("[DigitalTwin] Network exception, activating offline fallback solver:", err);
      runLocalComparison(undefined);
    } finally {
      setIsRunning(false);
    }
  };

  // Replay a Stored Comparison by ID
  const handleReplayStored = async (comparisonId: string) => {
    setIsRunning(true);
    setError(null);
    try {
      const res = await apiFetch<ComparisonResponseData>(
        `/api/simulations/compare/${comparisonId}`
      );
      if (res.ok) {
        setActiveComparison(res.data);
        setScrubbedHour(0);
        setError(null);
      } else {
        setError(res.error.message || "Failed to retrieve stored comparison.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Replay fetch failed.");
    } finally {
      setIsRunning(false);
    }
  };

  // Extract policy cash paths for replay scrubber
  const policyCashPaths: Record<string, CashPointDTO[]> = {};
  if (activeComparison) {
    for (const [p, pRes] of Object.entries(activeComparison.policyResults)) {
      if (pRes.cashPath) {
        policyCashPaths[p] = pRes.cashPath;
      }
    }
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" aria-hidden />
            Digital Twin & Policy Comparison
          </h1>
          <p className="mt-1 text-xs text-muted">
            Seeded Monte Carlo stress testing and side-by-side liquidity policy comparison.
          </p>
        </div>

        {/* Status indicators */}
        <div className="flex items-center gap-2">
          {isFallback || activeComparison?.source === "offline-fallback" ? (
            <Badge tone="warning" data-testid="fallback-badge">
              Offline fallback
            </Badge>
          ) : activeComparison ? (
            <Badge tone="positive" data-testid="twin-status-badge">
              Comparison Active
            </Badge>
          ) : (
            <Badge tone="neutral">Ready</Badge>
          )}
        </div>
      </div>

      {/* Persistent Offline Fallback Banner */}
      {isFallback && (
        <FallbackBanner
          onRetry={handleRunComparison}
          requestId={fallbackRequestId}
          isRetrying={isRunning}
        />
      )}

      {/* Mock Mode / Unauthenticated Warning */}
      {!isLive && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3.5 text-xs text-foreground"
        >
          <ShieldAlert className="h-4 w-4 text-warning mt-0.5 shrink-0" aria-hidden />
          <div className="space-y-1">
            <p className="font-semibold text-warning">Simulation Disabled in Mock Mode</p>
            <p className="text-muted">
              Sign in with a real account to run simulations. Digital Twin runs require authenticated
              access to the Monte Carlo simulation engine. Pre-computed sample data is not shown to
              maintain data honesty.
            </p>
          </div>
        </div>
      )}

      {/* Viewer Role Notice */}
      {isLive && userRole === "viewer" && (
        <div
          role="status"
          className="flex items-center gap-2.5 rounded-lg border border-border bg-surface px-3.5 py-2.5 text-xs text-muted"
          data-testid="viewer-role-notice"
        >
          <Clock className="h-4 w-4 text-muted shrink-0" aria-hidden />
          <span>
            You are a viewer in org {orgId}. You have Viewer permissions. Ask an admin to grant analyst access.
          </span>
        </div>
      )}

      {/* Section 1: Scenario Builder & Presets */}
      <Panel
        title="Scenario Builder"
        description="Choose a stress shock preset or tune individual liquidity risk parameters."
      >
        <div className="space-y-5">
          {/* Presets Bar */}
          <div className="space-y-2">
            <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              Scenario Presets
            </span>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  onClick={() => handleApplyPreset(preset)}
                  className="rounded-lg border border-border bg-surface-2/40 px-3 py-1.5 text-xs font-medium text-foreground hover:border-primary/50 hover:bg-surface-2 transition-colors text-left"
                >
                  <div className="font-semibold">{preset.name}</div>
                  <div className="text-[10px] text-muted">{preset.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Parameter Sliders Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-2 border-t border-border/60">
            {/* Outflow Shock */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <label className="font-medium text-foreground">Outflow Shock Multiplier</label>
                <span className="font-mono tabular font-semibold text-primary">+{outflowShockPct}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={50}
                step={5}
                value={outflowShockPct}
                onChange={(e) => setOutflowShockPct(Number(e.target.value))}
                disabled={!canRun}
                className="w-full accent-primary"
              />
              <span className="text-[10px] text-muted">Extra outbound cash drain</span>
            </div>

            {/* Shock Window */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <label className="font-medium text-foreground">Shock Window</label>
                <span className="font-mono tabular font-semibold text-primary">
                  {shockStartHour}h – {shockStartHour + shockDurationHours}h
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="range"
                  min={0}
                  max={horizonHours - 1}
                  step={1}
                  value={shockStartHour}
                  onChange={(e) => setShockStartHour(Number(e.target.value))}
                  disabled={!canRun}
                  className="w-full accent-primary"
                  title="Shock Start Hour"
                />
                <input
                  type="range"
                  min={1}
                  max={horizonHours - shockStartHour}
                  step={1}
                  value={shockDurationHours}
                  onChange={(e) => setShockDurationHours(Number(e.target.value))}
                  disabled={!canRun}
                  className="w-full accent-primary"
                  title="Shock Duration Hours"
                />
              </div>
              <span className="text-[10px] text-muted">Activation start and duration</span>
            </div>

            {/* Settlement Delay */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <label className="font-medium text-foreground">Settlement Delay</label>
                <span className="font-mono tabular font-semibold text-primary">{settlementDelayHours}h</span>
              </div>
              <input
                type="range"
                min={0}
                max={48}
                step={2}
                value={settlementDelayHours}
                onChange={(e) => setSettlementDelayHours(Number(e.target.value))}
                disabled={!canRun}
                className="w-full accent-primary"
              />
              <span className="text-[10px] text-muted">Inbound merchant settlement withholding</span>
            </div>

            {/* Yield Rate Shift */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <label className="font-medium text-foreground">Yield Rate Shock</label>
                <span className="font-mono tabular font-semibold text-primary">{yieldRateShockBps} bps</span>
              </div>
              <input
                type="range"
                min={-300}
                max={300}
                step={25}
                value={yieldRateShockBps}
                onChange={(e) => setYieldRateShockBps(Number(e.target.value))}
                disabled={!canRun}
                className="w-full accent-primary"
              />
              <span className="text-[10px] text-muted">Market yield curve shift</span>
            </div>

            {/* Statistical Confidence */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <label className="font-medium text-foreground">Reserve Confidence (1 - α)</label>
                <span className="font-mono tabular font-semibold text-primary">{confidence.toFixed(1)}%</span>
              </div>
              <input
                type="range"
                min={90}
                max={99.9}
                step={0.1}
                value={confidence}
                onChange={(e) => setConfidence(Number(e.target.value))}
                disabled={!canRun}
                className="w-full accent-primary"
              />
              <span className="text-[10px] text-muted">Risk quantile coverage level</span>
            </div>

            {/* Fixed Buffer % */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <label className="font-medium text-foreground">Fixed-Buffer Policy Retained Cash</label>
                <span className="font-mono tabular font-semibold text-primary">{bufferPct}%</span>
              </div>
              <input
                type="range"
                min={5}
                max={50}
                step={5}
                value={bufferPct}
                onChange={(e) => setBufferPct(Number(e.target.value))}
                disabled={!canRun}
                className="w-full accent-primary"
              />
              <span className="text-[10px] text-muted">Cash buffer for the benchmark policy</span>
            </div>
          </div>

          {/* Correlated Run Toggle & Instrument Outages */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-border/60">
            {/* Correlated Bank-Run Tail */}
            <div className="rounded-lg border border-border bg-surface-2/20 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-foreground flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enableCorrelatedRun}
                    onChange={(e) => setEnableCorrelatedRun(e.target.checked)}
                    disabled={!canRun}
                    className="accent-primary rounded"
                  />
                  Correlated Bank-Run Tail
                </label>
                {enableCorrelatedRun && <Badge tone="warning">Active</Badge>}
              </div>
              {enableCorrelatedRun && (
                <div className="grid grid-cols-2 gap-3 pt-1 text-xs">
                  <div>
                    <div className="flex justify-between text-[11px] text-muted mb-1">
                      <span>Intensity:</span>
                      <span className="tabular font-medium">{runIntensityPct}%</span>
                    </div>
                    <input
                      type="range"
                      min={10}
                      max={100}
                      step={5}
                      value={runIntensityPct}
                      onChange={(e) => setRunIntensityPct(Number(e.target.value))}
                      disabled={!canRun}
                      className="w-full accent-primary"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between text-[11px] text-muted mb-1">
                      <span>Decay (δ):</span>
                      <span className="tabular font-medium">{runDecay.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min={0.5}
                      max={0.98}
                      step={0.02}
                      value={runDecay}
                      onChange={(e) => setRunDecay(Number(e.target.value))}
                      disabled={!canRun}
                      className="w-full accent-primary"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Instrument Outages Multi-Select */}
            <div className="rounded-lg border border-border bg-surface-2/20 p-3 space-y-2">
              <span className="text-xs font-semibold text-foreground">
                Frozen Instrument Outages ({selectedOutages.length})
              </span>
              <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto">
                {orgInstruments.length > 0 ? (
                  orgInstruments.map((inst) => {
                    const isOutage = selectedOutages.includes(inst.id);
                    return (
                      <button
                        key={inst.id}
                        type="button"
                        onClick={() => {
                          if (!canRun) return;
                          setSelectedOutages((prev) =>
                            isOutage ? prev.filter((id) => id !== inst.id) : [...prev, inst.id]
                          );
                        }}
                        className={`rounded px-2.5 py-1 text-xs font-medium border transition-colors ${
                          isOutage
                            ? "bg-negative/20 border-negative text-negative"
                            : "bg-surface border-border text-foreground hover:border-primary/50"
                        }`}
                      >
                        {inst.name} {isOutage ? "(Frozen)" : ""}
                      </button>
                    );
                  })
                ) : (
                  <span className="text-xs text-muted">No instruments configured for org.</span>
                )}
              </div>
            </div>
          </div>

          {/* Seed & Execution Row */}
          <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-border/60">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-muted">PRNG Seed:</span>
              <input
                type="text"
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                disabled={!canRun}
                className="h-8 rounded border border-border bg-surface px-2.5 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary w-40"
              />
              <Button size="sm" variant="outline" onClick={handleCopySeed} title="Copy Seed">
                {copiedSeed ? <Check className="h-3 w-3 text-positive" /> : <Copy className="h-3 w-3" />}
              </Button>
              <Button size="sm" variant="outline" onClick={handleRandomizeSeed} disabled={!canRun}>
                <RotateCcw className="h-3 w-3 mr-1" /> New
              </Button>
              <span className="text-[11px] text-muted font-mono ml-2">
                {trials} trials × 3 policies = {trials * 3} paths
              </span>
            </div>

            {/* Run Button */}
            {canRun && (
              <Button
                variant="primary"
                onClick={handleRunComparison}
                disabled={isRunning || retryAfterSeconds !== null}
                data-testid="run-comparison-btn"
                className="bg-[#A3E635] text-[#0B0E14] font-bold hover:bg-[#86efac] shadow-[0_0_15px_rgba(163,230,53,0.4)]"
              >
                {isRunning ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Simulating 3 Policies...
                  </>
                ) : retryAfterSeconds !== null ? (
                  `Wait ${retryAfterSeconds}s`
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-1.5 fill-current" /> Run Stress Comparison
                  </>
                )}
              </Button>
            )}

          </div>

          {/* Error Banner */}
          {error && (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-lg border border-negative/40 bg-negative/10 p-3.5 text-xs text-negative"
            >
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold">{error}</p>
                {isBaselineMissing && (
                  <p className="text-foreground">
                    Please visit the{" "}
                    <Link
                      href="/dashboard"
                      className="font-medium text-primary underline underline-offset-2 inline-flex items-center gap-1"
                    >
                      Dashboard
                      <ExternalLink className="h-3 w-3 inline" />
                    </Link>{" "}
                    to run the decision engine and initialize your organisation&apos;s liquid cash baseline.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </Panel>

      {/* Section 2: Comparison Results */}
      {activeComparison ? (
        <div className="space-y-6">
          {/* Honest Framing Banner */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/80 bg-surface px-4 py-2.5 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground">Execution Parameters:</span>
              <span className="text-muted" data-testid="execution-params-label">
                Simulated on {activeComparison.source ?? "live"} data, seed{" "}
                <span className="font-mono font-medium text-foreground">{activeComparison.seed}</span>,{" "}
                <span className="font-mono font-medium text-foreground">{activeComparison.trials}</span>{" "}
                trials per policy
              </span>
            </div>
            <Badge tone="info">Common Random Numbers</Badge>
          </div>

          {/* Overlaid Cash Path Chart */}
          <Panel
            title="Overlaid Policy Cash Paths"
            description="Median cash trajectories and p5-p95 uncertainty intervals across the 24h stress horizon."
          >
            <TwinComparisonChart
              policyResults={activeComparison.policyResults}
              policies={activeComparison.policies}
              horizonHours={activeComparison.horizonHours}
              currentHour={scrubbedHour}
              onHourSelect={(h) => setScrubbedHour(h)}
            />
          </Panel>

          {/* Timeline Replay Scrubber */}
          <TwinReplayScrubber
            horizonHours={activeComparison.horizonHours}
            currentHour={scrubbedHour}
            onHourChange={(h) => setScrubbedHour(h)}
            policyCashPaths={policyCashPaths}
            scenario={activeComparison.scenario}
          />

          {/* Comparison Table */}
          <Panel
            title="Policy Comparison & Risk-Return Trade-offs"
            description="Side-by-side performance benchmarks. Deltas computed directly from common-random-number trials."
          >
            <TwinComparisonTable
              policies={activeComparison.policies}
              policyResults={activeComparison.policyResults as unknown as Record<string, SerializedPolicyMetricRecord>}
              deltas={activeComparison.deltas}
              winners={activeComparison.winners}
            />
          </Panel>
        </div>
      ) : isRunning ? (
        <Panel title="Simulation in Progress">
          <LoadingState rows={6} />
        </Panel>
      ) : (
        <Panel title="Policy Comparison">
          <EmptyState
            title="No Comparison Run Selected"
            message="Configure stress scenario parameters above and click 'Run Comparison', or select an archived run from the history below to replay it."
          />
        </Panel>
      )}

      {/* Section 3: History & Saved Comparisons */}
      <Panel
        title="Comparison History"
        description="Archived multi-policy runs for this organisation. Replay any historical run without recomputing."
        headerAction={
          <Button size="sm" variant="outline" onClick={refreshHistory} disabled={isLoadingHistory}>
            {isLoadingHistory ? <Loader2 className="h-3 w-3 animate-spin" /> : "Refresh"}
          </Button>
        }
      >
        {historyList.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {historyList.map((item) => (
              <Card key={item.comparisonId} className="p-3 space-y-2 border-border/80">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold text-xs text-foreground truncate">
                    {item.comparisonId}
                  </div>
                  <Badge tone="neutral" className="text-[10px]">
                    {item.source ?? "sim"}
                  </Badge>
                </div>
                <div className="text-[11px] text-muted space-y-0.5">
                  <div>Seed: <span className="font-mono">{item.seed}</span></div>
                  <div>Recorded: {new Date(item.createdAt).toLocaleString()}</div>
                  <div>Policies: {item.policies.join(", ")}</div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full text-xs mt-1"
                  onClick={() => handleReplayStored(item.comparisonId)}
                  disabled={isRunning}
                >
                  <Play className="h-3 w-3 mr-1" /> Replay Run
                </Button>
              </Card>
            ))}
          </div>
        ) : (
          <div className="py-6 text-center text-xs text-muted">
            No stored comparisons found for this organisation.
          </div>
        )}
      </Panel>

      {/* Regulatory & Model Disclaimer */}
      <div className="rounded-lg border border-border/60 bg-surface-2/30 p-4 text-[11px] text-muted leading-relaxed">
        <span className="font-semibold text-foreground">Regulatory & Mathematical Disclaimer: </span>
        {activeComparison?.disclaimer ??
          "Stress simulation results are probabilistic model outputs derived from historical resampling and parameterized shocks under stationarity assumptions. They do not constitute a credit guarantee, deposit insurance, or committed liquidity facility."}
      </div>
    </div>
  );
}
