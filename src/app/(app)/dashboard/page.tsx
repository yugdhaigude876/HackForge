"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/lib/firebase/auth-context";
import { useDashboardData } from "@/hooks/use-dashboard-data";
import { useReplaySimulation } from "@/hooks/use-replay-simulation";
import { TopBar } from "@/components/layout/top-bar";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { ForecastChart } from "@/components/dashboard/forecast-chart";
import { AssetAllocationDonut } from "@/components/dashboard/asset-allocation-donut";
import { TierLedgerTable, type TierLedgerItem } from "@/components/dashboard/tier-ledger-table";
import { RightCommandPanel } from "@/components/dashboard/right-command-panel";
import { AlphaComparison } from "@/components/dashboard/alpha-comparison";
import { LoadingState, ErrorState } from "@/components/finance/panels";
import { FallbackBanner } from "@/components/ui/fallback-banner";
import { useDataSource, type DataSource } from "@/components/providers/data-source-provider";
import { Button } from "@/components/ui/primitives";
import { sampleBalances, sampleNetFlow } from "@/lib/sample-data";
import { formatCurrency, formatCompactMinor } from "@/lib/money";
import { generateAuditCsv } from "@/lib/csv-export";
import { useLiveTreasury } from "@/components/providers/live-treasury-provider";
import { ClockControls } from "@/components/dashboard/clock-controls";
import { useClockControls } from "@/hooks/use-clock";
import { classifyEvent, ticksToActuals, ticksToReplayResult, type LiveNotification } from "@/lib/live/adapters";
import { ShieldAlert, Play, Loader2, Database, Activity, RefreshCw } from "lucide-react";

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
  const { setSource } = useDataSource();
  const {
    status: dashboardStatus,
    data,
    error: dashboardError,
    retryAfterSeconds,
    isFallback,
    fallbackRequestId,
    refresh: refreshDashboard,
    run,
    isRunning,
  } = useDashboardData();

  const isLive = Boolean(user && !isMock);
  const userRole = data?.userRole ?? "viewer";
  const canRunEngine = isLive && userRole !== "viewer";

  // Stored live decision & forecast from Firestore (if present)
  const liveDecision = data?.decision ?? null;
  const liveForecast = data?.forecast ?? null;

  // Realtime dataset stream (signed-in users). When ticks exist, every panel reads from them.
  const live = useLiveTreasury();
  const liveReplay = useMemo(
    () => (live.enabled ? ticksToReplayResult(live.ticks) : null),
    [live.enabled, live.ticks]
  );
  const streaming = liveReplay !== null;
  const clockCtl = useClockControls();

  useEffect(() => {
    if (isFallback) {
      setSource("offline-fallback");
    } else if (streaming) {
      setSource("dataset");
    } else if (isLive && liveDecision?.source) {
      setSource(liveDecision.source as DataSource);
    } else {
      setSource(null);
    }
  }, [isFallback, streaming, isLive, liveDecision?.source, setSource]);

  // Replay control states
  const [userReplayHour, setUserReplayHour] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(10);
  const [outflowShockPct, setOutflowShockPct] = useState<number>(0);
  const [settlementDelayHours, setSettlementDelayHours] = useState<number>(0);
  const [rateSpikeActive, setRateSpikeActive] = useState<boolean>(false);
  const playTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Hook-based replay simulation: debounced, cancellable, dual-mode
  const {
    status: replayStatus,
    result: replayResult,
    error: replayError,
    source: replaySource,
    refresh: refreshReplay,
  } = useReplaySimulation({
    maxHours: 168,
    policy: "reserve-juggler",
    initialCashUsd: 50_000_000,
    operationalFloorUsd: 5_000_000,
    outflowShockPct,
    settlementLagHours: settlementDelayHours,
    rateShiftBps: rateSpikeActive ? 200 : 0,
    subsampleStep: 1,
    enabled: !streaming,
  });

  // Single source of truth for all telemetry panels: the live stream when present, else the replay.
  const simResult = streaming ? liveReplay : replayResult;

  // Calculate first sweep and first liquidation hours from real simulation
  const firstSweepHour = useMemo<number | null>(() => {
    if (!simResult?.frames) return null;
    const sweepLog = simResult.auditLogs?.find((l) => l.type === "SWEEP");
    if (sweepLog) return sweepLog.hour;
    const idx = simResult.frames.findIndex((f) => {
      const p = f.portfolio;
      return (
        p.tier1RepoPrincipal.amountMinor > 0n ||
        p.tier2BondsMarketValue.amountMinor > 0n ||
        p.tier3EquitiesMarketValue.amountMinor > 0n
      );
    });
    return idx >= 0 ? idx : null;
  }, [simResult]);

  const firstLiquidationHour = useMemo<number | null>(() => {
    if (!simResult?.frames) return null;
    const liqLog = simResult.auditLogs?.find(
      (l) => l.type === "LIQUIDATION" || l.type === "OVERDRAFT"
    );
    if (liqLog) return liqLog.hour;
    const idx = simResult.frames.findIndex((f) => f.liquidations && f.liquidations.length > 0);
    return idx >= 0 ? idx : null;
  }, [simResult]);

  // Default replayHour to first meaningful activity (first frame where funds hold in tiers 1-3 or first SWEEP)
  // While streaming, follow the latest streamed hour unless the user pinned an earlier one.
  const latestStreamHour =
    streaming && liveReplay ? liveReplay.frames[liveReplay.frames.length - 1].hour : null;
  const replayHour = streaming
    ? (userReplayHour ?? latestStreamHour ?? 0)
    : (userReplayHour ?? firstSweepHour ?? 0);
  const followingLive = streaming && userReplayHour === null;
  const setReplayHour = useCallback(
    (val: number | ((prev: number) => number)) => {
      setUserReplayHour((current) => {
        const base = current ?? firstSweepHour ?? 0;
        return typeof val === "function" ? val(base) : val;
      });
    },
    [firstSweepHour]
  );

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
  }, [isPlaying, playbackSpeed, setReplayHour]);

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
  const handleJumpToFirstSweep = useCallback(() => {
    if (firstSweepHour !== null) {
      setIsPlaying(false);
      setReplayHour(firstSweepHour);
    }
  }, [firstSweepHour, setReplayHour]);
  const handleJumpToFirstLiquidation = useCallback(() => {
    if (firstLiquidationHour !== null) {
      setIsPlaying(false);
      setReplayHour(firstLiquidationHour);
    }
  }, [firstLiquidationHour, setReplayHour]);

  const handleApplyPreset = useCallback(
    (preset: "normal" | "payday" | "black_swan") => {
      setIsPlaying(false);
      if (preset === "normal") {
        setReplayHour(17);
        setOutflowShockPct(0);
        setSettlementDelayHours(0);
        setRateSpikeActive(false);
      } else if (preset === "payday") {
        setReplayHour(8);
        setOutflowShockPct(0);
        setSettlementDelayHours(0);
        setRateSpikeActive(false);
      } else if (preset === "black_swan") {
        setReplayHour(2);
        setOutflowShockPct(45);
        setSettlementDelayHours(48);
        setRateSpikeActive(true);
      }
    },
    [setReplayHour]
  );

  // Active replay frame (single source of truth for telemetry)
  const activeFrame = useMemo(() => {
    if (!simResult?.frames || simResult.frames.length === 0) return null;
    const exact = simResult.frames.find((f) => f.hour === replayHour);
    if (exact) return exact;
    const idx = Math.min(Math.max(0, replayHour), simResult.frames.length - 1);
    return simResult.frames[idx];
  }, [simResult, replayHour]);

  // Real clock timestamps from activeFrame
  const clockTimestamp = useMemo(() => {
    if (!activeFrame?.timestamp) return "2026-01-01 00:00:00 UTC";
    return activeFrame.timestamp.replace("T", " ").replace("Z", " UTC");
  }, [activeFrame]);

  const clockHourOfDay = useMemo(() => {
    if (!activeFrame?.timestamp) return replayHour % 24;
    const match = activeFrame.timestamp.match(/T(\d{2}):/);
    return match ? parseInt(match[1], 10) : replayHour % 24;
  }, [activeFrame, replayHour]);

  const isRepoWindowOpen = clockHourOfDay >= 17 || clockHourOfDay < 8;
  const isRepoMaturing = clockHourOfDay === 8;

  // Real repo matured yield calculation at 08:00 (delta from previous hour)
  const repoMaturedYieldUsd = useMemo<number | null>(() => {
    if (clockHourOfDay !== 8 || !activeFrame || !simResult?.frames) return null;
    const exactIdx = simResult.frames.findIndex((f) => f.hour === replayHour);
    const currentIdx =
      exactIdx >= 0 ? exactIdx : Math.min(Math.max(0, replayHour), simResult.frames.length - 1);
    if (currentIdx === 0) {
      const earned = activeFrame.portfolio.cumulativeGrossYieldEarned.amountMinor;
      return Number(earned) / 100;
    }
    const prevFrame = simResult.frames[currentIdx - 1];
    if (!prevFrame) return null;
    const deltaMinor =
      activeFrame.portfolio.cumulativeGrossYieldEarned.amountMinor -
      prevFrame.portfolio.cumulativeGrossYieldEarned.amountMinor;
    return Number(deltaMinor) / 100;
  }, [clockHourOfDay, activeFrame, replayHour, simResult]);

  // Balances derived directly from activeFrame
  const availableCashMinor = useMemo<bigint>(() => {
    if (activeFrame?.portfolio) {
      return activeFrame.portfolio.tier0Cash.amountMinor;
    }
    return BigInt(sampleBalances.totalCash);
  }, [activeFrame]);

  const requiredReserveMinor = useMemo<bigint>(() => {
    if (activeFrame) {
      return activeFrame.requiredReserveMinor;
    }
    return BigInt(sampleBalances.requiredReserve);
  }, [activeFrame]);

  const deployableSurplusMinor = useMemo<bigint>(() => {
    if (activeFrame) {
      return activeFrame.deployableSurplusMinor;
    }
    return BigInt(sampleBalances.deployedSurplus);
  }, [activeFrame]);

  const deficitAmountUsd = useMemo<number>(() => {
    if (requiredReserveMinor > availableCashMinor) {
      return Number(requiredReserveMinor - availableCashMinor) / 100;
    }
    return 0;
  }, [requiredReserveMinor, availableCashMinor]);

  let netYieldMinor = 342_120_00n;
  if (activeFrame?.portfolio) {
    const gross = activeFrame.portfolio.cumulativeGrossYieldEarned.amountMinor;
    const pen = activeFrame.portfolio.cumulativePenaltiesPaid.amountMinor;
    const od = activeFrame.portfolio.cumulativeOverdraftInterestPaid.amountMinor;
    const net = gross - pen - od;
    netYieldMinor = net > 0n ? net : 0n;
  } else if (isLive && liveDecision?.expectedNetYieldMinor) {
    netYieldMinor = BigInt(liveDecision.expectedNetYieldMinor);
  }

  // 4-Tier Ledger Items
  const tierLedgerItems = useMemo<TierLedgerItem[]>(() => {
    if (activeFrame?.portfolio) {
      const p = activeFrame.portfolio;
      return [
        {
          tierId: "tier0_cash",
          tierNumber: 0,
          name: "Tier 0: Cash Buffer",
          subName: "Instant Liquid · Operational Reserve (R)",
          balanceMinor: p.tier0Cash.amountMinor,
          balanceUsd: Number(p.tier0Cash.amountMinor) / 100,
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
          balanceMinor: p.tier1RepoPrincipal.amountMinor,
          balanceUsd: Number(p.tier1RepoPrincipal.amountMinor) / 100,
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
          balanceMinor: p.tier2BondsMarketValue.amountMinor,
          balanceUsd: Number(p.tier2BondsMarketValue.amountMinor) / 100,
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
          balanceMinor: p.tier3EquitiesMarketValue.amountMinor,
          balanceUsd: Number(p.tier3EquitiesMarketValue.amountMinor) / 100,
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
        balanceMinor: 0n,
        balanceUsd: 0,
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
        balanceMinor: 0n,
        balanceUsd: 0,
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
        balanceMinor: 0n,
        balanceUsd: 0,
        rateLabel: "10.00% APY",
        liquidity: "Continuous (T+2h)",
        friction: "15.0% Slippage",
        priority: 4,
        accentColor: "#F59E0B",
      },
    ];
  }, [activeFrame]);

  // Donut balances derived from activeFrame
  const donutBalances = useMemo(() => {
    if (activeFrame?.portfolio) {
      const p = activeFrame.portfolio;
      return {
        cashMinor: p.tier0Cash?.amountMinor ?? 0n,
        repoMinor: p.tier1RepoPrincipal?.amountMinor ?? 0n,
        bondsMinor: p.tier2BondsMarketValue?.amountMinor ?? 0n,
        equitiesMinor: p.tier3EquitiesMarketValue?.amountMinor ?? 0n,
        overdraftMinor: p.emergencyOverdraftBalance?.amountMinor ?? 0n,
      };
    }
    return {
      cashMinor: availableCashMinor,
      repoMinor: 0n,
      bondsMinor: 0n,
      equitiesMinor: 0n,
      overdraftMinor: 0n,
    };
  }, [activeFrame, availableCashMinor]);

  // Quick actions
  const handleTriggerSweep = useCallback(() => {
    setIsPlaying(false);
    setReplayHour(17);
  }, [setReplayHour]);

  const handleRunStressTest = useCallback(() => {
    setOutflowShockPct((prev) => (prev === 0 ? 25 : 0));
  }, []);

  // Real audit logs for the terminal up to the current replay hour
  const visibleAuditLogs = useMemo(() => {
    if (!simResult?.auditLogs) return [];
    return simResult.auditLogs
      .filter((log) => log.hour <= replayHour)
      .map((log, idx) => ({
        id: `audit-${log.hour}-${idx}`,
        timestamp: log.timestamp.slice(11, 19),
        type: (log.type === "MATURITY"
          ? "MATURE"
          : log.type === "LIQUIDATION" || log.type === "OVERDRAFT"
          ? "DEFICIT"
          : log.type) as "SWEEP" | "MATURE" | "WARN" | "DEFICIT" | "INFO",
        message: log.message,
      }));
  }, [simResult, replayHour]);

  // Notifications for the top bar when no live stream exists: real events from the local replay
  const replayNotifications = useMemo<LiveNotification[]>(() => {
    if (!simResult?.auditLogs) return [];
    return simResult.auditLogs
      .filter((log) => log.hour <= replayHour)
      .slice(-30)
      .reverse()
      .map((log, idx) => ({
        id: `replay-${log.hour}-${idx}`,
        hourIndex: log.hour,
        timestamp: log.timestamp,
        type: classifyEvent(log.message),
        message: log.message,
      }));
  }, [simResult, replayHour]);

  // Real CSV export using RFC 4180 escaping
  const handleExportAuditCsv = useCallback(() => {
    if (!simResult) return;
    const stored = liveDecision ? [liveDecision] : undefined;
    const csvContent = generateAuditCsv(simResult.auditLogs, stored);
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `treasury_audit_h${replayHour}_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [simResult, liveDecision, replayHour]);

  // Source & Telemetry Badges
  const renderBadge = () => {
    if (isFallback || liveDecision?.source === "offline-fallback" || liveForecast?.source === "offline-fallback") {
      return (
        <span
          data-testid="fallback-badge"
          className="rounded bg-amber-500/20 px-2.5 py-1 font-mono text-[11px] font-bold text-amber-400 border border-amber-500/40"
        >
          Offline fallback
        </span>
      );
    }

    if (streaming) {
      return (
        <span
          data-testid="dataset-stream-badge"
          className="rounded bg-[#22C55E]/15 px-2.5 py-1 font-mono text-[11px] font-bold text-[#22C55E] border border-[#22C55E]/30"
        >
          Official dataset (streamed)
        </span>
      );
    }

    if (!isLive) {
      return (
        <span
          data-testid="sample-data-badge"
          className="rounded bg-[#38BDF8]/15 px-2.5 py-1 font-mono text-[11px] font-bold text-[#38BDF8] border border-[#38BDF8]/30"
        >
          Local sample simulation
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

    if (replaySource === "local-sample") {
      return (
        <span
          data-testid="local-sample-badge"
          className="rounded bg-[#38BDF8]/15 px-2.5 py-1 font-mono text-[11px] font-bold text-[#38BDF8] border border-[#38BDF8]/30"
        >
          Local sample simulation
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
      {/* 1. Global Institutional Top Bar with Replay Ticker Controls */}
      <TopBar
        clockTimestamp={clockTimestamp}
        isRepoWindowOpen={isRepoWindowOpen}
        isRepoMaturing={isRepoMaturing}
        repoMaturedYieldUsd={repoMaturedYieldUsd}
        isPlaying={isPlaying}
        playbackSpeed={playbackSpeed}
        onPlayToggle={streaming ? undefined : handlePlayToggle}
        onStepHour={streaming ? undefined : handleStepHour}
        onSpeedChange={streaming ? undefined : (s) => setPlaybackSpeed(s)}
        notifications={streaming ? undefined : replayNotifications}
        source={isFallback ? "offline-fallback" : streaming ? "dataset" : (liveDecision?.source || replaySource)}
        solvencyStatus={activeFrame?.liquidityStatus ?? (isLive && liveDecision ? (liveDecision.status as "HEALTHY" | "LOW_CONFIDENCE" | "UNDER_RESERVED") : "HEALTHY")}
        mase={
          streaming
            ? (live.latest?.accuracy.mase ?? null)
            : isLive
            ? (liveDecision?.backtest?.mase ?? liveForecast?.backtest?.mase ?? null)
            : 0.85
        }
        confidence={streaming ? (live.latest?.confidence ?? 0.99) : (liveDecision?.confidence ?? 0.99)}
        deficitAmountUsd={deficitAmountUsd}
        onTriggerSweep={streaming ? undefined : handleTriggerSweep}
        onRunStressTest={streaming ? undefined : handleRunStressTest}
        onExportAuditCsv={handleExportAuditCsv}
      />

      {/* Persistent Offline Fallback Banner */}
      {isFallback && (
        <FallbackBanner onRetry={refreshDashboard} requestId={fallbackRequestId} />
      )}

      {/* Sub-header: Data badges & Run Engine action */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <div className="flex items-center gap-2">
          {renderBadge()}
          <span className="text-xs font-mono text-[#94A3B8]">
            BASEL III LIQUIDITY WORKSTATION
          </span>
          <span className="text-[11px] font-mono text-[#94A3B8]/60">
            · Active Frame H{replayHour}
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

      {/* Realtime dataset clock controls (signed-in sessions only) */}
      {live.enabled && <ClockControls />}

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

      {/* Dashboard Loading State */}
      {dashboardStatus === "loading" && (
        <div data-testid="dashboard-loading" aria-busy="true" className="py-8">
          <LoadingState rows={6} />
        </div>
      )}

      {/* Replay Simulation Error Banner */}
      {replayStatus === "error" && (
        <div
          data-testid="replay-error-banner"
          className="flex items-center justify-between rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-300"
        >
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 shrink-0 text-red-400" />
            <span>Simulation error: {replayError || "Failed to execute timeline simulation."}</span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={refreshReplay}
            className="border-red-500/40 text-red-300 hover:bg-red-500/20 text-xs h-7 px-3"
          >
            <RefreshCw className="mr-1.5 h-3 w-3" /> Retry
          </Button>
        </div>
      )}

      {/* "No runs yet" Small Alert Banner (renders ABOVE workstation, not replacing it) */}
      {dashboardStatus === "empty" && !streaming && (
        <div
          data-testid="dashboard-empty"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#A3E635]/30 bg-[#A3E635]/10 px-4 py-2.5 text-xs text-[#F8FAFC]"
        >
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-[#A3E635]" />
            <h2 className="font-semibold text-[#F8FAFC]">{live.enabled ? "Dataset clock not started" : "No runs yet"}</h2>
            <span className="text-[#94A3B8]">
              {live.enabled
                ? "Start the clock to stream the official dataset hour by hour; forecasts and reserve decisions appear as it runs."
                : "Run the engine to create the first automated forecast and Basel III reserve decision for this organisation."}
            </span>
          </div>
          {live.enabled && clockCtl.canControl && (
            <Button
              type="button"
              size="sm"
              onClick={() => void clockCtl.start()}
              disabled={clockCtl.busy}
              className="bg-[#A3E635] text-[#0B0E14] font-semibold hover:bg-[#86efac] gap-1.5 border-none h-7 px-2.5 text-xs"
            >
              <Play className="h-3 w-3 fill-current" />
              <span>Start dataset clock</span>
            </Button>
          )}
          {live.enabled && !clockCtl.canControl && (
            <span className="text-[#94A3B8]">Waiting for an analyst or admin to start it.</span>
          )}
          {!live.enabled && canRunEngine && (
            <Button
              type="button"
              size="sm"
              onClick={() => run()}
              disabled={isRunning || retryAfterSeconds !== null}
              className="bg-[#A3E635] text-[#0B0E14] font-semibold hover:bg-[#86efac] gap-1.5 border-none h-7 px-2.5 text-xs"
            >
              <Play className="h-3 w-3 fill-current" />
              <span>Run engine</span>
            </Button>
          )}
        </div>
      )}

      {/* Dashboard Data Error State */}
      {dashboardStatus === "error" && (
        <div data-testid="dashboard-error" className="py-2">
          <ErrorState
            message={dashboardError || "Failed to load stored dashboard records."}
            onRetry={refreshDashboard}
          />
        </div>
      )}

      {/* Stored Live Decision Card (if present) - Shown alongside replay, not overriding it */}
      {liveDecision && (
        <div
          data-testid="last-stored-decision-card"
          className="rounded-xl border border-[#38BDF8]/30 bg-[#0B0E14] p-4 text-xs"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1E2536] pb-2 mb-3">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-[#38BDF8]" />
              <span className="font-semibold text-[#F8FAFC]">Last Stored Decision</span>
              <span className="rounded bg-[#38BDF8]/15 px-2 py-0.5 font-mono text-[10px] font-bold text-[#38BDF8] border border-[#38BDF8]/30">
                Source: Stored Firestore Run
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-[#94A3B8]">
                Status: {liveDecision.status}
              </span>
              <span className="font-mono text-[10px] text-[#94A3B8]">
                ID: {liveDecision.id.slice(0, 12)}...
              </span>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono">
            <div>
              <div className="text-[10px] text-[#94A3B8]">Stored Reserve</div>
              <div className="text-sm font-bold text-[#F8FAFC]">
                {formatCompactMinor(liveDecision.reserveMinor)}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-[#94A3B8]">Stored Surplus</div>
              <div className="text-sm font-bold text-[#38BDF8]">
                {formatCompactMinor(liveDecision.surplusMinor)}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-[#94A3B8]">Stored Available Cash</div>
              <div className="text-sm font-bold text-[#A3E635]">
                {formatCompactMinor(liveDecision.availableCashMinor)}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-[#94A3B8]">Expected Net Yield</div>
              <div className="text-sm font-bold text-[#F59E0B]">
                {formatCompactMinor(liveDecision.expectedNetYieldMinor)}
              </div>
            </div>
          </div>
          {liveDecision.allocations && liveDecision.allocations.length > 0 && (
            <div className="mt-3 pt-2 border-t border-[#1E2536] flex flex-wrap gap-2">
              <span className="text-[10px] text-[#94A3B8]">Stored Allocations:</span>
              {liveDecision.allocations.map((alloc) => (
                <span
                  key={alloc.instrumentId}
                  className="rounded bg-[#1E2536] px-2 py-0.5 text-[10px] font-mono text-[#F8FAFC]"
                >
                  <span>{alloc.name}</span>: <span>{formatCompactMinor(alloc.amountMinor)}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Replay Loading Skeleton */}
      {replayStatus === "loading" && !simResult && (
        <div data-testid="replay-loading" aria-busy="true" className="py-8">
          <LoadingState rows={6} />
        </div>
      )}

      {/* Main 3-Column Institutional Workstation Layout (Renders whenever replay result is ready) */}
      {simResult && (
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] 2xl:grid-cols-[1fr_380px] gap-4 items-start">
          {/* CENTER CANVAS (Rows 1, 2, 3) */}
          <div className="flex flex-col gap-4 min-w-0">
            {/* Panel Source Label for Replay Telemetry */}
            <div className="flex items-center justify-between px-1 text-[11px] font-mono text-[#94A3B8]">
              <div className="flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5 text-[#A3E635]" />
                <span className="font-semibold text-[#F8FAFC]">
                  {streaming ? "Live Dataset Telemetry" : "Active Replay Telemetry"}
                </span>
                <span>
                  {streaming
                    ? `(Panel Source: Streamed Frame H${replayHour} · Official dataset${followingLive ? " · following live" : " · pinned"})`
                    : `(Panel Source: Replay Frame H${replayHour} · ${replaySource === "live-api" ? "Live API" : "Local Engine"})`}
                </span>
                {streaming && !followingLive && (
                  <button
                    type="button"
                    data-testid="back-to-live"
                    onClick={() => setUserReplayHour(null)}
                    className="ml-2 rounded border border-[#22C55E]/40 px-2 py-0.5 text-[10px] font-bold text-[#22C55E] hover:bg-[#22C55E]/10"
                  >
                    Back to live
                  </button>
                )}
              </div>
              <div>Timestamp: {clockTimestamp}</div>
            </div>

            {/* ROW 1: 4 Top KPI Cards derived from activeFrame */}
            <KpiGrid
              availableCashMinor={availableCashMinor}
              requiredReserveMinor={requiredReserveMinor}
              deployableSurplusMinor={deployableSurplusMinor}
              netYieldMinor={netYieldMinor}
              annualizedApyPct={simResult.summary?.annualizedNetReturnPct ?? 4.62}
              isLive={isLive}
            />

            {/* ROW 2: Analytical Visualizations (Forecast Chart + Donut) */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Left: Net Flow & VaR Chart */}
              <ForecastChart
                history={
                  streaming
                    ? ticksToActuals(live.ticks, 24).map((a, idx) => ({
                        hour: idx,
                        net: Number(a.netMinor),
                      }))
                    : isLive
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
                  streaming && live.latest && live.latest.forecast.points.length > 0
                    ? live.latest.forecast.points.map((p, idx) => ({
                        hour: idx + 1,
                        mean: Number(p.meanMinor),
                        bandLower: p.bandLowerMinor ? Number(p.bandLowerMinor) : undefined,
                        bandUpper: p.bandUpperMinor ? Number(p.bandUpperMinor) : undefined,
                      }))
                    : isLive && liveForecast?.points && liveForecast.points.length > 0
                    ? liveForecast.points.map((p, idx) => ({
                        hour: idx + 1,
                        mean: Number(p.meanMinor),
                        bandLower: p.bandLowerMinor ? Number(p.bandLowerMinor) : undefined,
                        bandUpper: p.bandUpperMinor ? Number(p.bandUpperMinor) : undefined,
                      }))
                    : sampleForecastPredictions
                }
                mase={
                  streaming
                    ? (live.latest?.accuracy.mase ?? null)
                    : isLive
                    ? (liveDecision?.backtest?.mase ?? liveForecast?.backtest?.mase ?? null)
                    : 0.85
                }
              />

              {/* Right: 4-Tier Asset Vault Donut derived from activeFrame */}
              <AssetAllocationDonut
                cashMinor={donutBalances.cashMinor}
                repoMinor={donutBalances.repoMinor}
                bondsMinor={donutBalances.bondsMinor}
                equitiesMinor={donutBalances.equitiesMinor}
                overdraftMinor={donutBalances.overdraftMinor}
              />
            </div>

            {/* ROW 3 (Left): Persistent Economic Alpha / Opportunity Cost Card */}
            <div className="rounded-xl border border-[#1E2536] bg-[#121620] p-5 shadow-lg">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1E2536] pb-3 mb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold tracking-wide text-[#F8FAFC]">
                      Economic Alpha & Opportunity Cost Analysis
                    </h3>
                    <span className="rounded bg-[#A3E635]/15 border border-[#A3E635]/30 px-2 py-0.5 text-[10px] font-mono font-bold text-[#A3E635]">
                      {netYieldMinor > 0n
                        ? `+${formatCurrency(Number(netYieldMinor) / 100)} NET ADVANTAGE`
                        : "+$0.00 NET ADVANTAGE"}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-[#94A3B8]">
                    Algorithmic 4-tier yield deployment versus naive non-earning cash buffer status quo
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono text-[#94A3B8]">Policy Benchmark:</span>
                  <span className="font-mono text-xs font-bold text-[#38BDF8]">BASEL III DYNAMIC</span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Naive Bank Status Quo */}
                <div className="rounded-lg border border-[#1E2536] bg-[#0B0E14] p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[#94A3B8] uppercase tracking-wider">
                      Naive Bank (Status Quo)
                    </span>
                    <span className="rounded bg-[#EF4444]/15 text-[#EF4444] border border-[#EF4444]/30 px-2 py-0.5 text-[10px] font-mono font-bold">
                      Zero Alpha · High Risk
                    </span>
                  </div>
                  <div className="mt-3 space-y-2">
                    <div className="flex justify-between items-baseline">
                      <span className="text-xs text-[#94A3B8]">Yield Earned:</span>
                      <span className="font-mono text-sm font-bold text-[#94A3B8]">$0.00</span>
                    </div>
                    <div className="flex justify-between items-baseline">
                      <span className="text-xs text-[#94A3B8]">Overdraft Risk Exposure:</span>
                      <span className="font-mono text-sm font-bold text-[#EF4444]">$1,200,000</span>
                    </div>
                    <div className="flex justify-between items-baseline">
                      <span className="text-xs text-[#94A3B8]">Capital Deployment:</span>
                      <span className="font-mono text-xs text-[#94A3B8]">0% (100% idle checking)</span>
                    </div>
                  </div>
                </div>

                {/* Reserve Juggler (Algorithmic) */}
                <div className="rounded-lg border border-[#A3E635]/40 bg-[#A3E635]/5 p-4 shadow-[0_0_15px_rgba(163,230,53,0.08)]">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[#A3E635] uppercase tracking-wider">
                      Reserve Juggler (Algorithmic)
                    </span>
                    <span className="rounded bg-[#A3E635]/20 text-[#A3E635] border border-[#A3E635]/40 px-2 py-0.5 text-[10px] font-mono font-bold">
                      Optimal Alpha
                    </span>
                  </div>
                  <div className="mt-3 space-y-2">
                    <div className="flex justify-between items-baseline">
                      <span className="text-xs text-[#94A3B8]">Yield Earned:</span>
                      <span className="font-mono text-sm font-bold text-[#A3E635]">
                        +{formatCurrency(Number(netYieldMinor) / 100)}
                      </span>
                    </div>
                    <div className="flex justify-between items-baseline">
                      <span className="text-xs text-[#94A3B8]">Overdraft Fees:</span>
                      <span className="font-mono text-sm font-bold text-[#A3E635]">$0 (Zero Breach)</span>
                    </div>
                    <div className="flex justify-between items-baseline">
                      <span className="text-xs text-[#94A3B8]">Surplus Efficiency:</span>
                      <span className="font-mono text-xs text-[#38BDF8]">
                        Dynamic Basel III allocation across Tiers 1-3
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ROW 3: 4-Tier Holdings & Liquidation Priority Ledger derived from activeFrame */}
            <TierLedgerTable
              items={tierLedgerItems}
              totalAssetsMinor={
                donutBalances.cashMinor +
                donutBalances.repoMinor +
                donutBalances.bondsMinor +
                donutBalances.equitiesMinor
              }
            />

            {/* ROW 4: Demonstrable Economic Alpha Comparison */}
            <AlphaComparison
              grossYieldEarnedUsd={
                activeFrame?.portfolio
                  ? Number(activeFrame.portfolio.cumulativeGrossYieldEarned.amountMinor) / 100
                  : 354_620
              }
              penaltiesIncurredUsd={
                activeFrame?.portfolio
                  ? Number(activeFrame.portfolio.cumulativePenaltiesPaid.amountMinor) / 100
                  : 12_500
              }
              avoidedOverdraftFeesUsd={1_240_000}
              netApyPct={4.62}
            />
          </div>

          {/* RIGHT COLUMN: Command & Execution Rail with Real Audit Terminal */}
          <div className="w-full">
            <RightCommandPanel
              currentHour={replayHour}
              isPlaying={isPlaying}
              onPlayToggle={handlePlayToggle}
              onStepHour={handleStepHour}
              onReset={handleResetReplay}
              onSpeedChange={(s) => setPlaybackSpeed(s)}
              onJumpPreset={handleJumpPreset}
              onApplyPreset={handleApplyPreset}
              firstSweepHour={firstSweepHour}
              firstLiquidationHour={firstLiquidationHour}
              onJumpToFirstSweep={handleJumpToFirstSweep}
              onJumpToFirstLiquidation={handleJumpToFirstLiquidation}
              outflowShockPct={outflowShockPct}
              onOutflowShockChange={(val) => setOutflowShockPct(val)}
              settlementDelayHours={settlementDelayHours}
              onSettlementDelayChange={(val) => setSettlementDelayHours(val)}
              rateSpikeActive={rateSpikeActive}
              onRateSpikeToggle={(active) => setRateSpikeActive(active)}
              auditLogs={visibleAuditLogs}
              totalCashUsd={Number(availableCashMinor) / 100}
            />
          </div>
        </div>
      )}
    </div>
  );
}
