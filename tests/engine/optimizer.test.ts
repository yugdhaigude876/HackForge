import { describe, it, expect } from "vitest";
import {
  Optimizer,
  optimizeAllocation,
  computeNetUnitValue,
  normalizeRate,
  normalizePenalty,
} from "@/engine/optimizer";
import { Money } from "@/engine/money";
import { Instrument } from "@/engine/models";

describe("Surplus Yield Optimizer Engine", () => {
  const sampleInstruments: Instrument[] = [
    {
      id: "i1",
      name: "Overnight sweep",
      apy: 410, // 4.10% in basis points
      capacity: Money.fromDecimal("20000000.00"), // $20M
      withdrawalPenalty: 0, // No penalty
      settlementLagHours: 0,
      earlyWithdrawalRisk: 0,
    },
    {
      id: "i2",
      name: "7-day term deposit",
      apy: 465, // 4.65% in basis points
      capacity: Money.fromDecimal("15000000.00"), // $15M
      withdrawalPenalty: 15, // 15 bps
      settlementLagHours: 24,
      earlyWithdrawalRisk: 0.01,
    },
    {
      id: "i3",
      name: "30-day T-bill MMF",
      apy: 502, // 5.02% in basis points
      capacity: Money.fromDecimal("10000000.00"), // $10M
      withdrawalPenalty: 30, // 30 bps
      settlementLagHours: 48,
      earlyWithdrawalRisk: 0.02,
    },
  ];

  describe("Rate Normalization & Net Unit Value Math", () => {
    it("normalizes basis points and decimal fractions identically", () => {
      expect(normalizeRate(450)).toBe(0.045);
      expect(normalizeRate(0.045)).toBe(0.045);

      expect(normalizePenalty(25)).toBe(0.0025);
      expect(normalizePenalty(0.0025)).toBe(0.0025);
    });

    it("evaluates net unit value v_i correctly over planning horizon H", () => {
      // Instrument with 5% APY, 20 bps penalty, 5% liquidation risk (pi = 0.05)
      // Over H = 720 hours (30 days):
      // gross rate = 0.05 * 720 / 8760 = 0.00410959
      // penalty rate = 0.05 * 0.0020 = 0.00010000
      // net unit value = 0.00410959 - 0.00010000 = 0.00400959 > 0
      const inst: Instrument = {
        id: "test",
        name: "Test Yield",
        apy: 0.05,
        capacity: Money.fromDecimal("1000000.00"),
        withdrawalPenalty: 0.002,
        earlyWithdrawalRisk: 0.05,
      };

      const metrics = computeNetUnitValue(inst, 720);
      expect(metrics.isEconomicallyViable).toBe(true);
      expect(metrics.grossHorizonRate).toBeCloseTo(0.05 * (720 / 8760), 6);
      expect(metrics.expectedPenaltyRate).toBeCloseTo(0.05 * 0.002, 6);
      expect(metrics.netUnitValue).toBeCloseTo(
        metrics.grossHorizonRate - metrics.expectedPenaltyRate,
        6
      );
    });

    it("identifies when penalties exceed short-horizon returns (FINANCIAL_MODEL.md Worked Example)", () => {
      // From FINANCIAL_MODEL.md lines 49:
      // Instrument: r = 4%, pi * p = 0.0002.
      // Over H = 4 hours:
      // v = 0.04 * 4 / 8760 - 0.0002 = 0.00001826 - 0.0002 = -0.0001817 < 0 -> NOT worth deploying
      const shortHorizonInst: Instrument = {
        id: "short-test",
        name: "Penalty Dominant",
        apy: 0.04,
        capacity: Money.fromDecimal("20000000.00"),
        withdrawalPenalty: 0.002, // 20 bps
        earlyWithdrawalRisk: 0.1,  // pi = 10% -> pi * p = 0.0002
      };

      const metrics4h = computeNetUnitValue(shortHorizonInst, 4);
      expect(metrics4h.netUnitValue).toBeLessThan(0);
      expect(metrics4h.isEconomicallyViable).toBe(false);

      // Over a longer 1-month horizon (720h), yield dominates penalties
      const metrics720h = computeNetUnitValue(shortHorizonInst, 720);
      expect(metrics720h.netUnitValue).toBeGreaterThan(0);
      expect(metrics720h.isEconomicallyViable).toBe(true);
    });
  });

  describe("Allocation Scenarios", () => {
    it("handles zero deployable surplus cleanly", () => {
      const zeroSurplus = Money.zero("USD");
      const result = optimizeAllocation(zeroSurplus, sampleInstruments, {
        horizonHours: 720,
      });

      expect(result.totalSurplus.toDecimal()).toBe(0);
      expect(result.totalAllocated.toDecimal()).toBe(0);
      expect(result.unallocatedSurplus.toDecimal()).toBe(0);
      expect(result.effectiveNetApyBps).toBe(0);

      for (const alloc of result.allocations) {
        expect(alloc.allocated.toDecimal()).toBe(0);
        expect(alloc.utilization).toBe(0);
      }
    });

    it("caps deployment at instrument capacity when surplus exceeds total capacity", () => {
      // Total capacity = $20M + $15M + $10M = $45M
      // Deployable surplus = $60M (exceeds capacity by $15M)
      const largeSurplus = Money.fromDecimal("60000000.00");
      const result = optimizeAllocation(largeSurplus, sampleInstruments, {
        horizonHours: 720,
      });

      expect(result.totalAllocated.toDecimal()).toBe(45000000);
      expect(result.unallocatedSurplus.toDecimal()).toBe(15000000);

      // All 3 instruments filled to 100% capacity
      expect(result.allocations[0].allocated.toDecimal()).toBe(20000000);
      expect(result.allocations[0].utilization).toBe(1.0);

      expect(result.allocations[1].allocated.toDecimal()).toBe(15000000);
      expect(result.allocations[1].utilization).toBe(1.0);

      expect(result.allocations[2].allocated.toDecimal()).toBe(10000000);
      expect(result.allocations[2].utilization).toBe(1.0);

      // Sum conservation invariant: totalAllocated + unallocated === totalSurplus
      expect(
        result.totalAllocated.add(result.unallocatedSurplus).equals(largeSurplus)
      ).toBe(true);
    });

    it("achieves 100% allocation on exact capacity match", () => {
      // Total capacity = $45M, Surplus = $45M
      const exactSurplus = Money.fromDecimal("45000000.00");
      const result = optimizeAllocation(exactSurplus, sampleInstruments, {
        horizonHours: 720,
      });

      expect(result.totalAllocated.equals(exactSurplus)).toBe(true);
      expect(result.unallocatedSurplus.toDecimal()).toBe(0);
      for (const alloc of result.allocations) {
        expect(alloc.utilization).toBe(1.0);
      }
    });

    it("greedily allocates to highest net yield instruments first", () => {
      // Instruments:
      // i1: 4.10% APY ($20M cap)
      // i2: 4.65% APY ($15M cap)
      // i3: 5.02% APY ($10M cap)
      // Total surplus = $18M over 720h horizon
      // Greedy order by net yield: i3 (5.02%) first, then i2 (4.65%), then i1 (4.10%)
      const surplus = Money.fromDecimal("18000000.00");
      const result = optimizeAllocation(surplus, sampleInstruments, {
        horizonHours: 720,
      });

      const allocMap = new Map(result.allocations.map((a) => [a.instrument.id, a]));

      // i3 has highest net yield -> gets filled to capacity ($10M)
      expect(allocMap.get("i3")!.allocated.toDecimal()).toBe(10000000);
      expect(allocMap.get("i3")!.utilization).toBe(1.0);

      // Remaining $8M goes to i2 (second highest)
      expect(allocMap.get("i2")!.allocated.toDecimal()).toBe(8000000);
      expect(allocMap.get("i2")!.utilization).toBeCloseTo(8 / 15, 4);

      // i1 gets $0 because $18M was exhausted
      expect(allocMap.get("i1")!.allocated.toDecimal()).toBe(0);
      expect(allocMap.get("i1")!.utilization).toBe(0);

      // Zero unallocated
      expect(result.unallocatedSurplus.toDecimal()).toBe(0);
      expect(result.totalAllocated.equals(surplus)).toBe(true);
    });

    it("refuses to deploy into instruments where penalties dominate short horizon", () => {
      const penalizedInstruments: Instrument[] = [
        {
          id: "no-penalty",
          name: "Daily Sweep",
          apy: 350, // 3.50%
          capacity: Money.fromDecimal("10000000.00"),
          withdrawalPenalty: 0,
        },
        {
          id: "heavy-penalty",
          name: "High Rate Term",
          apy: 600, // 6.00%
          capacity: Money.fromDecimal("10000000.00"),
          withdrawalPenalty: 100, // 100 bps = 1.0%
          earlyWithdrawalRisk: 0.5, // 50% chance of emergency liquidation -> expected penalty = 0.5%
        },
      ];

      // Over H = 2 hours:
      // heavy-penalty yield = 6% * 2 / 8760 = 0.00137% << 0.5% penalty -> net value is NEGATIVE
      // It should NOT be allocated any funds!
      const surplus = Money.fromDecimal("15000000.00");
      const result = optimizeAllocation(surplus, penalizedInstruments, {
        horizonHours: 2,
      });

      const noPen = result.allocations.find((a) => a.instrument.id === "no-penalty")!;
      const heavyPen = result.allocations.find((a) => a.instrument.id === "heavy-penalty")!;

      expect(noPen.allocated.toDecimal()).toBe(10000000); // Allocated to capacity
      expect(heavyPen.allocated.toDecimal()).toBe(0); // Zero deployment due to negative net yield
      expect(heavyPen.isEconomicallyViable).toBe(false);
      expect(result.unallocatedSurplus.toDecimal()).toBe(5000000);
    });
  });

  describe("Strict Sum Conservation & Financial Invariants", () => {
    it("conserves pennies exactly across uneven allocations without floating-point drift", () => {
      // Uneven surplus with cents
      const oddSurplus = Money.fromDecimal("34567890.73");
      const result = optimizeAllocation(oddSurplus, sampleInstruments, {
        horizonHours: 168,
      });

      // INVARIANT 1: totalAllocated + unallocatedSurplus === totalSurplus down to the cent
      const reconciled = result.totalAllocated.add(result.unallocatedSurplus);
      expect(reconciled.equals(oddSurplus)).toBe(true);
      expect(reconciled.amountMinor).toBe(3456789073n);

      // INVARIANT 2: sum of individual allocations === totalAllocated
      const sumAllocated = Money.sum(result.allocations.map((a) => a.allocated));
      expect(sumAllocated.equals(result.totalAllocated)).toBe(true);

      // INVARIANT 3: expectedNetYield === expectedGrossYield - expectedPenalties
      const netCheck = result.expectedGrossYield.subtract(result.expectedPenalties);
      expect(result.expectedNetYield.equals(netCheck)).toBe(true);

      // Effective APY is positive and reasonable
      expect(result.effectiveNetApyBps).toBeGreaterThan(400);
      expect(result.effectiveNetApyBps).toBeLessThan(600);
    });

    it("throws error for negative surplus or invalid horizon", () => {
      const negativeSurplus = Money.fromDecimal("-500.00");
      expect(() =>
        optimizeAllocation(negativeSurplus, sampleInstruments)
      ).toThrow();

      expect(() =>
        optimizeAllocation(Money.fromDecimal("1000.00"), sampleInstruments, {
          horizonHours: -1,
        })
      ).toThrow(/horizonHours/);
    });
  });

  describe("Optimizer Class Interface", () => {
    it("instantiates Optimizer with options and executes allocations", () => {
      const optimizer = new Optimizer({
        defaultHorizonHours: 168,
        defaultEarlyWithdrawalRisk: 0.005,
      });

      expect(optimizer.defaultHorizonHours).toBe(168);

      const surplus = Money.fromDecimal("25000000.00");
      const result = optimizer.allocate(surplus, sampleInstruments);

      expect(result.totalAllocated.toDecimal()).toBe(25000000);
      expect(result.unallocatedSurplus.toDecimal()).toBe(0);
      expect(result.expectedNetYield.isPositive()).toBe(true);
    });
  });
});
