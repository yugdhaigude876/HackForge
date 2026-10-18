/**
 * Reserve Juggler - Benchmark Treasury 4-Tier Dataset Loader
 *
 * Ingests, validates, and transforms the official 8,760-hour benchmark dataset:
 * `treasury_4tier_dataset.csv` / `treasury_4tier_dataset.xlsx`.
 *
 * Exposes typed domain representations and conversion to HourlyBucket time series
 * for consumption by forecasting models, Basel III reserve sizing, and the 4-tier engine.
 */

import fs from "node:fs";
import path from "node:path";
import { Money } from "@/engine/money";
import { HourlyBucket } from "@/engine/models";

/**
 * 16-column typed record conforming to the official 4-tier treasury dataset.
 */
export interface TreasuryHourRecord {
  /** ISO-8601 UTC timestamp of the hourly window (e.g., "2026-01-01T00:00:00Z") */
  timestamp: string;

  /** Total inbound customer and merchant deposits in USD */
  deposits_usd: number;

  /** Total outbound withdrawals and settlement payouts in USD */
  withdrawals_usd: number;

  /** Net cash flow: deposits - withdrawals in USD */
  net_flow_usd: number;

  /** Clock flag: true only at 17:00 UTC when overnight repo sweep window opens */
  repo_sweep_window_open: boolean;

  /** Clock flag: true only at 08:00 UTC when overnight repo matures and releases funds */
  repo_sweep_mature: boolean;

  /** Annualized yield for Tier 1 Overnight Repo (APY %, e.g., 4.292) */
  tier1_repo_rate_apy: number;

  /** Yield to maturity for Tier 2 Sovereign Bonds (% per annum, e.g., 4.8) */
  tier2_bond_yield_pct: number;

  /** Price index of Tier 2 Sovereign Debt (base 100.0) */
  tier2_bond_price_index: number;

  /** Modified duration of Tier 2 Sovereign Debt (years, e.g., 1.92) */
  tier2_bond_mod_duration: number;

  /** Price index of Tier 3 Growth Equities (e.g., 4988.59) */
  tier3_stock_index_price: number;

  /** Annualized volatility of Tier 3 Growth Equities (%, e.g., 18.0) */
  tier3_stock_volatility_pct: number;

  /** Penalty haircut applied if Tier 1 Repo is broken before 08:00 UTC maturity (%, e.g., 0.5) */
  tier1_early_redemption_haircut_pct: number;

  /** Market liquidity haircut applied on forced liquidation of Tier 2 Bonds (%, e.g., 2.0) */
  tier2_bond_liquidation_haircut_pct: number;

  /** Market impact / slippage haircut on emergency liquidation of Tier 3 Equities (%, e.g., 15.0) */
  tier3_stock_liquidation_haircut_pct: number;

  /** Punitive APR fee charged by Central Bank on emergency overdraft balance (%, e.g., 12.0) */
  emergency_overdraft_penalty_apr_pct: number;
}

/**
 * Summary statistics of the ingested dataset for telemetry and dashboard verification.
 */
export interface TreasuryDatasetSummary {
  totalHours: number;
  startDate: string;
  endDate: string;
  totalDepositsUsd: number;
  totalWithdrawalsUsd: number;
  netCumulativeFlowUsd: number;
  minHourlyNetFlowUsd: number;
  maxHourlyNetFlowUsd: number;
  avgHourlyDepositsUsd: number;
  avgHourlyWithdrawalsUsd: number;
  sweepWindowsCount: number;
  matureWindowsCount: number;
  avgRepoRateApy: number;
  avgBondYieldPct: number;
  avgStockPriceIndex: number;
}

/**
 * Parses raw CSV string content into typed TreasuryHourRecord array.
 */
