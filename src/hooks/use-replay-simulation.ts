"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/firebase/auth-context";
import { apiFetch } from "@/lib/api-client";
import {
  runTimelineSimulation,
  TimelineSimulatorOptions,
  TimelineSimulationSummary,
  TimelinePolicy,
} from "@/engine/simulator";
import { Money } from "@/engine/money";
import type { TierLiquidationOrder } from "@/engine/treasury-vaults";

/**
 * Validates and converts numbers, numeric strings, or BigInt to bigint safely.
 * Throws a clear error if the number is not a safe integer.
 */
export function toBigIntSafe(val: unknown): bigint {
  if (typeof val === "bigint") return val;
  if (typeof val === "number") {
    if (!Number.isSafeInteger(val)) {
      throw new Error(
        `Amount ${val} exceeds JavaScript safe integer range and cannot be converted safely to BigInt`
      );
    }
    return BigInt(val);
  }
  if (typeof val === "string") {
    try {
      return BigInt(val);
    } catch {
      throw new Error(`Failed to parse string "${val}" as BigInt`);
    }
  }
  throw new Error(`Cannot convert ${typeof val} (${String(val)}) to BigInt: invalid type`);
}

export interface NormalizedMoney {
  amountMinor: bigint;
  currency: string;
}

export interface NormalizedTreasurySnapshot {
  hourIndex: number;
  timestamp: string;
  tier0Cash: NormalizedMoney;
  tier1RepoPrincipal: NormalizedMoney;
  tier1RepoAccruedYield: NormalizedMoney;
  tier1IsActive: boolean;
  tier2BondsMarketValue: NormalizedMoney;
  tier2BondsParValue: NormalizedMoney;
  tier2BondsPriceIndex: number;
  tier2BondsAccruedYield: NormalizedMoney;
  tier3EquitiesMarketValue: NormalizedMoney;
  tier3EquitiesCostBasis: NormalizedMoney;
  tier3EquitiesIndexPrice: number;
  tier3PeakMarketValue: NormalizedMoney;
  tier3DrawdownPct: number;
  emergencyOverdraftBalance: NormalizedMoney;
  totalAssets: NormalizedMoney;
  cumulativeGrossYieldEarned: NormalizedMoney;
  cumulativePenaltiesPaid: NormalizedMoney;
  cumulativeOverdraftInterestPaid: NormalizedMoney;
}

export interface NormalizedTimelineFrame {
  hourIndex: number;
  hour: number;
  timestamp: string;
  depositsUsd: number;
  withdrawalsUsd: number;
  netFlowUsd: number;
  portfolio: NormalizedTreasurySnapshot;
  requiredReserveMinor: bigint;
  deployableSurplusMinor: bigint;
  liquidityStatus: "HEALTHY" | "UNDER_RESERVED" | "LOW_CONFIDENCE";
  events: string[];
  liquidations: TierLiquidationOrder[];
}

export interface NormalizedReplayResult {
  summary: TimelineSimulationSummary;
  frames: NormalizedTimelineFrame[];
  auditLogs: {
    hour: number;
    timestamp: string;
    message: string;
    type: "SWEEP" | "MATURITY" | "LIQUIDATION" | "OVERDRAFT" | "INFO";
  }[];
}

export type ReplaySimulationResult = NormalizedReplayResult;

export interface ReplaySimulationParams {
  startHour?: number;
  maxHours?: number;
  initialCashUsd?: number;
  operationalFloorUsd?: number;
  horizonHours?: number;
  alpha?: number;
  outflowShockPct?: number;
  settlementLagHours?: number;
  rateShiftBps?: number;
  equityDrawdownShockPct?: number;
  policy?: TimelinePolicy;
  subsampleStep?: number;
  /** Set false to skip running the replay (for example while the live dataset stream is shown). */
  enabled?: boolean;
}

export type ReplayStatus = "loading" | "ready" | "error";
export type ReplaySource = "live-api" | "local-sample";

export interface UseReplaySimulationReturn {
  status: ReplayStatus;
  result: NormalizedReplayResult | null;
  error: string | null;
  source: ReplaySource;
  refresh: () => void;
}

function normalizeMoney(raw: unknown): NormalizedMoney {
  if (!raw || typeof raw !== "object") {
    return { amountMinor: 0n, currency: "USD" };
  }
  const obj = raw as { amountMinor?: unknown; currency?: unknown };
  return {
    amountMinor: toBigIntSafe(obj.amountMinor ?? 0),
    currency: typeof obj.currency === "string" ? obj.currency : "USD",
  };
}

