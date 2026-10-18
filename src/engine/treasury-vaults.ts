/**
 * Reserve Juggler - 4-Tier Treasury Vaults & Liquidation Cascade
 *
 * Implements the official 4-tier banking liquidity mechanics conforming to:
 * - Tier 0: Operating Cash Buffer (0.0% APY, absorbs customer deposits & payouts, holds Basel III reserve R)
 * - Tier 1: Overnight Repo Vault (swept strictly at 17:00 UTC, matures at 08:00 UTC, ~4.05-4.3% APY, 0.5% early-break haircut)
 * - Tier 2: 2Y Sovereign Debt (YTM ~4.8%, modified duration D_mod = 1.92, dP ≈ -D_mod * dy, 2.0% liquidation haircut)
 * - Tier 3: Growth Equities (~10.0% expected return, sigma = 18%, mark-to-market index tracking, 15.0% slippage haircut)
 * - Emergency Overdraft: Central Bank credit line at 12.0% APR penalty if all 4 tiers are exhausted.
 *
 * Preserves strict BigInt Money accounting and Penny-Conservation across all sweeps, accruals, and liquidations.
 */

import { Money } from "@/engine/money";
import { TreasuryHourRecord } from "@/engine/dataset";

export type TierVaultId =
  | "tier0_cash"
  | "tier1_repo"
  | "tier2_bonds"
  | "tier3_equities"
  | "emergency_overdraft";

export interface TierLiquidationOrder {
  tierId: TierVaultId;
  tierName: string;
  grossLiquidated: Money;
  haircutRatePct: number;
  penaltyPaid: Money;
  netRecoveredCash: Money;
  settlementLagHours: number;
}

export interface CascadeLiquidationResult {
  deficitAmount: Money;
  totalRecoveredCash: Money;
  totalPenaltiesPaid: Money;
  overdraftDrawn: Money;
  orders: TierLiquidationOrder[];
  isFullySatisfied: boolean;
}

/**
 * Snapshot of complete treasury state at a specific point in time.
 */
export interface TreasurySnapshot {
  hourIndex: number;
  timestamp: string;
  tier0Cash: Money;
  tier1RepoPrincipal: Money;
  tier1RepoAccruedYield: Money;
  tier1IsActive: boolean;
  tier2BondsMarketValue: Money;
  tier2BondsParValue: Money;
  tier2BondsPriceIndex: number;
  tier2BondsAccruedYield: Money;
  tier3EquitiesMarketValue: Money;
  tier3EquitiesCostBasis: Money;
  tier3EquitiesIndexPrice: number;
  tier3PeakMarketValue: Money;
  tier3DrawdownPct: number;
  emergencyOverdraftBalance: Money;
  totalAssets: Money; // Tier 0 + Tier 1 + Tier 2 + Tier 3 - Overdraft
  cumulativeGrossYieldEarned: Money;
  cumulativePenaltiesPaid: Money;
  cumulativeOverdraftInterestPaid: Money;
}

/**
 * 4-Tier Treasury Portfolio Manager.
 */
export class TreasuryPortfolio {
  // Tier 0: Operating Cash
  tier0Cash: Money;

  // Tier 1: Overnight Repo
  tier1RepoPrincipal: Money;
  tier1RepoAccruedYield: Money;
  tier1IsOpen: boolean;
  tier1EntryHour: number;
  tier1RateApy: number;

  // Tier 2: 2Y Sovereign Debt
  tier2BondsParValue: Money;
  tier2BondsMarketValue: Money;
  tier2BondsYieldPct: number;
  tier2BondsPriceIndex: number;
  tier2BondsModDuration: number;
  tier2BondsAccruedYield: Money;

  // Tier 3: Growth Equities
  tier3EquitiesCostBasis: Money;
  tier3EquitiesMarketValue: Money;
  tier3EquitiesIndexPrice: number;
  tier3EquitiesShares: number;
  tier3PeakMarketValue: Money;

  // Central Bank Emergency Overdraft
  emergencyOverdraftBalance: Money;

  // Telemetry & Accounting Invariants
  cumulativeGrossYieldEarned: Money;
  cumulativePenaltiesPaid: Money;
  cumulativeOverdraftInterestPaid: Money;

