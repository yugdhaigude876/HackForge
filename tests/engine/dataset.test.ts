import { describe, it, expect } from "vitest";
import {
  loadTreasuryDataset,
  parseTreasuryCSV,
  treasuryRecordToHourlyBucket,
  getTreasuryDatasetSummary,
  TreasuryHourRecord,
} from "@/engine/dataset";

describe("Treasury 4-Tier Benchmark Dataset (src/engine/dataset.ts)", () => {
  it("loads and parses the full 8,760-hour benchmark dataset from disk", () => {
    const dataset = loadTreasuryDataset();
    expect(dataset.length).toBe(8760);

    const first = dataset[0];
    expect(first.timestamp).toBe("2026-01-01T00:00:00Z");
    expect(first.deposits_usd).toBeGreaterThan(0);
    expect(first.withdrawals_usd).toBeGreaterThan(0);
    expect(typeof first.net_flow_usd).toBe("number");
    expect(first.tier2_bond_mod_duration).toBe(1.92);
    expect(first.tier3_stock_volatility_pct).toBe(18);
    expect(first.tier1_early_redemption_haircut_pct).toBe(0.5);
    expect(first.tier2_bond_liquidation_haircut_pct).toBe(2.0);
    expect(first.tier3_stock_liquidation_haircut_pct).toBe(15.0);
    expect(first.emergency_overdraft_penalty_apr_pct).toBe(12.0);

    const last = dataset[8759];
    expect(last.timestamp).toBe("2026-12-31T23:00:00Z");
  });

  it("verifies clock flags: repo_sweep_window_open is true only at 17:00 UTC and repo_sweep_mature only at 08:00 UTC", () => {
    const dataset = loadTreasuryDataset();

    for (let i = 0; i < 168; i++) {
      const rec = dataset[i];
      const hour = new Date(rec.timestamp).getUTCHours();

      if (hour === 17) {
        expect(rec.repo_sweep_window_open).toBe(true);
      } else {
        expect(rec.repo_sweep_window_open).toBe(false);
      }

      if (hour === 8) {
        expect(rec.repo_sweep_mature).toBe(true);
      } else {
        expect(rec.repo_sweep_mature).toBe(false);
      }
    }
  });

  it("converts a TreasuryHourRecord into an HourlyBucket with strict Money types", () => {
    const sampleRecord: TreasuryHourRecord = {
      timestamp: "2026-01-01T17:00:00Z",
      deposits_usd: 10_000_000.50,
      withdrawals_usd: 8_000_000.25,
      net_flow_usd: 2_000_000.25,
      repo_sweep_window_open: true,
      repo_sweep_mature: false,
      tier1_repo_rate_apy: 4.25,
      tier2_bond_yield_pct: 4.80,
      tier2_bond_price_index: 100.0,
      tier2_bond_mod_duration: 1.92,
      tier3_stock_index_price: 5000.0,
      tier3_stock_volatility_pct: 18.0,
      tier1_early_redemption_haircut_pct: 0.5,
      tier2_bond_liquidation_haircut_pct: 2.0,
      tier3_stock_liquidation_haircut_pct: 15.0,
      emergency_overdraft_penalty_apr_pct: 12.0,
    };

    const bucket = treasuryRecordToHourlyBucket(sampleRecord);
    expect(bucket.bucketId).toBe("2026-01-01T17:00:00Z");
    expect(bucket.hourStart.toISOString()).toBe("2026-01-01T17:00:00.000Z");
    expect(bucket.inbound.toDecimal()).toBe(10_000_000.5);
    expect(bucket.outbound.toDecimal()).toBe(8_000_000.25);
    expect(bucket.netFlow.toDecimal()).toBe(2_000_000.25);
    expect(bucket.grossVolume.toDecimal()).toBe(18_000_000.75);
  });

  it("computes dataset summary metrics cleanly", () => {
    const dataset = loadTreasuryDataset();
    const summary = getTreasuryDatasetSummary(dataset);

    expect(summary.totalHours).toBe(8760);
    expect(summary.startDate).toBe("2026-01-01T00:00:00Z");
    expect(summary.endDate).toBe("2026-12-31T23:00:00Z");
    expect(summary.totalDepositsUsd).toBeGreaterThan(1_000_000_000);
    expect(summary.totalWithdrawalsUsd).toBeGreaterThan(1_000_000_000);
    expect(summary.sweepWindowsCount).toBe(365);
    expect(summary.matureWindowsCount).toBe(365);
    expect(summary.avgRepoRateApy).toBeGreaterThan(3.5);
    expect(summary.avgBondYieldPct).toBeGreaterThan(4.0);
  });

  it("throws clear error on malformed CSV header or content", () => {
    expect(() => parseTreasuryCSV("bad,header\n1,2")).toThrow(/Missing expected CSV header column/);
  });
});
