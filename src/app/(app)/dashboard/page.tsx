"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/lib/firebase/auth-context";
import { useDashboardData } from "@/hooks/use-dashboard-data";
import { TopBar } from "@/components/layout/top-bar";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { ForecastChart } from "@/components/dashboard/forecast-chart";
import { AssetAllocationDonut } from "@/components/dashboard/asset-allocation-donut";
import { TierLedgerTable, type TierLedgerItem } from "@/components/dashboard/tier-ledger-table";
import { RightCommandPanel } from "@/components/dashboard/right-command-panel";
import { LoadingState, ErrorState } from "@/components/finance/panels";
import { Button } from "@/components/ui/primitives";
import { sampleBalances, sampleNetFlow } from "@/lib/sample-data";
import { ShieldAlert, Play, Loader2 } from "lucide-react";
import type { TimelineSimulationResult } from "@/engine/simulator";

const sampleForecastPredictions = [
  { hour: 1, mean: 1_200_000_00, bandLower: 800_000_00, bandUpper: 1_600_000_00 },
  { hour: 2, mean: 950_000_00, bandLower: 600_000_00, bandUpper: 1_300_000_00 },
  { hour: 3, mean: -450_000_00, bandLower: -900_000_00, bandUpper: 0 },
  { hour: 4, mean: -1_100_000_00, bandLower: -1_600_000_00, bandUpper: -600_000_00 },
  { hour: 5, mean: -200_000_00, bandLower: -600_000_00, bandUpper: 200_000_00 },
  { hour: 6, mean: 800_000_00, bandLower: 400_000_00, bandUpper: 1_200_000_00 },
  { hour: 7, mean: 2_100_000_00, bandLower: 1_600_000_00, bandUpper: 2_600_000_00 },
  { hour: 8, mean: 3_400_000_00, bandLower: 2_800_000_00, bandUpper: 4_000_000_00 },
  { hour: 9, mean: 2_800_000_00, bandLower: 2_200_000_00, bandUpper: 3_400_000_00 },
  { hour: 10, mean: 1_600_000_00, bandLower: 1_100_000_00, bandUpper: 2_100_000_00 },
  { hour: 11, mean: 500_000_00, bandLower: 100_000_00, bandUpper: 900_000_00 },
  { hour: 12, mean: -800_000_00, bandLower: -1_300_000_00, bandUpper: -300_000_00 },
  { hour: 13, mean: -1_400_000_00, bandLower: -2_000_000_00, bandUpper: -800_000_00 },
  { hour: 14, mean: -600_000_00, bandLower: -1_100_000_00, bandUpper: -100_000_00 },
  { hour: 15, mean: 400_000_00, bandLower: -100_000_00, bandUpper: 900_000_00 },
  { hour: 16, mean: 1_900_000_00, bandLower: 1_400_000_00, bandUpper: 2_400_000_00 },
  { hour: 17, mean: 2_700_000_00, bandLower: 2_100_000_00, bandUpper: 3_300_000_00 },
  { hour: 18, mean: 1_800_000_00, bandLower: 1_200_000_00, bandUpper: 2_400_000_00 },
  { hour: 19, mean: 900_000_00, bandLower: 400_000_00, bandUpper: 1_400_000_00 },
  { hour: 20, mean: -300_000_00, bandLower: -800_000_00, bandUpper: 200_000_00 },
  { hour: 21, mean: -1_200_000_00, bandLower: -1_800_000_00, bandUpper: -600_000_00 },
  { hour: 22, mean: -900_000_00, bandLower: -1_500_000_00, bandUpper: -300_000_00 },
  { hour: 23, mean: -200_000_00, bandLower: -700_000_00, bandUpper: 300_000_00 },
  { hour: 24, mean: 600_000_00, bandLower: 100_000_00, bandUpper: 1_100_000_00 },
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

  // Real or synthetic decision & forecast
  const liveDecision = data?.decision ?? null;
  const liveForecast = data?.forecast ?? null;

  // Replay simulation state
  const [replayHour, setReplayHour] = useState<number>(17);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(10);
  const [outflowShockPct, setOutflowShockPct] = useState<number>(0);
  const [settlementDelayHours, setSettlementDelayHours] = useState<number>(0);
  const [rateSpikeActive, setRateSpikeActive] = useState<boolean>(false);
  const [simResult, setSimResult] = useState<TimelineSimulationResult | null>(null);
  const playTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch replay simulation in background for rich telemetry
  useEffect(() => {
    let ignore = false;
    const fetchReplay = async () => {
      try {
        const res = await fetch("/api/engine/replay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            maxHours: 168,
            policy: "reserve-juggler",
            initialCashUsd: 50_000_000,
            operationalFloorUsd: 5_000_000,
            outflowShockPct,
            settlementLagHours: settlementDelayHours,
            rateShiftBps: rateSpikeActive ? 200 : 0,
            subsampleStep: 1,
          }),
        });
        if (!ignore && res.ok) {
          const json = await res.json();
          if (json.ok && json.data) {
            setSimResult(json.data);
          }
        }
      } catch {
        // Fallback gracefully to local mock state
      }
    };
    fetchReplay();
    return () => {
      ignore = true;
    };
  }, [outflowShockPct, settlementDelayHours, rateSpikeActive]);

  // Replay playback ticker
  useEffect(() => {
    if (isPlaying) {
      const intervalMs = Math.max(25, Math.floor(1000 / playbackSpeed));
      playTimerRef.current = setInterval(() => {
        setReplayHour((prev) => (prev >= 167 ? 0 : prev + 1));
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
  }, [isPlaying, playbackSpeed]);

  const handlePlayToggle = () => setIsPlaying((prev) => !prev);
  const handleStepHour = () => {
    setIsPlaying(false);
    setReplayHour((prev) => (prev >= 167 ? 0 : prev + 1));
  };
  const handleResetReplay = () => {
    setIsPlaying(false);
    setReplayHour(0);
  };
  const handleJumpPreset = (hour: number) => {
    setIsPlaying(false);
    setReplayHour(hour);
  };

  // Clock calculations
  const clockHourOfDay = replayHour % 24;
  const clockDay = Math.floor(replayHour / 24) + 1;
  const clockTimestamp = `2026-03-${String(14 + clockDay).padStart(2, "0")} ${String(clockHourOfDay).padStart(2, "0")}:00:00 UTC`;
  const isRepoWindowOpen = clockHourOfDay >= 17 || clockHourOfDay < 8;
  const isRepoMaturing = clockHourOfDay === 8;

  // Active replay frame (if available)
  const activeFrame = useMemo(() => {
    if (!simResult?.frames || simResult.frames.length === 0) return null;
    const idx = Math.min(Math.max(0, replayHour), simResult.frames.length - 1);
    return simResult.frames[idx];
  }, [simResult, replayHour]);

  // Derive balances
  const availableCashMinor = useMemo<bigint>(() => {
    if (isLive && liveDecision) {
      return BigInt(liveDecision.availableCashMinor);
    }
    if (activeFrame?.portfolio) {
      return BigInt(activeFrame.portfolio.tier0Cash.amountMinor || "5000000000");
    }
    return BigInt(sampleBalances.totalCash);
  }, [isLive, liveDecision, activeFrame]);

  const requiredReserveMinor = useMemo<bigint>(() => {
    if (isLive && liveDecision) {
      return BigInt(liveDecision.reserveMinor);
    }
    if (activeFrame) {
      return BigInt(activeFrame.requiredReserveMinor || "1650000000");
    }
    return BigInt(sampleBalances.requiredReserve);
  }, [isLive, liveDecision, activeFrame]);

  const deployableSurplusMinor = useMemo<bigint>(() => {
    if (isLive && liveDecision) {
      return BigInt(liveDecision.surplusMinor);
    }
    if (activeFrame) {
      return BigInt(activeFrame.deployableSurplusMinor || "3350000000");
    }
    return BigInt(sampleBalances.deployedSurplus);
  }, [isLive, liveDecision, activeFrame]);

  const netYieldMinor: bigint =
    isLive && liveDecision?.expectedNetYieldMinor
      ? BigInt(liveDecision.expectedNetYieldMinor)
      : 342_120_00n;

  // 4-Tier Ledger Items
  const tierLedgerItems = useMemo<TierLedgerItem[]>(() => {
    if (isLive && liveDecision?.allocations && liveDecision.allocations.length > 0) {
      const items: TierLedgerItem[] = [
        {
          tierId: "tier0_cash",
          tierNumber: 0,
          name: "Tier 0: Cash Buffer",
          subName: "Instant Liquid · Operational Reserve (R)",
          balanceMinor: requiredReserveMinor,
          balanceUsd: Number(requiredReserveMinor) / 100,
          rateLabel: "0.00% APY",
          liquidity: "Instant (T+0)",
          friction: "0.0% Fee",
          priority: 1,
          accentColor: "#94A3B8",
          capacityMinor: 100_000_000_00n,
        },
      ];

      liveDecision.allocations.forEach((alloc, idx) => {
        const isRepo = alloc.name.toLowerCase().includes("repo");
        const isBond =
          alloc.name.toLowerCase().includes("bond") || alloc.name.toLowerCase().includes("treasury");
        const priority = idx + 2;
        const accent = isRepo ? "#A3E635" : isBond ? "#06B6D4" : "#F59E0B";
        const liquidity = isRepo
          ? "Overnight (17:00–08:00)"
          : alloc.settlementLagHours === 0
          ? "Instant"
          : `T+${alloc.settlementLagHours}h`;
        const friction =
          alloc.penaltyBps > 0
            ? `${(alloc.penaltyBps / 100).toFixed(1)}% Early exit`
            : "0% Penalty";

        items.push({
          tierId: alloc.instrumentId,
          tierNumber: priority - 1,
          name: alloc.name,
          subName: `Allocation · Rate ${(alloc.annualRateBps / 100).toFixed(2)}% APY`,
          balanceMinor: BigInt(alloc.amountMinor || "0"),
          balanceUsd: Number(BigInt(alloc.amountMinor || "0")) / 100,
          rateLabel: `${(alloc.annualRateBps / 100).toFixed(2)}% APY`,
          liquidity,
          friction,
          priority,
          accentColor: accent,
          capacityMinor: BigInt(alloc.capacityMinor || alloc.amountMinor || "0"),
        });
      });

      return items;
    }

    if (activeFrame?.portfolio) {
      const p = activeFrame.portfolio;
      return [
        {
          tierId: "tier0_cash",
          tierNumber: 0,
          name: "Tier 0: Cash Buffer",
          subName: "Instant Liquid · Operational Reserve (R)",
          balanceMinor: BigInt(p.tier0Cash.amountMinor || "0"),
          balanceUsd: Number(p.tier0Cash.amountMinor || "0") / 100,
          rateLabel: "0.00% APY",
          liquidity: "Instant (T+0)",
          friction: "0.0% Fee",
          priority: 1,
          accentColor: "#94A3B8",
        },
        {
          tierId: "tier1_repo",
          tierNumber: 1,
          name: "Tier 1: Overnight Repo",
          subName: "Swept 17:00 UTC · Matures 08:00 UTC",
          balanceMinor: BigInt(p.tier1RepoPrincipal.amountMinor || "0"),
          balanceUsd: Number(p.tier1RepoPrincipal.amountMinor || "0") / 100,
          rateLabel: "4.29% APY",
          liquidity: "Overnight (17:00–08:00)",
          friction: "0.5% Early break",
          priority: 2,
          accentColor: "#A3E635",
        },
        {
          tierId: "tier2_bonds",
          tierNumber: 2,
          name: "Tier 2: 2Y Sovereign Debt",
          subName: "US Treasury · D_mod = 1.92 · MTM",
          balanceMinor: BigInt(p.tier2BondsMarketValue.amountMinor || "0"),
          balanceUsd: Number(p.tier2BondsMarketValue.amountMinor || "0") / 100,
          rateLabel: "4.80% YTM",
          liquidity: "MTM (T+1h)",
          friction: "2.0% Haircut",
          priority: 3,
          accentColor: "#06B6D4",
        },
        {
          tierId: "tier3_equities",
          tierNumber: 3,
          name: "Tier 3: Growth Equities",
          subName: "Index Tracking · σ = 18.0% Volatility",
          balanceMinor: BigInt(p.tier3EquitiesMarketValue.amountMinor || "0"),
          balanceUsd: Number(p.tier3EquitiesMarketValue.amountMinor || "0") / 100,
          rateLabel: "10.00% APY",
          liquidity: "Continuous (T+2h)",
          friction: "15.0% Slippage",
          priority: 4,
          accentColor: "#F59E0B",
        },
      ];
    }

    return [
      {
        tierId: "tier0_cash",
        tierNumber: 0,
        name: "Tier 0: Cash Buffer",
        subName: "Instant Liquid · Operational Reserve (R)",
        balanceMinor: 50_000_000_00n,
        balanceUsd: 50_000_000,
        rateLabel: "0.00% APY",
        liquidity: "Instant (T+0)",
        friction: "0.0% Fee",
        priority: 1,
        accentColor: "#94A3B8",
      },
      {
        tierId: "tier1_repo",
        tierNumber: 1,
        name: "Tier 1: Overnight Repo",
        subName: "Swept 17:00 UTC · Matures 08:00 UTC",
        balanceMinor: 25_000_000_00n,
        balanceUsd: 25_000_000,
        rateLabel: "4.29% APY",
        liquidity: "Overnight (17:00–08:00)",
        friction: "0.5% Early break",
        priority: 2,
        accentColor: "#A3E635",
      },
      {
        tierId: "tier2_bonds",
        tierNumber: 2,
        name: "Tier 2: 2Y Sovereign Debt",
        subName: "US Treasury · D_mod = 1.92 · MTM",
        balanceMinor: 15_000_000_00n,
        balanceUsd: 15_000_000,
        rateLabel: "4.80% YTM",
        liquidity: "MTM (T+1h)",
        friction: "2.0% Haircut",
        priority: 3,
        accentColor: "#06B6D4",
      },
      {
        tierId: "tier3_equities",
        tierNumber: 3,
        name: "Tier 3: Growth Equities",
        subName: "Index Tracking · σ = 18.0% Volatility",
        balanceMinor: 10_000_000_00n,
        balanceUsd: 10_000_000,
        rateLabel: "10.00% APY",
        liquidity: "Continuous (T+2h)",
        friction: "15.0% Slippage",
        priority: 4,
        accentColor: "#F59E0B",
      },
    ];
  }, [isLive, liveDecision, activeFrame, requiredReserveMinor]);

  // Donut balances
  const donutBalances = useMemo(() => {
    if (activeFrame?.portfolio) {
      const p = activeFrame.portfolio;
      return {
        cashMinor: BigInt(p.tier0Cash.amountMinor || "0"),
        repoMinor: BigInt(p.tier1RepoPrincipal.amountMinor || "0"),
        bondsMinor: BigInt(p.tier2BondsMarketValue.amountMinor || "0"),
        equitiesMinor: BigInt(p.tier3EquitiesMarketValue.amountMinor || "0"),
        overdraftMinor: BigInt(p.emergencyOverdraftBalance.amountMinor || "0"),
      };
    }
    return {
      cashMinor: availableCashMinor,
      repoMinor: 25_000_000_00n,
      bondsMinor: 15_000_000_00n,
      equitiesMinor: 10_000_000_00n,
      overdraftMinor: 0n,
    };
  }, [activeFrame, availableCashMinor]);

  // Trigger 17:00 Sweep quick action
  const handleTriggerSweep = useCallback(() => {
    setIsPlaying(false);
    setReplayHour(17);
  }, []);

  // Run stress test quick action
  const handleRunStressTest = useCallback(() => {
    setOutflowShockPct((prev) => (prev === 0 ? 25 : 0));
  }, []);

  // Top Bar Badge
  const renderBadge = () => {
    if (!isLive) {
      return (
        <span
          data-testid="sample-data-badge"
          className="rounded bg-[#38BDF8]/15 px-2.5 py-1 font-mono text-[11px] font-bold text-[#38BDF8] border border-[#38BDF8]/30"
        >
          Sample data
        </span>
      );
    }

    if (liveDecision?.source === "synthetic" || liveForecast?.source === "synthetic") {
      return (
        <span
          data-testid="synthetic-source-badge"
          className="rounded bg-[#38BDF8]/15 px-2.5 py-1 font-mono text-[11px] font-bold text-[#38BDF8] border border-[#38BDF8]/30"
        >
          Synthetic source
        </span>
      );
    }

    return (
      <span
        data-testid="live-data-badge"
        className="rounded bg-[#22C55E]/15 px-2.5 py-1 font-mono text-[11px] font-bold text-[#22C55E] border border-[#22C55E]/30"
      >
        Live
      </span>
    );
  };

  return (
    <div className="space-y-4">
      {/* 1. Global Institutional Top Bar */}
      <TopBar
        clockTimestamp={clockTimestamp}
        isRepoWindowOpen={isRepoWindowOpen}
        isRepoMaturing={isRepoMaturing}
        solvencyStatus={
          isLive && liveDecision
            ? (liveDecision.status as "HEALTHY" | "LOW_CONFIDENCE" | "UNDER_RESERVED")
            : "HEALTHY"
        }
        mase={isLive ? (liveDecision?.backtest?.mase ?? liveForecast?.backtest?.mase ?? null) : 0.85}
        confidence={isLive && liveDecision ? liveDecision.confidence : 0.99}
        deficitAmountUsd={0}
        onTriggerSweep={handleTriggerSweep}
        onRunStressTest={handleRunStressTest}
        onExportAuditCsv={() => {
          // Export simple audit summary
          const csv = "timestamp,type,message\n2026-03-14 17:00:00,SWEEP,Tier 1 Repo Swept";
          const blob = new Blob([csv], { type: "text/csv" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = "treasury_audit_log.csv";
          a.click();
        }}
      />

      {/* Sub-header: Data badges & Run Engine action */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <div className="flex items-center gap-2">
          {renderBadge()}
          <span className="text-xs font-mono text-[#94A3B8]">
            BASEL III LIQUIDITY WORKSTATION · DESIGN 3
          </span>
        </div>

        <div className="flex items-center gap-2">
          {canRunEngine && (
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => run()}
              disabled={isRunning || retryAfterSeconds !== null}
              data-testid="run-engine-button"
              className="bg-[#A3E635] text-[#0B0E14] font-semibold hover:bg-[#86efac] gap-1.5 border-none h-8 px-3 text-xs"
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
        </div>
      </div>

      {/* Mock Mode Notice Banner */}
      {!isLive && (
        <div
          role="status"
          className="flex items-center gap-3 rounded-lg border border-[#1E2536] bg-[#121620]/90 px-4 py-3 text-xs text-[#94A3B8]"
        >
          <ShieldAlert className="h-4 w-4 shrink-0 text-[#A3E635]" />
          <div className="flex-1">
            <span className="font-semibold text-[#F8FAFC]">Demonstration Mode: </span>
            <span>
              Metrics below are illustrative placeholders. Sign in with a real Firebase account and
              configure an organisation to run live forecasts and evaluate persisted decisions.
            </span>
          </div>
        </div>
      )}

      {/* Loading State Skeleton */}
      {status === "loading" && (
        <div data-testid="dashboard-loading" aria-busy="true" className="py-8">
          <LoadingState rows={6} />
        </div>
      )}

      {/* Error State */}
      {status === "error" && (
        <div data-testid="dashboard-error" className="py-8">
          <ErrorState message={error || "Failed to load dashboard telemetry."} onRetry={refresh} />
        </div>
      )}

      {/* Empty State */}
      {status === "empty" && (
        <div
          data-testid="dashboard-empty"
          className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#1E2536] bg-[#121620] p-10 text-center"
        >
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#A3E635]/15 text-[#A3E635]">
            <Play className="h-6 w-6 ml-0.5 fill-current" />
          </div>
          <h2 className="mt-3 text-base font-semibold text-[#F8FAFC]">No runs yet</h2>
          <p className="mt-1 max-w-sm text-xs text-[#94A3B8]">
            Run the engine to create the first automated forecast and Basel III reserve decision for
            this organisation.
          </p>
          {canRunEngine && (
            <div className="mt-4">
              <Button
                type="button"
                onClick={() => run()}
                disabled={isRunning || retryAfterSeconds !== null}
                className="bg-[#A3E635] text-[#0B0E14] font-semibold hover:bg-[#86efac] gap-1.5 border-none"
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

      {/* Main 3-Column Institutional Workstation Layout */}
      {(status === "ready" || status === "unauthenticated") && (
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] 2xl:grid-cols-[1fr_380px] gap-4 items-start">
          {/* CENTER CANVAS (Rows 1, 2, 3) */}
          <div className="flex flex-col gap-4 min-w-0">
            {/* ROW 1: 4 Top KPI Cards */}
            <KpiGrid
              availableCashMinor={availableCashMinor}
              requiredReserveMinor={requiredReserveMinor}
              deployableSurplusMinor={deployableSurplusMinor}
              netYieldMinor={netYieldMinor}
              annualizedApyPct={4.62}
              avoidedOverdraftFeesMinor={120_000_000n}
              isLive={isLive}
            />

            {/* ROW 2: Analytical Visualizations (Forecast Chart + Donut) */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Left: Net Flow & VaR Chart */}
              <ForecastChart
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
                  isLive && liveForecast?.points && liveForecast.points.length > 0
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
              />

              {/* Right: 4-Tier Asset Vault Donut */}
              <AssetAllocationDonut
                cashMinor={donutBalances.cashMinor}
                repoMinor={donutBalances.repoMinor}
                bondsMinor={donutBalances.bondsMinor}
                equitiesMinor={donutBalances.equitiesMinor}
                overdraftMinor={donutBalances.overdraftMinor}
              />
            </div>

            {/* ROW 3: 4-Tier Holdings & Liquidation Priority Ledger */}
            <TierLedgerTable
              items={tierLedgerItems}
              totalAssetsMinor={
                donutBalances.cashMinor +
                donutBalances.repoMinor +
                donutBalances.bondsMinor +
                donutBalances.equitiesMinor
              }
            />
          </div>

          {/* RIGHT COLUMN: Command & Execution Rail */}
          <div className="w-full">
            <RightCommandPanel
              currentHour={replayHour}
              isPlaying={isPlaying}
              onPlayToggle={handlePlayToggle}
              onStepHour={handleStepHour}
              onReset={handleResetReplay}
              onSpeedChange={(s) => setPlaybackSpeed(s)}
              onJumpPreset={handleJumpPreset}
              outflowShockPct={outflowShockPct}
              onOutflowShockChange={(val) => setOutflowShockPct(val)}
              settlementDelayHours={settlementDelayHours}
              onSettlementDelayChange={(val) => setSettlementDelayHours(val)}
              rateSpikeActive={rateSpikeActive}
              onRateSpikeToggle={(active) => setRateSpikeActive(active)}
              totalCashUsd={Number(availableCashMinor) / 100}
            />
          </div>
        </div>
      )}
    </div>
  );
}