interface RawPortfolio {
  hourIndex?: number;
  timestamp?: string;
  tier0Cash?: unknown;
  tier1RepoPrincipal?: unknown;
  tier1RepoAccruedYield?: unknown;
  tier1IsActive?: boolean;
  tier2BondsMarketValue?: unknown;
  tier2BondsParValue?: unknown;
  tier2BondsPriceIndex?: number;
  tier2BondsAccruedYield?: unknown;
  tier3EquitiesMarketValue?: unknown;
  tier3EquitiesCostBasis?: unknown;
  tier3EquitiesIndexPrice?: number;
  tier3PeakMarketValue?: unknown;
  tier3DrawdownPct?: number;
  emergencyOverdraftBalance?: unknown;
  totalAssets?: unknown;
  cumulativeGrossYieldEarned?: unknown;
  cumulativePenaltiesPaid?: unknown;
  cumulativeOverdraftInterestPaid?: unknown;
}

interface RawTimelineFrame {
  hourIndex: number;
  timestamp: string;
  depositsUsd?: number;
  withdrawalsUsd?: number;
  netFlowUsd?: number;
  liquidityStatus?: "HEALTHY" | "UNDER_RESERVED" | "LOW_CONFIDENCE";
  events?: string[];
  liquidations?: TierLiquidationOrder[];
  requiredReserveMinor?: unknown;
  deployableSurplusMinor?: unknown;
  portfolio?: RawPortfolio;
}

interface RawReplayPayload {
  summary: TimelineSimulationSummary;
  frames: RawTimelineFrame[];
  auditLogs: Array<{
    hour: number;
    timestamp: string;
    message: string;
    type: "SWEEP" | "MATURITY" | "LIQUIDATION" | "OVERDRAFT" | "INFO";
  }>;
}

function normalizeFrame(frame: RawTimelineFrame): NormalizedTimelineFrame {
  const p = frame.portfolio ?? {};
  return {
    hourIndex: frame.hourIndex,
    hour: frame.hourIndex,
    timestamp: frame.timestamp,
    depositsUsd: Number(frame.depositsUsd ?? 0),
    withdrawalsUsd: Number(frame.withdrawalsUsd ?? 0),
    netFlowUsd: Number(frame.netFlowUsd ?? 0),
    liquidityStatus: frame.liquidityStatus ?? "HEALTHY",
    events: Array.isArray(frame.events) ? frame.events : [],
    liquidations: Array.isArray(frame.liquidations) ? frame.liquidations : [],
    requiredReserveMinor: toBigIntSafe(frame.requiredReserveMinor ?? 0),
    deployableSurplusMinor: toBigIntSafe(frame.deployableSurplusMinor ?? 0),
    portfolio: {
      hourIndex: p.hourIndex ?? frame.hourIndex,
      timestamp: p.timestamp ?? frame.timestamp,
      tier0Cash: normalizeMoney(p.tier0Cash),
      tier1RepoPrincipal: normalizeMoney(p.tier1RepoPrincipal),
      tier1RepoAccruedYield: normalizeMoney(p.tier1RepoAccruedYield),
      tier1IsActive: Boolean(p.tier1IsActive),
      tier2BondsMarketValue: normalizeMoney(p.tier2BondsMarketValue),
      tier2BondsParValue: normalizeMoney(p.tier2BondsParValue),
      tier2BondsPriceIndex: Number(p.tier2BondsPriceIndex ?? 100),
      tier2BondsAccruedYield: normalizeMoney(p.tier2BondsAccruedYield),
      tier3EquitiesMarketValue: normalizeMoney(p.tier3EquitiesMarketValue),
      tier3EquitiesCostBasis: normalizeMoney(p.tier3EquitiesCostBasis),
      tier3EquitiesIndexPrice: Number(p.tier3EquitiesIndexPrice ?? 100),
      tier3PeakMarketValue: normalizeMoney(p.tier3PeakMarketValue),
      tier3DrawdownPct: Number(p.tier3DrawdownPct ?? 0),
      emergencyOverdraftBalance: normalizeMoney(p.emergencyOverdraftBalance),
      totalAssets: normalizeMoney(p.totalAssets),
      cumulativeGrossYieldEarned: normalizeMoney(p.cumulativeGrossYieldEarned),
      cumulativePenaltiesPaid: normalizeMoney(p.cumulativePenaltiesPaid),
      cumulativeOverdraftInterestPaid: normalizeMoney(p.cumulativeOverdraftInterestPaid),
    },
  };
}

export function normalizeReplayResult(raw: unknown): NormalizedReplayResult {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid simulation result payload: expected object");
  }
  const payload = raw as Partial<RawReplayPayload>;
  const frames = Array.isArray(payload.frames) ? payload.frames.map(normalizeFrame) : [];
  return {
    summary: payload.summary as TimelineSimulationSummary,
    frames,
    auditLogs: Array.isArray(payload.auditLogs) ? payload.auditLogs : [],
  };
}

