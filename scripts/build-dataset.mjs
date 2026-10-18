#!/usr/bin/env node
/**
 * Validates data/treasury_4tier_dataset.csv and emits the compact server-side asset
 * src/engine/data/dataset.generated.json (rows as arrays, plus a SHA-256 of the CSV).
 *
 * Usage: node scripts/build-dataset.mjs [--check]
 *   --check  validate and compare with the committed asset without writing.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const csvPath = join(root, "data", "treasury_4tier_dataset.csv");
const outPath = join(root, "src", "engine", "data", "dataset.generated.json");
const checkOnly = process.argv.includes("--check");

export const COLUMNS = [
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

const HOUR_MS = 3_600_000;

export function buildAsset(csvText) {
  const problems = [];
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new Error("CSV is empty or has no data rows.");

  const headers = lines[0].split(",").map((h) => h.trim());
  for (const col of COLUMNS) {
    if (!headers.includes(col)) throw new Error(`Missing CSV column: ${col}`);
  }
  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));
  const rows = [];

  for (let n = 1; n < lines.length; n++) {
    const parts = lines[n].split(",").map((p) => p.trim());
    if (parts.length < headers.length) {
      problems.push(`row ${n}: expected ${headers.length} columns, found ${parts.length}`);
      continue;
    }
    const ts = parts[idx.timestamp];
    const time = Date.parse(ts);
    if (Number.isNaN(time)) problems.push(`row ${n}: invalid timestamp "${ts}"`);

    const num = (name) => {
      const v = Number.parseFloat(parts[idx[name]]);
      if (!Number.isFinite(v)) problems.push(`row ${n} (${ts}): ${name} is not a finite number`);
      return v;
    };
    const flag = (name) => {
      const raw = parts[idx[name]];
      if (raw !== "true" && raw !== "false") problems.push(`row ${n} (${ts}): ${name} must be true or false`);
      return raw === "true";
    };

    const deposits = num("deposits_usd");
    const withdrawals = num("withdrawals_usd");
    const net = num("net_flow_usd");
    const sweep = flag("repo_sweep_window_open");
    const mature = flag("repo_sweep_mature");
    const hour = new Date(time).getUTCHours();

    if (Math.abs(deposits - withdrawals - net) > 0.011) {
      problems.push(`row ${n} (${ts}): net_flow_usd ${net} != deposits - withdrawals ${(deposits - withdrawals).toFixed(2)}`);
    }
    if (sweep && hour !== 17) problems.push(`row ${n} (${ts}): sweep window flag set outside 17:00 UTC`);
    if (mature && hour !== 8) problems.push(`row ${n} (${ts}): mature flag set outside 08:00 UTC`);
    if (n > 1 && time - rows[rows.length - 1].time !== HOUR_MS) {
      problems.push(`row ${n} (${ts}): timestamp is not exactly one hour after the previous row`);
    }

    rows.push({
      time,
      values: COLUMNS.map((c) => {
        if (c === "timestamp") return ts;
        if (c === "repo_sweep_window_open") return sweep;
        if (c === "repo_sweep_mature") return mature;
        return num(c);
      }),
    });
  }

  if (problems.length > 0) {
    const shown = problems.slice(0, 15).join("\n  ");
    throw new Error(`Dataset validation failed with ${problems.length} problem(s):\n  ${shown}`);
  }

  const hash = createHash("sha256").update(csvText).digest("hex");
  return { hash, count: rows.length, columns: COLUMNS, rows: rows.map((r) => r.values) };
}

function main() {
  if (!existsSync(csvPath)) {
    if (existsSync(outPath)) {
      console.warn(`[build-dataset] ${csvPath} not found; keeping existing ${outPath}`);
      return;
    }
    throw new Error(`Dataset CSV not found at ${csvPath}`);
  }
  const csvText = readFileSync(csvPath, "utf8");
  const asset = buildAsset(csvText);
  const json = JSON.stringify(asset);

  if (checkOnly) {
    const current = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
    if (current !== json) {
      console.error("[build-dataset] Generated asset is out of date. Run: npm run build:dataset");
      process.exit(1);
    }
    console.log(`[build-dataset] OK: ${asset.count} rows, sha256 ${asset.hash.slice(0, 12)}...`);
    return;
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, json);
  console.log(`[build-dataset] wrote ${asset.count} rows (${(json.length / 1024).toFixed(0)} KB), sha256 ${asset.hash.slice(0, 12)}...`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main();
  } catch (err) {
    console.error(`[build-dataset] ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}