export function parseTreasuryCSV(csvContent: string): TreasuryHourRecord[] {
  const lines = csvContent.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    throw new Error("CSV dataset is empty or missing headers.");
  }

  const headers = lines[0].split(",").map((h) => h.trim());
  const expectedHeaders = [
    "timestamp",
    "deposits_usd",
    "withdrawals_usd",
    "net_flow_usd",
    "repo_sweep_window_open",
    "repo_sweep_mature",
    "tier1_repo_rate_apy",
    "tier2_bond_yield_pct",
    "tier2_bond_price_index",
    "tier2_bond_mod_duration",
    "tier3_stock_index_price",
    "tier3_stock_volatility_pct",
    "tier1_early_redemption_haircut_pct",
    "tier2_bond_liquidation_haircut_pct",
    "tier3_stock_liquidation_haircut_pct",
    "emergency_overdraft_penalty_apr_pct",
  ];

  // Verify headers
  for (const expected of expectedHeaders) {
    if (!headers.includes(expected)) {
      throw new Error(`Missing expected CSV header column: "${expected}"`);
    }
  }

  const records: TreasuryHourRecord[] = [];

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",").map((p) => p.trim());
    if (parts.length < headers.length) {
      continue; // Skip malformed trailing empty rows
    }

    const rowMap: Record<string, string> = {};
    headers.forEach((h, idx) => {
      rowMap[h] = parts[idx];
    });

    const timestamp = rowMap["timestamp"];
    const deposits = Number.parseFloat(rowMap["deposits_usd"]);
    const withdrawals = Number.parseFloat(rowMap["withdrawals_usd"]);
    const netFlow = Number.parseFloat(rowMap["net_flow_usd"]);

    if (Number.isNaN(deposits) || Number.isNaN(withdrawals) || Number.isNaN(netFlow)) {
      throw new Error(`Invalid numeric values in row ${i} for timestamp ${timestamp}`);
    }

    records.push({
      timestamp,
      deposits_usd: deposits,
      withdrawals_usd: withdrawals,
      net_flow_usd: netFlow,
      repo_sweep_window_open: rowMap["repo_sweep_window_open"] === "true",
      repo_sweep_mature: rowMap["repo_sweep_mature"] === "true",
      tier1_repo_rate_apy: Number.parseFloat(rowMap["tier1_repo_rate_apy"]) || 0,
      tier2_bond_yield_pct: Number.parseFloat(rowMap["tier2_bond_yield_pct"]) || 0,
      tier2_bond_price_index: Number.parseFloat(rowMap["tier2_bond_price_index"]) || 100,
      tier2_bond_mod_duration: Number.parseFloat(rowMap["tier2_bond_mod_duration"]) || 1.92,
      tier3_stock_index_price: Number.parseFloat(rowMap["tier3_stock_index_price"]) || 0,
      tier3_stock_volatility_pct: Number.parseFloat(rowMap["tier3_stock_volatility_pct"]) || 18,
      tier1_early_redemption_haircut_pct: Number.parseFloat(rowMap["tier1_early_redemption_haircut_pct"]) || 0.5,
      tier2_bond_liquidation_haircut_pct: Number.parseFloat(rowMap["tier2_bond_liquidation_haircut_pct"]) || 2.0,
      tier3_stock_liquidation_haircut_pct: Number.parseFloat(rowMap["tier3_stock_liquidation_haircut_pct"]) || 15.0,
      emergency_overdraft_penalty_apr_pct: Number.parseFloat(rowMap["emergency_overdraft_penalty_apr_pct"]) || 12.0,
    });
  }

  return records;
}

let cachedRecords: TreasuryHourRecord[] | null = null;

/**
 * Resolves and loads the benchmark dataset from disk with memoized caching.
 */
export function loadTreasuryDataset(customPath?: string): TreasuryHourRecord[] {
  if (cachedRecords && !customPath) {
    return cachedRecords;
  }

  const candidatePaths = customPath
    ? [customPath]
    : [
        path.join(process.cwd(), "data", "treasury_4tier_dataset.csv"),
        path.join(process.cwd(), "treasury_4tier_dataset.csv"),
        path.join(__dirname, "..", "..", "data", "treasury_4tier_dataset.csv"),
        "/Users/yugamoldhaigude/Downloads/HackForge-main/data/treasury_4tier_dataset.csv",
        "/Users/yugamoldhaigude/Downloads/treasury_4tier_dataset.csv",
      ];

  let csvContent: string | null = null;

  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      csvContent = fs.readFileSync(candidate, "utf8");
      break;
    }
  }

  if (!csvContent) {
    throw new Error(
      `Treasury dataset file not found. Checked candidate paths: ${candidatePaths.join(", ")}`
    );
  }

  const records = parseTreasuryCSV(csvContent);
  if (!customPath) {
    cachedRecords = records;
  }

  return records;
}

