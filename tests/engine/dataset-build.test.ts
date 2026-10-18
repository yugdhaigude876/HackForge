import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// The build script is plain ESM so it can run in `prebuild` without a TypeScript toolchain.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { buildAsset, COLUMNS } = (await import("../../scripts/build-dataset.mjs")) as any;

const HEADER = COLUMNS.join(",");

/** One valid hourly row; overrides replace named columns. */
function row(hour: number, overrides: Record<string, string | number | boolean> = {}): string {
  const ts = new Date(Date.UTC(2026, 0, 1, hour)).toISOString().replace(".000Z", "Z");
  const base: Record<string, string | number | boolean> = {
    timestamp: ts,
    deposits_usd: 1000,
    withdrawals_usd: 400,
    net_flow_usd: 600,
    repo_sweep_window_open: hour % 24 === 17,
    repo_sweep_mature: hour % 24 === 8,
    tier1_repo_rate_apy: 4.29,
    tier2_bond_yield_pct: 4.8,
    tier2_bond_price_index: 100,
    tier2_bond_mod_duration: 1.92,
    tier3_stock_index_price: 5000,
    tier3_stock_volatility_pct: 18,
    tier1_early_redemption_haircut_pct: 0.5,
    tier2_bond_liquidation_haircut_pct: 2,
    tier3_stock_liquidation_haircut_pct: 15,
    emergency_overdraft_penalty_apr_pct: 12,
    ...overrides,
  };
  return COLUMNS.map((c: string) => String(base[c])).join(",");
}

const csv = (rows: string[]) => [HEADER, ...rows].join("\n");

describe("dataset build validation", () => {
  it("accepts a clean file and reports count and hash", () => {
    const text = csv([row(0), row(1), row(2)]);
    const asset = buildAsset(text);
    expect(asset.count).toBe(3);
    expect(asset.hash).toBe(createHash("sha256").update(text).digest("hex"));
    expect(asset.rows[0][0]).toBe("2026-01-01T00:00:00Z");
  });

  it("rejects a missing column", () => {
    const bad = [COLUMNS.slice(1).join(","), "x"].join("\n");
    expect(() => buildAsset(bad)).toThrow(/Missing CSV column/);
  });

  it("rejects net flow that does not equal deposits minus withdrawals", () => {
    expect(() => buildAsset(csv([row(0), row(1, { net_flow_usd: 999 })]))).toThrow(/net_flow_usd/);
  });

  it("rejects a sweep flag outside 17:00 UTC and a maturity flag outside 08:00 UTC", () => {
    expect(() => buildAsset(csv([row(0, { repo_sweep_window_open: true })]))).toThrow(/17:00 UTC/);
    expect(() => buildAsset(csv([row(0, { repo_sweep_mature: true })]))).toThrow(/08:00 UTC/);
  });

  it("rejects a gap or duplicate in hourly timestamps", () => {
    expect(() => buildAsset(csv([row(0), row(2)]))).toThrow(/one hour/);
    expect(() => buildAsset(csv([row(0), row(0)]))).toThrow(/one hour/);
  });

  it("rejects non-numeric values and bad booleans", () => {
    expect(() => buildAsset(csv([row(0, { deposits_usd: "abc" })]))).toThrow(/not a finite number/);
    expect(() => buildAsset(csv([row(0, { repo_sweep_mature: "yes" })]))).toThrow(/true or false/);
  });

  it("reports how many problems were found", () => {
    expect(() => buildAsset(csv([row(0, { net_flow_usd: 1 }), row(1, { net_flow_usd: 2 })]))).toThrow(/2 problem/);
  });
});

describe("generated dataset asset", () => {
  it("matches the CSV it was built from (run `npm run build:dataset` if this fails)", async () => {
    const csvPath = join(process.cwd(), "data", "treasury_4tier_dataset.csv");
    if (!existsSync(csvPath)) return;
    const { datasetHash, getDatasetLength, getDatasetRow } = await import("@/server/dataset");
    const hash = createHash("sha256").update(readFileSync(csvPath, "utf8")).digest("hex");
    expect(datasetHash).toBe(hash);
    expect(getDatasetLength()).toBe(8760);
    expect(getDatasetRow(0)?.timestamp).toBe("2026-01-01T00:00:00Z");
    expect(getDatasetRow(8759)).not.toBeNull();
    expect(getDatasetRow(8760)).toBeNull();
    expect(getDatasetRow(-1)).toBeNull();
    expect(getDatasetRow(1.5)).toBeNull();
  });
});

describe("dataset stays server-only", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(name)) out.push(p);
    }
    return out;
  }

  it("is imported only by server code (src/server, src/app/api) and never by a client component", () => {
    const files = walk(join(process.cwd(), "src"));
    const offenders: string[] = [];
    for (const file of files) {
      const rel = file.replace(process.cwd(), "").replace(/\\/g, "/");
      const text = readFileSync(file, "utf8");
      const importsDataset = /dataset\.generated|@\/server\/dataset|server\/dataset"/.test(text);
      if (!importsDataset) continue;
      const serverSide = rel.startsWith("/src/server/") || rel.startsWith("/src/app/api/");
      const isClient = /^\s*["']use client["']/m.test(text);
      if (!serverSide || isClient) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
