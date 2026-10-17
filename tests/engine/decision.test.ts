import { describe, it, expect } from "vitest";
import {
  evaluateLiquidityDecision,
  solveLiquidation,
  AllocatedHolding,
  DecisionContext,
} from "@/engine/decision";
import { Money } from "@/engine/money";
import { Instrument } from "@/engine/models";

describe("Liquidity Decision Engine & State Machine", () => {
  const instruments: Instrument[] = [
    {
      id: "i1",
      name: "Overnight sweep",
      apy: 410,
      capacity: Money.fromDecimal("20000000.00"),
      withdrawalPenalty: 0, // 0 bps penalty
      settlementLagHours: 0, // Instant
    },
    {
      id: "i2",
      name: "7-day term deposit",
      apy: 465,
      capacity: Money.fromDecimal("15000000.00"),
      withdrawalPenalty: 15, // 15 bps penalty
      settlementLagHours: 24, // 1 day lag
    },
    {
      id: "i3",
      name: "30-day T-bill MMF",
      apy: 502,
      capacity: Money.fromDecimal("10000000.00"),
      withdrawalPenalty: 30, // 30 bps penalty
      settlementLagHours: 48, // 2 days lag
    },
  ];

  const holdings: AllocatedHolding[] = [
    {
      instrument: instruments[0], // 0 bps, 0h lag
      currentAmount: Money.fromDecimal("10000000.00"), // $10M
    },
    {
      instrument: instruments[1], // 15 bps, 24h lag
      currentAmount: Money.fromDecimal("10000000.00"), // $10M
    },
    {
      instrument: instruments[2], // 30 bps, 48h lag
      currentAmount: Money.fromDecimal("10000000.00"), // $10M
    },
  ];

  describe("Liquidation Solver (solveLiquidation)", () => {
    it("returns an empty plan when deficit is zero or negative", () => {
      const plan = solveLiquidation(Money.zero(), holdings);
      expect(plan.orders).toHaveLength(0);
      expect(plan.isFullyCovered).toBe(true);
      expect(plan.residualReserveGap.toDecimal()).toBe(0);
    });

    it("prioritizes cheapest penalty and fastest settlement first", () => {
      // Deficit of $5M
      // Must liquidate from i1 (Overnight sweep: 0% penalty, 0h lag)
      const deficit = Money.fromDecimal("5000000.00");
      const plan = solveLiquidation(deficit, holdings);

      expect(plan.orders).toHaveLength(1);
      const order = plan.orders[0];
      expect(order.instrumentId).toBe("i1");
      expect(order.penaltyRate).toBe(0);
      expect(order.settlementLagHours).toBe(0);
      expect(order.amountToLiquidate.toDecimal()).toBe(5000000);
      expect(order.realizedPenalty.toDecimal()).toBe(0);
      expect(order.netRecoveredCash.toDecimal()).toBe(5000000);
      expect(order.remainingHolding.toDecimal()).toBe(5000000);

      expect(plan.isFullyCovered).toBe(true);
      expect(plan.residualReserveGap.toDecimal()).toBe(0);
      expect(plan.totalRealizedPenalties.toDecimal()).toBe(0);
    });

    it("cascades across multiple holdings when first holding is exhausted", () => {
      // Deficit of $15M
      // i1 has $10M -> exhausted first ($10M recovered, $0 penalty)
      // i2 (15 bps, 24h lag) must provide the remaining $5M
      const deficit = Money.fromDecimal("15000000.00");
      const plan = solveLiquidation(deficit, holdings);

      expect(plan.orders).toHaveLength(2);

      // Order 1: i1 (exhausted)
      expect(plan.orders[0].instrumentId).toBe("i1");
      expect(plan.orders[0].amountToLiquidate.toDecimal()).toBe(10000000);
      expect(plan.orders[0].remainingHolding.toDecimal()).toBe(0);

      // Order 2: i2 (15 bps penalty = 0.15%)
      expect(plan.orders[1].instrumentId).toBe("i2");
      expect(plan.orders[1].amountToLiquidate.toDecimal()).toBeGreaterThan(5000000);
      expect(plan.orders[1].realizedPenalty.toDecimal()).toBeGreaterThan(0);
      expect(plan.orders[1].netRecoveredCash.toDecimal()).toBeGreaterThanOrEqual(5000000);

      expect(plan.isFullyCovered).toBe(true);
      expect(plan.residualReserveGap.toDecimal()).toBe(0);
      expect(plan.totalNetRecoveredCash.toDecimal()).toBeGreaterThanOrEqual(15000000);
    });

    it("handles bank run shortfall when holdings cannot cover deficit", () => {
      // Total holdings = $30M ($10M + $10M + $10M)
      // Deficit = $50M (exceeds all available holdings by $20M+)
      const severeDeficit = Money.fromDecimal("50000000.00");
      const plan = solveLiquidation(severeDeficit, holdings);

      // All 3 holdings liquidated to exhaustion
      expect(plan.orders).toHaveLength(3);
      for (const order of plan.orders) {
        expect(order.remainingHolding.toDecimal()).toBe(0);
      }

      expect(plan.isFullyCovered).toBe(false);
      expect(plan.residualReserveGap.toDecimal()).toBeGreaterThan(20000000);
    });
  });

  describe("Decision State Machine", () => {
    const baseContext: DecisionContext = {
      availableCash: Money.fromDecimal("50000000.00"), // $50M
      expectedCumulativeFlow: Money.fromDecimal("-8000000.00"), // -$8M expected
      worstCaseResidualShortfall: Money.fromDecimal("-6000000.00"), // -$6M worst-case
      operationalFloor: Money.fromDecimal("2000000.00"), // $2M floor -> R = 16M
      sampleSize: 45, // >= 30
      mase: 0.85, // <= 1.2
      currentHoldings: holdings,
      availableInstruments: instruments,
      horizonHours: 24,
    };

    it("transitions to HEALTHY state and deploys surplus when solvency and confidence satisfied", () => {
      // C = $50M, R = $16M -> Surplus = $34M
      const decision = evaluateLiquidityDecision(baseContext);

      expect(decision.status).toBe("HEALTHY");
      expect(decision.requiredReserve.toDecimal()).toBe(16000000);
      expect(decision.availableCash.toDecimal()).toBe(50000000);
      expect(decision.coverageRatio).toBeCloseTo(50 / 16, 4);
      expect(decision.deployableSurplus.toDecimal()).toBe(34000000);
      expect(decision.reserveGap.toDecimal()).toBe(0);

      // Optimizer executed: surplus allocated across available instruments
      expect(decision.allocations.length).toBeGreaterThan(0);
      const totalAllocated = Money.sum(decision.allocations.map((a) => a.allocated));
      expect(totalAllocated.toDecimal()).toBeGreaterThan(0);
      expect(totalAllocated.toDecimal()).toBeLessThanOrEqual(34000000);

      // No warnings or liquidations
      expect(decision.warnings).toHaveLength(0);
      expect(decision.liquidationPlan.orders).toHaveLength(0);
    });

    it("transitions to UNDER_RESERVED state when cash is below reserve requirement", () => {
      // Cash drops to $12M (below R = $16M) -> Deficit = $4M
      const underReservedContext: DecisionContext = {
        ...baseContext,
        availableCash: Money.fromDecimal("12000000.00"),
      };

      const decision = evaluateLiquidityDecision(underReservedContext);

      expect(decision.status).toBe("UNDER_RESERVED");
      expect(decision.availableCash.toDecimal()).toBe(12000000);
      expect(decision.requiredReserve.toDecimal()).toBe(16000000);
      expect(decision.coverageRatio).toBe(0.75); // 12 / 16 = 75%
      expect(decision.deployableSurplus.toDecimal()).toBe(0); // Strictly $0
      expect(decision.reserveGap.toDecimal()).toBe(4000000);

      // No new deployments
      expect(decision.allocations).toHaveLength(0);

      // Liquidation plan formulated to recover $4M deficit
      expect(decision.liquidationPlan.orders.length).toBeGreaterThan(0);
      expect(decision.liquidationPlan.isFullyCovered).toBe(true);

      // Actionable warning triggered
      expect(decision.warnings.some((w) => w.includes("Liquidity deficit of $4,000,000.00"))).toBe(
        true
      );
    });

    it("transitions to LOW_CONFIDENCE and halts deployments when sample size is scarce (N < 30)", () => {
      // C = $50M >= R, but N = 15 < 30
      const scarceContext: DecisionContext = {
        ...baseContext,
        sampleSize: 15, // Scarce history
      };

      const decision = evaluateLiquidityDecision(scarceContext);

      expect(decision.status).toBe("LOW_CONFIDENCE");
      expect(decision.deployableSurplus.toDecimal()).toBe(0); // Deployments halted!
      expect(decision.allocations).toHaveLength(0);

      // Operational floor buffer increased by conservative 1.5x multiplier
      // Base floor $2M * 1.5 = $3M floor -> R increases from $16M to $17M
      expect(decision.requiredReserve.toDecimal()).toBe(17000000);

      // Warnings present
      expect(
        decision.warnings.some((w) => w.includes("Insufficient backtest history sample size"))
      ).toBe(true);
      expect(decision.warnings.some((w) => w.includes("Surplus yield deployment suspended"))).toBe(
        true
      );
    });

    it("transitions to LOW_CONFIDENCE when forecast accuracy is poor (MASE > 1.20)", () => {
      // C = $50M >= R, but MASE = 1.45 > 1.20 (worse than seasonal naive baseline)
      const poorMaseContext: DecisionContext = {
        ...baseContext,
        mase: 1.45,
      };

      const decision = evaluateLiquidityDecision(poorMaseContext);

      expect(decision.status).toBe("LOW_CONFIDENCE");
      expect(decision.deployableSurplus.toDecimal()).toBe(0);
      expect(decision.allocations).toHaveLength(0);

      expect(
        decision.warnings.some((w) => w.includes("Model accuracy below baseline standard: MASE is 1.45"))
      ).toBe(true);
    });

    it("prioritizes solvency protection if both low confidence and cash deficit occur", () => {
      // Cash = $10M, N = 12 < 30 (both under-reserved and low confidence)
      const compoundContext: DecisionContext = {
        ...baseContext,
        availableCash: Money.fromDecimal("10000000.00"),
        sampleSize: 12,
      };

      const decision = evaluateLiquidityDecision(compoundContext);

      // Under-reserved status takes operational precedence to trigger immediate liquidation
      expect(decision.status).toBe("UNDER_RESERVED");
      expect(decision.liquidationPlan.orders.length).toBeGreaterThan(0);
      expect(decision.warnings.some((w) => w.includes("Insufficient backtest history"))).toBe(
        true
      );
      expect(decision.warnings.some((w) => w.includes("CRITICAL: Liquidity deficit"))).toBe(
        true
      );
    });
  });
});