  constructor(initialCash: Money = Money.fromDecimal(50_000_000, "USD")) {
    this.tier0Cash = initialCash;

    this.tier1RepoPrincipal = Money.zero("USD");
    this.tier1RepoAccruedYield = Money.zero("USD");
    this.tier1IsOpen = false;
    this.tier1EntryHour = -1;
    this.tier1RateApy = 4.20;

    this.tier2BondsParValue = Money.zero("USD");
    this.tier2BondsMarketValue = Money.zero("USD");
    this.tier2BondsYieldPct = 4.80;
    this.tier2BondsPriceIndex = 100.0;
    this.tier2BondsModDuration = 1.92;
    this.tier2BondsAccruedYield = Money.zero("USD");

    this.tier3EquitiesCostBasis = Money.zero("USD");
    this.tier3EquitiesMarketValue = Money.zero("USD");
    this.tier3EquitiesIndexPrice = 5000.0;
    this.tier3EquitiesShares = 0;
    this.tier3PeakMarketValue = Money.zero("USD");

    this.emergencyOverdraftBalance = Money.zero("USD");

    this.cumulativeGrossYieldEarned = Money.zero("USD");
    this.cumulativePenaltiesPaid = Money.zero("USD");
    this.cumulativeOverdraftInterestPaid = Money.zero("USD");
  }

  /**
   * Computes total net treasury assets: Cash + Repo + Bonds + Equities - Overdraft.
   */
  getTotalNetAssets(): Money {
    const grossAssets = this.tier0Cash
      .add(this.tier1RepoPrincipal)
      .add(this.tier1RepoAccruedYield)
      .add(this.tier2BondsMarketValue)
      .add(this.tier3EquitiesMarketValue);

    if (this.emergencyOverdraftBalance.isPositive()) {
      return grossAssets.subtract(this.emergencyOverdraftBalance);
    }
    return grossAssets;
  }

  /**
   * Clock step: accrues hourly interest and updates mark-to-market valuations from dataset row.
   */
  processHourlyAccruals(record: TreasuryHourRecord): void {
    // 1. Accrue Tier 1 Overnight Repo interest if open
    if (this.tier1IsOpen && this.tier1RepoPrincipal.isPositive()) {
      // Hourly rate: APY / 8760
      const apyDecimal = record.tier1_repo_rate_apy / 100.0;
      const hourlyInterestMinor = BigInt(
        Math.floor(
          (Number(this.tier1RepoPrincipal.amountMinor) * apyDecimal) / 8760
        )
      );
      if (hourlyInterestMinor > 0n) {
        const delta = Money.fromMinor(hourlyInterestMinor, "USD");
        this.tier1RepoAccruedYield = this.tier1RepoAccruedYield.add(delta);
        this.cumulativeGrossYieldEarned = this.cumulativeGrossYieldEarned.add(delta);
      }
    }

    // 2. Accrue Tier 2 Sovereign Bonds coupon & mark-to-market
    if (this.tier2BondsParValue.isPositive()) {
      this.tier2BondsYieldPct = record.tier2_bond_yield_pct;
      this.tier2BondsPriceIndex = record.tier2_bond_price_index;
      this.tier2BondsModDuration = record.tier2_bond_mod_duration;

      // Mark-to-market value based on price index (base 100.0)
      const mtmMinor = BigInt(
        Math.floor(
          (Number(this.tier2BondsParValue.amountMinor) * this.tier2BondsPriceIndex) / 100.0
        )
      );
      this.tier2BondsMarketValue = Money.fromMinor(mtmMinor, "USD");

      // Hourly coupon accrual: (Par * YTM) / 8760
      const couponApy = this.tier2BondsYieldPct / 100.0;
      const hourlyCouponMinor = BigInt(
        Math.floor(
          (Number(this.tier2BondsParValue.amountMinor) * couponApy) / 8760
        )
      );
      if (hourlyCouponMinor > 0n) {
        const deltaCoupon = Money.fromMinor(hourlyCouponMinor, "USD");
        this.tier2BondsAccruedYield = this.tier2BondsAccruedYield.add(deltaCoupon);
        this.cumulativeGrossYieldEarned = this.cumulativeGrossYieldEarned.add(deltaCoupon);
      }
    }

    // 3. Mark-to-market Tier 3 Growth Equities
    if (this.tier3EquitiesShares > 0) {
      this.tier3EquitiesIndexPrice = record.tier3_stock_index_price;
      const mtmMinor = BigInt(
        Math.floor(this.tier3EquitiesShares * this.tier3EquitiesIndexPrice * 100)
      );
      this.tier3EquitiesMarketValue = Money.fromMinor(mtmMinor, "USD");

      if (this.tier3EquitiesMarketValue.greaterThan(this.tier3PeakMarketValue)) {
        this.tier3PeakMarketValue = this.tier3EquitiesMarketValue;
      }
    }

    // 4. Central Bank Emergency Overdraft interest accrual (12% APR)
    if (this.emergencyOverdraftBalance.isPositive()) {
      const overdraftApr = (record.emergency_overdraft_penalty_apr_pct || 12.0) / 100.0;
      const hourlyPenaltyMinor = BigInt(
        Math.ceil(
          (Number(this.emergencyOverdraftBalance.amountMinor) * overdraftApr) / 8760
        )
      );
      if (hourlyPenaltyMinor > 0n) {
        const penaltyInterest = Money.fromMinor(hourlyPenaltyMinor, "USD");
        // Overdraft balance compounds with penalty interest
        this.emergencyOverdraftBalance = this.emergencyOverdraftBalance.add(penaltyInterest);
        this.cumulativeOverdraftInterestPaid = this.cumulativeOverdraftInterestPaid.add(penaltyInterest);
      }
    }
  }

