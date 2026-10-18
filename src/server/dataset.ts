import "server-only";

import asset from "@/engine/data/dataset.generated.json";
import type { TreasuryHourRecord } from "@/engine/dataset";

/**
 * Server-side loader for the official hackathon dataset (8,760 hourly rows).
 *
 * The data is bundled as a generated JSON asset (scripts/build-dataset.mjs) instead of being
 * read from disk at request time, so it is always present in serverless deployments.
 * This module is server-only and must never be imported from client code.
 */

const COLUMNS = asset.columns as readonly string[];
const ROWS = asset.rows as unknown as ReadonlyArray<ReadonlyArray<string | number | boolean>>;

function column(name: keyof TreasuryHourRecord): number {
  const i = COLUMNS.indexOf(name);
  if (i < 0) throw new Error(`Dataset asset is missing column "${name}"`);
  return i;
}

const IDX = {
  timestamp: column("timestamp"),
  deposits_usd: column("deposits_usd"),
  withdrawals_usd: column("withdrawals_usd"),
  net_flow_usd: column("net_flow_usd"),
  repo_sweep_window_open: column("repo_sweep_window_open"),
  repo_sweep_mature: column("repo_sweep_mature"),
  tier1_repo_rate_apy: column("tier1_repo_rate_apy"),
  tier2_bond_yield_pct: column("tier2_bond_yield_pct"),
  tier2_bond_price_index: column("tier2_bond_price_index"),
  tier2_bond_mod_duration: column("tier2_bond_mod_duration"),
  tier3_stock_index_price: column("tier3_stock_index_price"),
  tier3_stock_volatility_pct: column("tier3_stock_volatility_pct"),
  tier1_early_redemption_haircut_pct: column("tier1_early_redemption_haircut_pct"),
  tier2_bond_liquidation_haircut_pct: column("tier2_bond_liquidation_haircut_pct"),
  tier3_stock_liquidation_haircut_pct: column("tier3_stock_liquidation_haircut_pct"),
  emergency_overdraft_penalty_apr_pct: column("emergency_overdraft_penalty_apr_pct"),
} as const;

/** SHA-256 of the source CSV the asset was generated from. */
export const datasetHash: string = asset.hash;

export function getDatasetLength(): number {
  return ROWS.length;
}

/** Returns the dataset record for an hour index (0-based), or null when out of range. */
export function getDatasetRow(index: number): TreasuryHourRecord | null {
  if (!Number.isInteger(index) || index < 0 || index >= ROWS.length) return null;
  const r = ROWS[index];
  return {
    timestamp: r[IDX.timestamp] as string,
    deposits_usd: r[IDX.deposits_usd] as number,
    withdrawals_usd: r[IDX.withdrawals_usd] as number,
    net_flow_usd: r[IDX.net_flow_usd] as number,
    repo_sweep_window_open: r[IDX.repo_sweep_window_open] as boolean,
    repo_sweep_mature: r[IDX.repo_sweep_mature] as boolean,
    tier1_repo_rate_apy: r[IDX.tier1_repo_rate_apy] as number,
    tier2_bond_yield_pct: r[IDX.tier2_bond_yield_pct] as number,
    tier2_bond_price_index: r[IDX.tier2_bond_price_index] as number,
    tier2_bond_mod_duration: r[IDX.tier2_bond_mod_duration] as number,
    tier3_stock_index_price: r[IDX.tier3_stock_index_price] as number,
    tier3_stock_volatility_pct: r[IDX.tier3_stock_volatility_pct] as number,
    tier1_early_redemption_haircut_pct: r[IDX.tier1_early_redemption_haircut_pct] as number,
    tier2_bond_liquidation_haircut_pct: r[IDX.tier2_bond_liquidation_haircut_pct] as number,
    tier3_stock_liquidation_haircut_pct: r[IDX.tier3_stock_liquidation_haircut_pct] as number,
    emergency_overdraft_penalty_apr_pct: r[IDX.emergency_overdraft_penalty_apr_pct] as number,
  };
}