/**
 * Custom hook to execute timeline replay simulations.
 * Uses authenticated apiFetch when signed in with a real account, or pure browser engine otherwise.
 * Debounces slider/parameter changes by 300ms, and cancels on unmount or param change.
 */
export function useReplaySimulation(
  params: ReplaySimulationParams = {}
): UseReplaySimulationReturn {
  const { user, isMock } = useAuth();
  const [status, setStatus] = useState<ReplayStatus>("loading");
  const [result, setResult] = useState<NormalizedReplayResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<ReplaySource>(
    user && !isMock ? "live-api" : "local-sample"
  );
  const [refreshToken, setRefreshToken] = useState<number>(0);

  const isLive = Boolean(user && !isMock);

  const refresh = useCallback(() => {
    setRefreshToken((prev) => prev + 1);
  }, []);

  // Serialize params to string key for stable debounce tracking
  const paramsKey = JSON.stringify({
    startHour: params.startHour ?? 0,
    maxHours: params.maxHours ?? 168,
    initialCashUsd: params.initialCashUsd ?? 50_000_000,
    operationalFloorUsd: params.operationalFloorUsd ?? 5_000_000,
    horizonHours: params.horizonHours ?? 24,
    alpha: params.alpha ?? 0.01,
    outflowShockPct: params.outflowShockPct ?? 0,
    settlementLagHours: params.settlementLagHours ?? 0,
    rateShiftBps: params.rateShiftBps ?? 0,
    equityDrawdownShockPct: params.equityDrawdownShockPct ?? 0,
    policy: params.policy ?? "reserve-juggler",
    subsampleStep: params.subsampleStep ?? 1,
    isLive,
    refreshToken,
  });
  const enabled = params.enabled ?? true;

  useEffect(() => {
    if (!enabled) return;
    let isCancelled = false;
    const abortController = new AbortController();

    const timer = setTimeout(async () => {
      setStatus("loading");
      setError(null);
      try {
        const parsedParams = JSON.parse(paramsKey);

        if (isLive) {
          setSource("live-api");
          const apiRes = await apiFetch<RawReplayPayload>("/api/engine/replay", {
            method: "POST",
            body: JSON.stringify({
              startHour: parsedParams.startHour,
              maxHours: parsedParams.maxHours,
              initialCashUsd: parsedParams.initialCashUsd,
              operationalFloorUsd: parsedParams.operationalFloorUsd,
              horizonHours: parsedParams.horizonHours,
              alpha: parsedParams.alpha,
              outflowShockPct: parsedParams.outflowShockPct,
              settlementLagHours: parsedParams.settlementLagHours,
              rateShiftBps: parsedParams.rateShiftBps,
              equityDrawdownShockPct: parsedParams.equityDrawdownShockPct,
              policy: parsedParams.policy,
              subsampleStep: parsedParams.subsampleStep,
            }),
            signal: abortController.signal,
          });

          if (isCancelled) return;

          if (apiRes.ok && apiRes.data) {
            const normalized = normalizeReplayResult(apiRes.data);
            setResult(normalized);
            setStatus("ready");
            setError(null);
          } else {
            const msg = !apiRes.ok ? apiRes.error.message : "Replay simulation API failed";
            setError(msg);
            setStatus("error");
          }
        } else {
          // Local pure engine execution
          setSource("local-sample");
          const simOptions: TimelineSimulatorOptions = {
            startHour: parsedParams.startHour,
            maxHours: parsedParams.maxHours,
            initialCash: Money.fromDecimal(parsedParams.initialCashUsd, "USD"),
            operationalFloor: Money.fromDecimal(parsedParams.operationalFloorUsd, "USD"),
            horizonHours: parsedParams.horizonHours,
            alpha: parsedParams.alpha,
            outflowShockPct: parsedParams.outflowShockPct,
            settlementLagHours: parsedParams.settlementLagHours,
            rateShiftBps: parsedParams.rateShiftBps,
            equityDrawdownShockPct: parsedParams.equityDrawdownShockPct,
            policy: parsedParams.policy,
          };

          const rawResult = runTimelineSimulation(simOptions);
          if (isCancelled) return;

          const step = parsedParams.subsampleStep ?? 1;
          const sampledFrames = rawResult.frames.filter(
            (_, idx) => idx % step === 0 || idx === rawResult.frames.length - 1
          );

          const normalized = normalizeReplayResult({
            summary: rawResult.summary,
            frames: sampledFrames,
            auditLogs: rawResult.auditLogs,
          });

          setResult(normalized);
          setStatus("ready");
          setError(null);
        }
      } catch (err: unknown) {
        if (isCancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setStatus("error");
      }
    }, 300);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
      abortController.abort();
    };
  }, [paramsKey, isLive, enabled]);

  return {
    status,
    result,
    error,
    source,
    refresh,
  };
}