  /**
   * Matures overnight repo at 08:00 UTC, releasing principal + accrued interest back into Tier 0 Cash.
   */
  matureRepoAt0800(): { maturedPrincipal: Money; accruedInterest: Money } | null {
    if (!this.tier1IsOpen || this.tier1RepoPrincipal.isZero()) {
      return null;
    }

    const principal = this.tier1RepoPrincipal;
    const interest = this.tier1RepoAccruedYield;
    const totalReleased = principal.add(interest);

    this.tier0Cash = this.tier0Cash.add(totalReleased);
    this.tier1RepoPrincipal = Money.zero("USD");
    this.tier1RepoAccruedYield = Money.zero("USD");
    this.tier1IsOpen = false;
    this.tier1EntryHour = -1;

    return { maturedPrincipal: principal, accruedInterest: interest };
  }

  /**
   * Sweeps available surplus cash into Tier 1 Overnight Repo at 17:00 UTC.
   */
  sweepIntoRepoAt1700(amountToSweep: Money, currentRateApy: number, hourIndex: number): boolean {
    if (amountToSweep.isZero() || amountToSweep.isNegative()) {
      return false;
    }
    if (amountToSweep.greaterThan(this.tier0Cash)) {
      amountToSweep = this.tier0Cash;
    }

    this.tier0Cash = this.tier0Cash.subtract(amountToSweep);
    this.tier1RepoPrincipal = this.tier1RepoPrincipal.add(amountToSweep);
    this.tier1RateApy = currentRateApy;
    this.tier1IsOpen = true;
    this.tier1EntryHour = hourIndex;

    return true;
  }

