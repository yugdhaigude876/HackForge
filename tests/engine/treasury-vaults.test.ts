import { describe, it, expect, beforeEach } from "vitest";
import {
  TreasuryPortfolio,
} from "@/engine/treasury-vaults";
import { TreasuryHourRecord } from "@/engine/dataset";
import { Money } from "@/engine/money";

describe("4-Tier Treasury Vaults & Liquidation Cascade (src/engine/treasury-vaults.ts)", () => {
  let portfolio: TreasuryPortfolio;
  let sampleRecord: TreasuryHourRecord;

  beforeEach(() => {
    portfolio = new TreasuryPortfolio(Money.fromDecimal(50_000_000, "USD"));
    sampleRecord = {
      timestamp: "2026-01-01T17:00:00Z",
      deposits_usd: 10_000_000,
      withdrawals_usd: 10_000_000,
      net_flow_usd: 0,
      repo_sweep_window_open: true,
      repo_sweep_mature: false,
      tier1_repo_rate_apy: 4.38, // 4.38% APY -> ~0.0005% per hour
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
  });

  it("initializes with Tier 0 Cash and zero allocations in other tiers", () => {
    expect(portfolio.tier0Cash.toDecimal()).toBe(50_000_000);
    expect(portfolio.tier1RepoPrincipal.isZero()).toBe(true);
    expect(portfolio.tier2BondsMarketValue.isZero()).toBe(true);
    expect(portfolio.tier3EquitiesMarketValue.isZero()).toBe(true);
    expect(portfolio.emergencyOverdraftBalance.isZero()).toBe(true);
    expect(portfolio.getTotalNetAssets().toDecimal()).toBe(50_000_000);
  });

  it("sweeps into Tier 1 Repo at 17:00 UTC, accrues hourly yield, and matures at 08:00 UTC releasing principal + interest", () => {
    const sweepAmount = Money.fromDecimal(20_000_000, "USD");
    const swept = portfolio.sweepIntoRepoAt1700(sweepAmount, 4.38, 17);
    expect(swept).toBe(true);
    expect(portfolio.tier0Cash.toDecimal()).toBe(30_000_000);
    expect(portfolio.tier1RepoPrincipal.toDecimal()).toBe(20_000_000);
    expect(portfolio.tier1IsOpen).toBe(true);

    // Accrue 15 hours of overnight interest (17:00 to 08:00)
    for (let h = 0; h < 15; h++) {
      portfolio.processHourlyAccruals(sampleRecord);
    }

    expect(portfolio.tier1RepoAccruedYield.isPositive()).toBe(true);
    const accruedDecimal = portfolio.tier1RepoAccruedYield.toDecimal();
    // 20M * 0.0438 / 8760 * 15 = ~1500 USD
    expect(accruedDecimal).toBeGreaterThan(1400);
    expect(accruedDecimal).toBeLessThan(1600);

    // At 08:00 UTC, mature repo
    const matured = portfolio.matureRepoAt0800();
    expect(matured).not.toBeNull();
    expect(matured!.maturedPrincipal.toDecimal()).toBe(20_000_000);
    expect(portfolio.tier1RepoPrincipal.isZero()).toBe(true);
    expect(portfolio.tier1IsOpen).toBe(false);
    // Cash balance now includes original 30M + 20M + ~1500 interest
    expect(portfolio.tier0Cash.toDecimal()).toBeGreaterThan(50_001_400);
  });

  it("enforces lowest-penalty cascading liquidation: Cash -> Repo (0.5%) -> Bonds (2.0%) -> Equities (15.0%) -> Overdraft (12%)", () => {
    // Deploy capital into all tiers:
    // Cash: 5M, Repo: 10M, Bonds: 15M, Equities: 20M
    portfolio.tier0Cash = Money.fromDecimal(5_000_000, "USD");
    portfolio.tier1RepoPrincipal = Money.fromDecimal(10_000_000, "USD");
    portfolio.tier1IsOpen = true;

    portfolio.tier2BondsParValue = Money.fromDecimal(15_000_000, "USD");
    portfolio.tier2BondsMarketValue = Money.fromDecimal(15_000_000, "USD");

    portfolio.tier3EquitiesCostBasis = Money.fromDecimal(20_000_000, "USD");
    portfolio.tier3EquitiesMarketValue = Money.fromDecimal(20_000_000, "USD");
    portfolio.tier3EquitiesShares = 4000;

    // Request deficit of $12,000,000
    // Expected cascade:
    // Step 1: Takes entire Tier 0 Cash ($5,000,000, 0% haircut) -> $7,000,000 remaining
    // Step 2: Takes from Tier 1 Repo ($7,000,000 net, with 0.5% early break haircut) -> 0 remaining
    const deficit1 = Money.fromDecimal(12_000_000, "USD");
    const res1 = portfolio.executeLiquidationCascade(deficit1, sampleRecord);

    expect(res1.isFullySatisfied).toBe(true);
    expect(res1.orders.length).toBe(2);
    expect(res1.orders[0].tierId).toBe("tier0_cash");
    expect(res1.orders[0].netRecoveredCash.toDecimal()).toBe(5_000_000);
    expect(res1.orders[0].haircutRatePct).toBe(0);

    expect(res1.orders[1].tierId).toBe("tier1_repo");
    expect(res1.orders[1].netRecoveredCash.toDecimal()).toBe(7_000_000);
    expect(res1.orders[1].haircutRatePct).toBe(0.5);
    expect(res1.orders[1].penaltyPaid.toDecimal()).toBeGreaterThan(34_000); // 7M / 0.995 * 0.005 = ~35,175

    // Verify Money conservation: grossLiquidated = netRecoveredCash + penaltyPaid
    for (const ord of res1.orders) {
      expect(ord.grossLiquidated.amountMinor).toBe(
        ord.netRecoveredCash.amountMinor + ord.penaltyPaid.amountMinor
      );
    }
  });

  it("cascades into Central Bank Emergency Overdraft when all 4 tiers are exhausted", () => {
    // Zero out all tiers
    portfolio.tier0Cash = Money.fromDecimal(1_000_000, "USD");
    portfolio.tier1RepoPrincipal = Money.zero("USD");
    portfolio.tier2BondsMarketValue = Money.zero("USD");
    portfolio.tier3EquitiesMarketValue = Money.zero("USD");

    // Deficit of $5,000,000: $1,000,000 covered by Cash, $4,000,000 drawn from Overdraft
    const deficit = Money.fromDecimal(5_000_000, "USD");
    const res = portfolio.executeLiquidationCascade(deficit, sampleRecord);

    expect(res.orders.length).toBe(2);
    expect(res.orders[0].tierId).toBe("tier0_cash");
    expect(res.orders[1].tierId).toBe("emergency_overdraft");
    expect(res.orders[1].netRecoveredCash.toDecimal()).toBe(4_000_000);
    expect(portfolio.emergencyOverdraftBalance.toDecimal()).toBe(4_000_000);

    // Accrue 1 hour of overdraft interest at 12% APR
    portfolio.processHourlyAccruals(sampleRecord);
    expect(portfolio.cumulativeOverdraftInterestPaid.isPositive()).toBe(true);
    // 4,000,000 * 0.12 / 8760 = ~54.79 USD
    expect(portfolio.cumulativeOverdraftInterestPaid.toDecimal()).toBeGreaterThan(50);
  });

  it("repaying overdraft takes highest priority on subsequent surplus allocations", () => {
    portfolio.emergencyOverdraftBalance = Money.fromDecimal(2_000_000, "USD");
    portfolio.tier0Cash = Money.fromDecimal(5_000_000, "USD");

    const surplus = Money.fromDecimal(3_000_000, "USD");
    const weights = { repoPct: 50, bondsPct: 50, equitiesPct: 0 };

    // $2M of the $3M surplus must first repay overdraft!
    portfolio.allocateSurplus(surplus, weights, sampleRecord, 17);

    expect(portfolio.emergencyOverdraftBalance.toDecimal()).toBe(0);
    // Only remaining $1M surplus was deployed across Repo and Bonds
    expect(portfolio.tier1RepoPrincipal.toDecimal()).toBe(500_000);
    expect(portfolio.tier2BondsParValue.toDecimal()).toBe(500_000);
  });
});