/**
 * Converts a TreasuryHourRecord into an HourlyBucket compatible with the forecasting
 * and reserve calculation engines.
 */
export function treasuryRecordToHourlyBucket(record: TreasuryHourRecord): HourlyBucket {
  const hourStart = new Date(record.timestamp);
  const inbound = Money.fromDecimal(Math.max(0, record.deposits_usd), "USD");
  const outbound = Money.fromDecimal(Math.max(0, record.withdrawals_usd), "USD");
  const netFlow = inbound.subtract(outbound);
  const grossVolume = inbound.add(outbound);

  return {
    bucketId: record.timestamp,
    hourStart,
    inbound,
    outbound,
    netFlow,
    grossVolume,
    transactionCount: 100, // Synthetic aggregation proxy
  };
}

/**
 * Transforms an array of TreasuryHourRecord into an array of HourlyBucket models.
 */
export function treasuryDatasetToHourlyBuckets(
  records: readonly TreasuryHourRecord[]
): HourlyBucket[] {
  return records.map(treasuryRecordToHourlyBucket);
}

/**
 * Computes descriptive summary metrics across the 8,760-hour benchmark series.
 */
export function getTreasuryDatasetSummary(
  records: readonly TreasuryHourRecord[]
): TreasuryDatasetSummary {
  if (records.length === 0) {
    throw new Error("Cannot compute summary of empty dataset");
  }

  let totalDeposits = 0;
  let totalWithdrawals = 0;
  let minNet = Number.POSITIVE_INFINITY;
  let maxNet = Number.NEGATIVE_INFINITY;
  let sweepWindows = 0;
  let matureWindows = 0;
  let sumRepo = 0;
  let sumBond = 0;
  let sumStock = 0;

  for (const r of records) {
    totalDeposits += r.deposits_usd;
    totalWithdrawals += r.withdrawals_usd;
    if (r.net_flow_usd < minNet) minNet = r.net_flow_usd;
    if (r.net_flow_usd > maxNet) maxNet = r.net_flow_usd;
    if (r.repo_sweep_window_open) sweepWindows++;
    if (r.repo_sweep_mature) matureWindows++;
    sumRepo += r.tier1_repo_rate_apy;
    sumBond += r.tier2_bond_yield_pct;
    sumStock += r.tier3_stock_index_price;
  }

  const n = records.length;

  return {
    totalHours: n,
    startDate: records[0].timestamp,
    endDate: records[n - 1].timestamp,
    totalDepositsUsd: Math.round(totalDeposits * 100) / 100,
    totalWithdrawalsUsd: Math.round(totalWithdrawals * 100) / 100,
    netCumulativeFlowUsd: Math.round((totalDeposits - totalWithdrawals) * 100) / 100,
    minHourlyNetFlowUsd: Math.round(minNet * 100) / 100,
    maxHourlyNetFlowUsd: Math.round(maxNet * 100) / 100,
    avgHourlyDepositsUsd: Math.round((totalDeposits / n) * 100) / 100,
    avgHourlyWithdrawalsUsd: Math.round((totalWithdrawals / n) * 100) / 100,
    sweepWindowsCount: sweepWindows,
    matureWindowsCount: matureWindows,
    avgRepoRateApy: Math.round((sumRepo / n) * 1000) / 1000,
    avgBondYieldPct: Math.round((sumBond / n) * 1000) / 1000,
    avgStockPriceIndex: Math.round((sumStock / n) * 100) / 100,
  };
}