  /**
   * Allocates deployable surplus across Tiers 1, 2, and 3 according to target weights.
   */
  allocateSurplus(
    surplusToDeploy: Money,
    weights: { repoPct: number; bondsPct: number; equitiesPct: number },
    record: TreasuryHourRecord,
    hourIndex: number
  ): { repoAllocated: Money; bondsAllocated: Money; equitiesAllocated: Money } {
    let remaining = surplusToDeploy.lessThanOrEqual(this.tier0Cash)
      ? surplusToDeploy
      : this.tier0Cash;

    if (remaining.isZero() || remaining.isNegative()) {
      return {
        repoAllocated: Money.zero("USD"),
        bondsAllocated: Money.zero("USD"),
        equitiesAllocated: Money.zero("USD"),
      };
    }

    // First repay any active emergency overdraft before new investments!
    if (this.emergencyOverdraftBalance.isPositive()) {
      const repayAmount = remaining.lessThanOrEqual(this.emergencyOverdraftBalance)
        ? remaining
        : this.emergencyOverdraftBalance;

      this.emergencyOverdraftBalance = this.emergencyOverdraftBalance.subtract(repayAmount);
      this.tier0Cash = this.tier0Cash.subtract(repayAmount);
      remaining = remaining.subtract(repayAmount);

      if (remaining.isZero()) {
        return {
          repoAllocated: Money.zero("USD"),
          bondsAllocated: Money.zero("USD"),
          equitiesAllocated: Money.zero("USD"),
        };
      }
    }

    const totalWeight = weights.repoPct + weights.bondsPct + weights.equitiesPct;
    if (totalWeight <= 0) {
      return {
        repoAllocated: Money.zero("USD"),
        bondsAllocated: Money.zero("USD"),
        equitiesAllocated: Money.zero("USD"),
      };
    }

    let repoAllocated = Money.zero("USD");
    let bondsAllocated = Money.zero("USD");
    let equitiesAllocated = Money.zero("USD");

    // Tier 1 Repo: swept only if window is open (17:00 UTC)
    if (record.repo_sweep_window_open && weights.repoPct > 0) {
      const repoFraction = weights.repoPct / totalWeight;
      const targetRepoMinor = BigInt(
        Math.floor(Number(remaining.amountMinor) * repoFraction)
      );
      repoAllocated = Money.fromMinor(targetRepoMinor, "USD");
      this.sweepIntoRepoAt1700(repoAllocated, record.tier1_repo_rate_apy, hourIndex);
    }

    // Tier 2 Sovereign Bonds
    if (weights.bondsPct > 0) {
      const bondsFraction = weights.bondsPct / totalWeight;
      const targetBondsMinor = BigInt(
        Math.floor(Number(remaining.amountMinor) * bondsFraction)
      );
      bondsAllocated = Money.fromMinor(targetBondsMinor, "USD");
      if (bondsAllocated.greaterThan(this.tier0Cash)) {
        bondsAllocated = this.tier0Cash;
      }
      this.tier0Cash = this.tier0Cash.subtract(bondsAllocated);
      this.tier2BondsParValue = this.tier2BondsParValue.add(bondsAllocated);
      this.tier2BondsMarketValue = this.tier2BondsMarketValue.add(bondsAllocated);
      this.tier2BondsPriceIndex = record.tier2_bond_price_index;
    }

    // Tier 3 Growth Equities
    if (weights.equitiesPct > 0) {
      const equitiesFraction = weights.equitiesPct / totalWeight;
      const targetEquitiesMinor = BigInt(
        Math.floor(Number(remaining.amountMinor) * equitiesFraction)
      );
      equitiesAllocated = Money.fromMinor(targetEquitiesMinor, "USD");
      if (equitiesAllocated.greaterThan(this.tier0Cash)) {
        equitiesAllocated = this.tier0Cash;
      }
      this.tier0Cash = this.tier0Cash.subtract(equitiesAllocated);
      this.tier3EquitiesCostBasis = this.tier3EquitiesCostBasis.add(equitiesAllocated);
      this.tier3EquitiesMarketValue = this.tier3EquitiesMarketValue.add(equitiesAllocated);
      this.tier3EquitiesIndexPrice = record.tier3_stock_index_price;
      this.tier3EquitiesShares +=
        Number(equitiesAllocated.amountMinor) / (record.tier3_stock_index_price * 100);
      if (this.tier3EquitiesMarketValue.greaterThan(this.tier3PeakMarketValue)) {
        this.tier3PeakMarketValue = this.tier3EquitiesMarketValue;
      }
    }

    return { repoAllocated, bondsAllocated, equitiesAllocated };
  }

  /**
   * Executes the exact 5-tier lowest-penalty cascading liquidation:
   * 1. Unallocated Tier 0 Cash (0% fee, instant)
   * 2. Tier 1 Repo (0% if matured, 0.5% haircut if broken early)
   * 3. Tier 2 Sovereign Debt (2.0% market haircut)
   * 4. Tier 3 Growth Equities (15.0% slippage fee)
   * 5. Central Bank Emergency Overdraft (12.0% APR penalty)
   */
  executeLiquidationCascade(
    deficitNeeded: Money,
    record: TreasuryHourRecord
  ): CascadeLiquidationResult {
    if (deficitNeeded.isZero() || deficitNeeded.isNegative()) {
      return {
        deficitAmount: Money.zero("USD"),
        totalRecoveredCash: Money.zero("USD"),
        totalPenaltiesPaid: Money.zero("USD"),
        overdraftDrawn: Money.zero("USD"),
        orders: [],
        isFullySatisfied: true,
      };
    }

    let remainingNeeded = deficitNeeded;
    let totalRecovered = Money.zero("USD");
    let totalPenalties = Money.zero("USD");
    let overdraftDrawn = Money.zero("USD");
    const orders: TierLiquidationOrder[] = [];

    // --- STEP 1: Unallocated Tier 0 Cash (0% fee) ---
    if (this.tier0Cash.isPositive()) {
      const cashAvail = this.tier0Cash.lessThanOrEqual(remainingNeeded)
        ? this.tier0Cash
        : remainingNeeded;

      this.tier0Cash = this.tier0Cash.subtract(cashAvail);
      remainingNeeded = remainingNeeded.subtract(cashAvail);
      totalRecovered = totalRecovered.add(cashAvail);

      orders.push({
        tierId: "tier0_cash",
        tierName: "Tier 0: Cash Buffer",
        grossLiquidated: cashAvail,
        haircutRatePct: 0.0,
        penaltyPaid: Money.zero("USD"),
        netRecoveredCash: cashAvail,
        settlementLagHours: 0,
      });
    }

    if (remainingNeeded.isZero()) {
      return {
        deficitAmount: deficitNeeded,
        totalRecoveredCash: totalRecovered,
        totalPenaltiesPaid: totalPenalties,
        overdraftDrawn,
        orders,
        isFullySatisfied: true,
      };
    }

    // --- STEP 2: Tier 1 Overnight Repo (0.5% haircut if early break) ---
    if (this.tier1IsOpen && this.tier1RepoPrincipal.isPositive()) {
      const haircutPct = record.tier1_early_redemption_haircut_pct || 0.5;
      const netMultiplier = 1.0 - haircutPct / 100.0;

      // Max net cash that can be recovered from Repo
      const maxNetFromRepoMinor = BigInt(
        Math.floor(Number(this.tier1RepoPrincipal.amountMinor) * netMultiplier)
      );
      const maxNetFromRepo = Money.fromMinor(maxNetFromRepoMinor, "USD");

      const netPull = remainingNeeded.lessThanOrEqual(maxNetFromRepo)
        ? remainingNeeded
        : maxNetFromRepo;

      // Gross principal to pull
      const grossPullMinor = BigInt(
        Math.ceil(Number(netPull.amountMinor) / netMultiplier)
      );
      const grossPull = Money.fromMinor(
        grossPullMinor <= this.tier1RepoPrincipal.amountMinor
          ? grossPullMinor
          : this.tier1RepoPrincipal.amountMinor,
        "USD"
      );
      const penaltyMinor = grossPull.amountMinor - netPull.amountMinor;
      const penalty = Money.fromMinor(penaltyMinor > 0n ? penaltyMinor : 0n, "USD");

      this.tier1RepoPrincipal = this.tier1RepoPrincipal.subtract(grossPull);
      if (this.tier1RepoPrincipal.isZero()) {
        this.tier1IsOpen = false;
        this.tier1RepoAccruedYield = Money.zero("USD");
      }

      this.cumulativePenaltiesPaid = this.cumulativePenaltiesPaid.add(penalty);
      totalPenalties = totalPenalties.add(penalty);
      totalRecovered = totalRecovered.add(netPull);
      remainingNeeded = remainingNeeded.subtract(netPull);

      orders.push({
        tierId: "tier1_repo",
        tierName: "Tier 1: Overnight Repo (Early Break)",
        grossLiquidated: grossPull,
        haircutRatePct: haircutPct,
        penaltyPaid: penalty,
        netRecoveredCash: netPull,
        settlementLagHours: 0,
      });
    }

    if (remainingNeeded.isZero()) {
      return {
        deficitAmount: deficitNeeded,
        totalRecoveredCash: totalRecovered,
        totalPenaltiesPaid: totalPenalties,
        overdraftDrawn,
        orders,
        isFullySatisfied: true,
      };
    }

    // --- STEP 3: Tier 2 Sovereign Bonds (2.0% market haircut) ---
    if (this.tier2BondsMarketValue.isPositive()) {
      const haircutPct = record.tier2_bond_liquidation_haircut_pct || 2.0;
      const netMultiplier = 1.0 - haircutPct / 100.0;

      const maxNetFromBondsMinor = BigInt(
        Math.floor(Number(this.tier2BondsMarketValue.amountMinor) * netMultiplier)
      );
      const maxNetFromBonds = Money.fromMinor(maxNetFromBondsMinor, "USD");

      const netPull = remainingNeeded.lessThanOrEqual(maxNetFromBonds)
        ? remainingNeeded
        : maxNetFromBonds;

      const grossPullMinor = BigInt(
        Math.ceil(Number(netPull.amountMinor) / netMultiplier)
      );
      const grossPull = Money.fromMinor(
        grossPullMinor <= this.tier2BondsMarketValue.amountMinor
          ? grossPullMinor
          : this.tier2BondsMarketValue.amountMinor,
        "USD"
      );
      const penaltyMinor = grossPull.amountMinor - netPull.amountMinor;
      const penalty = Money.fromMinor(penaltyMinor > 0n ? penaltyMinor : 0n, "USD");

      this.tier2BondsMarketValue = this.tier2BondsMarketValue.subtract(grossPull);
      this.tier2BondsParValue = this.tier2BondsParValue.subtract(grossPull);
      if (this.tier2BondsParValue.isNegative()) {
        this.tier2BondsParValue = Money.zero("USD");
      }

      this.cumulativePenaltiesPaid = this.cumulativePenaltiesPaid.add(penalty);
      totalPenalties = totalPenalties.add(penalty);
      totalRecovered = totalRecovered.add(netPull);
      remainingNeeded = remainingNeeded.subtract(netPull);

      orders.push({
        tierId: "tier2_bonds",
        tierName: "Tier 2: Sovereign Debt (Market Haircut)",
        grossLiquidated: grossPull,
        haircutRatePct: haircutPct,
        penaltyPaid: penalty,
        netRecoveredCash: netPull,
        settlementLagHours: 1,
      });
    }

    if (remainingNeeded.isZero()) {
      return {
        deficitAmount: deficitNeeded,
        totalRecoveredCash: totalRecovered,
        totalPenaltiesPaid: totalPenalties,
        overdraftDrawn,
        orders,
        isFullySatisfied: true,
      };
    }

    // --- STEP 4: Tier 3 Growth Equities (15.0% slippage fee) ---
    if (this.tier3EquitiesMarketValue.isPositive()) {
      const haircutPct = record.tier3_stock_liquidation_haircut_pct || 15.0;
      const netMultiplier = 1.0 - haircutPct / 100.0;

      const maxNetFromEquitiesMinor = BigInt(
        Math.floor(Number(this.tier3EquitiesMarketValue.amountMinor) * netMultiplier)
      );
      const maxNetFromEquities = Money.fromMinor(maxNetFromEquitiesMinor, "USD");

      const netPull = remainingNeeded.lessThanOrEqual(maxNetFromEquities)
        ? remainingNeeded
        : maxNetFromEquities;

      const grossPullMinor = BigInt(
        Math.ceil(Number(netPull.amountMinor) / netMultiplier)
      );
      const grossPull = Money.fromMinor(
        grossPullMinor <= this.tier3EquitiesMarketValue.amountMinor
          ? grossPullMinor
          : this.tier3EquitiesMarketValue.amountMinor,
        "USD"
      );
      const penaltyMinor = grossPull.amountMinor - netPull.amountMinor;
      const penalty = Money.fromMinor(penaltyMinor > 0n ? penaltyMinor : 0n, "USD");

      this.tier3EquitiesMarketValue = this.tier3EquitiesMarketValue.subtract(grossPull);
      this.tier3EquitiesCostBasis = this.tier3EquitiesCostBasis.subtract(grossPull);
      if (this.tier3EquitiesCostBasis.isNegative()) {
        this.tier3EquitiesCostBasis = Money.zero("USD");
      }
      this.tier3EquitiesShares = Math.max(
        0,
        this.tier3EquitiesShares - Number(grossPull.amountMinor) / (this.tier3EquitiesIndexPrice * 100)
      );

      this.cumulativePenaltiesPaid = this.cumulativePenaltiesPaid.add(penalty);
      totalPenalties = totalPenalties.add(penalty);
      totalRecovered = totalRecovered.add(netPull);
      remainingNeeded = remainingNeeded.subtract(netPull);

      orders.push({
        tierId: "tier3_equities",
        tierName: "Tier 3: Growth Equities (Slippage Haircut)",
        grossLiquidated: grossPull,
        haircutRatePct: haircutPct,
        penaltyPaid: penalty,
        netRecoveredCash: netPull,
        settlementLagHours: 2,
      });
    }

    // --- STEP 5: Central Bank Emergency Overdraft (12.0% APR penalty) ---
    if (remainingNeeded.isPositive()) {
      overdraftDrawn = remainingNeeded;
      this.emergencyOverdraftBalance = this.emergencyOverdraftBalance.add(overdraftDrawn);
      totalRecovered = totalRecovered.add(overdraftDrawn);
      remainingNeeded = Money.zero("USD");

      orders.push({
        tierId: "emergency_overdraft",
        tierName: "Emergency Overdraft Facility (12% APR)",
        grossLiquidated: overdraftDrawn,
        haircutRatePct: record.emergency_overdraft_penalty_apr_pct || 12.0,
        penaltyPaid: Money.zero("USD"), // Interest accrues hourly
        netRecoveredCash: overdraftDrawn,
        settlementLagHours: 0,
      });
    }

    return {
      deficitAmount: deficitNeeded,
      totalRecoveredCash: totalRecovered,
      totalPenaltiesPaid: totalPenalties,
      overdraftDrawn,
      orders,
      isFullySatisfied: true,
    };
  }

  /**
   * Produces an immutable state snapshot of the entire treasury.
   */
  getSnapshot(hourIndex: number, timestamp: string): TreasurySnapshot {
    const totalAssets = this.getTotalNetAssets();
    let drawdownPct = 0;
    if (this.tier3PeakMarketValue.isPositive()) {
      const peak = Number(this.tier3PeakMarketValue.amountMinor);
      const curr = Number(this.tier3EquitiesMarketValue.amountMinor);
      drawdownPct = peak > 0 ? Math.max(0, ((peak - curr) / peak) * 100) : 0;
    }

    return {
      hourIndex,
      timestamp,
      tier0Cash: this.tier0Cash,
      tier1RepoPrincipal: this.tier1RepoPrincipal,
      tier1RepoAccruedYield: this.tier1RepoAccruedYield,
      tier1IsActive: this.tier1IsOpen,
      tier2BondsMarketValue: this.tier2BondsMarketValue,
      tier2BondsParValue: this.tier2BondsParValue,
      tier2BondsPriceIndex: this.tier2BondsPriceIndex,
      tier2BondsAccruedYield: this.tier2BondsAccruedYield,
      tier3EquitiesMarketValue: this.tier3EquitiesMarketValue,
      tier3EquitiesCostBasis: this.tier3EquitiesCostBasis,
      tier3EquitiesIndexPrice: this.tier3EquitiesIndexPrice,
      tier3PeakMarketValue: this.tier3PeakMarketValue,
      tier3DrawdownPct: Math.round(drawdownPct * 100) / 100,
      emergencyOverdraftBalance: this.emergencyOverdraftBalance,
      totalAssets,
      cumulativeGrossYieldEarned: this.cumulativeGrossYieldEarned,
      cumulativePenaltiesPaid: this.cumulativePenaltiesPaid,
      cumulativeOverdraftInterestPaid: this.cumulativeOverdraftInterestPaid,
    };
  }
}
