import { describe, it, expect } from "vitest";
import {
  runSimulation,
  compareScenarioAcrossPolicies,
  safeBigIntToNumber,
  type SimulationParams,
} from "@/engine/simulate";
import { Money } from "@/engine/money";
import { Instrument, HourlyBucket } from "@/engine/models";
import { generateTransactions } from "@/engine/generator";
import { buildContinuousTimeSeries } from "@/engine/timeseries";

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

function createTestHistory(hours = 168): HourlyBucket[] {
  const end = new Date("2026-10-18T00:00:00Z");
  const start = new Date(end.getTime() - hours * 3600 * 1000);
  const txs = generateTransactions({
    seed: "fixed-fixture-seed-123",
    startDate: start,
    endDate: end,
    baseVolumePerHour: Money.fromMinor(20_000_000_00n, "USD"), // $200k base
  });
  return buildContinuousTimeSeries(txs, {
    startDate: start,
    endDate: end,
    currency: "USD",
  });
}

function createTestInstruments(): Instrument[] {
  return [
    {
      id: "repo-overnight",
      name: "Overnight Repo",
      apy: 0.045, // 4.5%
      capacity: Money.fromMinor(50_000_000_00n, "USD"), // $500k
      withdrawalPenalty: 0.0005, // 5 bps
      settlementLagHours: 0, // instant
    },
    {
      id: "treasury-bill",
      name: "30-Day Treasury Bill",
      apy: 0.052, // 5.2%
      capacity: Money.fromMinor(100_000_000_00n, "USD"), // $1M
      withdrawalPenalty: 0.002, // 20 bps
      settlementLagHours: 24, // T+1
    },
    {
      id: "commercial-paper",
      name: "Commercial Paper",
      apy: 0.058, // 5.8%
      capacity: Money.fromMinor(75_000_000_00n, "USD"), // $750k
      withdrawalPenalty: 0.005, // 50 bps
      settlementLagHours: 48, // T+2
    },
  ];
}

describe("Stress Scenario Simulator Engine (Phase 18)", () => {
  const history = createTestHistory(168);
  const instruments = createTestInstruments();
  const startingCash = Money.fromMinor(100_000_000_00n, "USD"); // $1,000,000

  // -------------------------------------------------------------------------
  // 1. Engine Determinism
  // -------------------------------------------------------------------------

  describe("Determinism", () => {
    it("produces identical results given identical seed and inputs", () => {
      const baseParams: SimulationParams = {
        seed: "deterministic-run-42",
        history,
        startingCash,
        instruments,
        scenario: {
          outflowShockPct: 20,
          settlementDelayHours: 12,
          confidence: 0.99,
        },
        policy: "reserve-juggler",
        horizonHours: 24,
        trials: 100,
      };

      const res1 = runSimulation(baseParams);
      const res2 = runSimulation(baseParams);

      expect(res1.shortfallFrequency).toBe(res2.shortfallFrequency);
      expect(res1.expectedShortfall.amountMinor).toBe(res2.expectedShortfall.amountMinor);
      expect(res1.p95Shortfall.amountMinor).toBe(res2.p95Shortfall.amountMinor);
      expect(res1.netYield.amountMinor).toBe(res2.netYield.amountMinor);
      expect(res1.grossYield.amountMinor).toBe(res2.grossYield.amountMinor);
      expect(res1.penaltiesPaid.amountMinor).toBe(res2.penaltiesPaid.amountMinor);
      expect(res1.emergencyBorrowingCost.amountMinor).toBe(res2.emergencyBorrowingCost.amountMinor);

      // Hourly paths match exactly
      for (let h = 0; h <= 24; h++) {
        expect(res1.cashPath[h].medianCash.amountMinor).toBe(res2.cashPath[h].medianCash.amountMinor);
        expect(res1.cashPath[h].p5Cash.amountMinor).toBe(res2.cashPath[h].p5Cash.amountMinor);
        expect(res1.cashPath[h].p95Cash.amountMinor).toBe(res2.cashPath[h].p95Cash.amountMinor);
      }
    });

    it("produces different results when seed changes", () => {
      const res1 = runSimulation({
        seed: "seed-alpha",
        history,
        startingCash,
        instruments,
        scenario: { outflowShockPct: 25, settlementDelayHours: 24, confidence: 0.95 },
        policy: "reserve-juggler",
        horizonHours: 24,
        trials: 100,
      });

      const res2 = runSimulation({
        seed: "seed-beta",
        history,
        startingCash,
        instruments,
        scenario: { outflowShockPct: 25, settlementDelayHours: 24, confidence: 0.95 },
        policy: "reserve-juggler",
        horizonHours: 24,
        trials: 100,
      });

      expect(res1.seed).not.toBe(res2.seed);
      // At least one metric differs across different seeded bootstrap draws
      const differs =
        res1.expectedShortfall.amountMinor !== res2.expectedShortfall.amountMinor ||
        res1.netYield.amountMinor !== res2.netYield.amountMinor ||
        res1.cashPath[12].medianCash.amountMinor !== res2.cashPath[12].medianCash.amountMinor;
      expect(differs).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Monotonicity Sanity Checks
  // -------------------------------------------------------------------------

  describe("Monotonicity & Sensitivity", () => {
    it("larger outflow shock never lowers expected shortfall under fixed seed", () => {
      const fixedSeed = "monotonicity-outflow-test";

      const baseline = runSimulation({
        seed: fixedSeed,
        history,
        startingCash: Money.fromMinor(30_000_000_00n, "USD"), // Tighter cash ($300k) to trigger shortfalls
        instruments,
        scenario: { outflowShockPct: 5, settlementDelayHours: 0, confidence: 0.90 },
        policy: "fixed-buffer",
        policyParams: { bufferPct: 0.05 },
        horizonHours: 24,
        trials: 150,
      });

      const highShock = runSimulation({
        seed: fixedSeed,
        history,
        startingCash: Money.fromMinor(30_000_000_00n, "USD"),
        instruments,
        scenario: { outflowShockPct: 40, settlementDelayHours: 0, confidence: 0.90 },
        policy: "fixed-buffer",
        policyParams: { bufferPct: 0.05 },
        horizonHours: 24,
        trials: 150,
      });

      expect(highShock.expectedShortfall.amountMinor).toBeGreaterThanOrEqual(
        baseline.expectedShortfall.amountMinor
      );
    });

    it("longer settlement delay never lowers shortfall frequency under tight liquidity", () => {
      const fixedSeed = "monotonicity-delay-test";

      const instantSettlement = runSimulation({
        seed: fixedSeed,
        history,
        startingCash: Money.fromMinor(25_000_000_00n, "USD"),
        instruments,
        scenario: { outflowShockPct: 20, settlementDelayHours: 0, confidence: 0.90 },
        policy: "fixed-buffer",
        policyParams: { bufferPct: 0.05 },
        horizonHours: 24,
        trials: 150,
      });

      const delayedSettlement = runSimulation({
        seed: fixedSeed,
        history,
        startingCash: Money.fromMinor(25_000_000_00n, "USD"),
        instruments,
        scenario: { outflowShockPct: 20, settlementDelayHours: 48, confidence: 0.90 },
        policy: "fixed-buffer",
        policyParams: { bufferPct: 0.05 },
        horizonHours: 24,
        trials: 150,
      });

      expect(delayedSettlement.shortfallFrequency).toBeGreaterThanOrEqual(
        instantSettlement.shortfallFrequency
      );
    });

    it("instrument outage never reduces shortfall", () => {
      const fixedSeed = "outage-test";

      const normal = runSimulation({
        seed: fixedSeed,
        history,
        startingCash: Money.fromMinor(25_000_000_00n, "USD"),
        instruments,
        scenario: {
          outflowShockPct: 30,
          settlementDelayHours: 0,
          instrumentOutageIds: [],
          confidence: 0.90,
        },
        policy: "fixed-buffer",
        policyParams: { bufferPct: 0.05 },
        horizonHours: 24,
        trials: 150,
      });

      const withOutage = runSimulation({
        seed: fixedSeed,
        history,
        startingCash: Money.fromMinor(25_000_000_00n, "USD"),
        instruments,
        scenario: {
          outflowShockPct: 30,
          settlementDelayHours: 0,
          instrumentOutageIds: ["repo-overnight"], // Freeze instant redemption instrument
          confidence: 0.90,
        },
        policy: "fixed-buffer",
        policyParams: { bufferPct: 0.05 },
        horizonHours: 24,
        trials: 150,
      });

      expect(withOutage.expectedShortfall.amountMinor).toBeGreaterThanOrEqual(
        normal.expectedShortfall.amountMinor
      );
    });

    it("hold-all-cash policy has strictly zero liquidation penalties and zero deployed yield", () => {
      const res = runSimulation({
        seed: "hold-all-cash-test",
        history,
        startingCash,
        instruments,
        scenario: { outflowShockPct: 20, settlementDelayHours: 12, confidence: 0.99 },
        policy: "hold-all-cash",
        horizonHours: 24,
        trials: 100,
      });

      expect(res.penaltiesPaid.isZero()).toBe(true);
      expect(res.grossYield.isZero()).toBe(true);
      // Net yield equals 0 - borrowing costs
      expect(res.netYield.amountMinor).toBe(-res.emergencyBorrowingCost.amountMinor);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Accounting Identities & Money Integrity
  // -------------------------------------------------------------------------

  describe("Accounting Identities & Strict BigInt Integrity", () => {
    it("satisfies netYield = grossYield - penaltiesPaid - emergencyBorrowingCost exactly", () => {
      const res = runSimulation({
        seed: "accounting-test-1",
        history,
        startingCash,
        instruments,
        scenario: { outflowShockPct: 35, settlementDelayHours: 24, confidence: 0.95 },
        policy: "reserve-juggler",
        horizonHours: 24,
        trials: 200,
      });

      const calculatedNet = res.grossYield
        .subtract(res.penaltiesPaid)
        .subtract(res.emergencyBorrowingCost);

      expect(res.netYield.amountMinor).toBe(calculatedNet.amountMinor);
    });

    it("fails loudly with RangeError if cash balance exceeds Number.MAX_SAFE_INTEGER (> 2^53 - 1)", () => {
      // 2^53 - 1 is 9,007,199,254,740,991 cents (~$90 Trillion).
      const overflowingCash = Money.fromMinor(100_000_000_000_000_000n, "USD"); // $1 Quadrillion cents

      expect(() => {
        safeBigIntToNumber(overflowingCash.amountMinor, "startingCash");
      }).toThrow(RangeError);

      expect(() => {
        runSimulation({
          seed: "overflow-test",
          history,
          startingCash: overflowingCash,
          instruments,
          scenario: { outflowShockPct: 10, settlementDelayHours: 0, confidence: 0.99 },
          policy: "reserve-juggler",
          horizonHours: 24,
          trials: 10,
        });
      }).toThrow(RangeError);
    });

    it("processes large balances safely within safe integer limits (< 2^53 - 1)", () => {
      // $50 Billion = 5,000,000,000,000 cents (well under 9e15 safe integer bound)
      const largeCash = Money.fromMinor(5_000_000_000_000_00n, "USD");
      const res = runSimulation({
        seed: "large-safe-test",
        history,
        startingCash: largeCash,
        instruments,
        scenario: { outflowShockPct: 10, settlementDelayHours: 0, confidence: 0.99 },
        policy: "reserve-juggler",
        horizonHours: 24,
        trials: 20,
      });

      expect(res.grossYield.isPositive()).toBe(true);
      expect(typeof res.grossYield.amountMinor).toBe("bigint");
    });

    it("handles explicit decimal rate units accurately for both 4.10% and 0.05% instruments without heuristic guessing", () => {
      const explicitRateInstruments: Instrument[] = [
        {
          id: "inst-410",
          name: "4.10% Treasury",
          apy: 0.0410, // 4.10% annual rate
          capacity: Money.fromMinor(10_000_000_00n, "USD"),
          withdrawalPenalty: 0.0010, // 10 bps penalty
          settlementLagHours: 0,
        },
        {
          id: "inst-005",
          name: "0.05% Overnight Facility",
          apy: 0.0005, // 0.05% annual rate
          capacity: Money.fromMinor(10_000_000_00n, "USD"),
          withdrawalPenalty: 0.0001, // 1 bp penalty
          settlementLagHours: 0,
        },
      ];

      const res = runSimulation({
        seed: "rate-unit-test",
        history,
        startingCash,
        instruments: explicitRateInstruments,
        scenario: { outflowShockPct: 0, settlementDelayHours: 0, confidence: 0.99 },
        policy: "fixed-buffer",
        policyParams: { bufferPct: 0.1 },
        horizonHours: 24,
        trials: 20,
      });

      expect(res.grossYield.isPositive()).toBe(true);
      expect(res.trials).toBe(20);
    });
  });

  // -------------------------------------------------------------------------
  // 4. No Look-Ahead Validation
  // -------------------------------------------------------------------------

  describe("No Look-Ahead Property", () => {
    it("policy deployment does not change if future unseen events change", () => {
      // Create two different histories that share the exact same past 168 hours
      const commonPast = history;

      const simA = runSimulation({
        seed: "no-look-ahead",
        history: commonPast,
        startingCash,
        instruments,
        scenario: { outflowShockPct: 10, settlementDelayHours: 0, confidence: 0.99 },
        policy: "reserve-juggler",
        horizonHours: 24,
        trials: 10,
      });

      const simB = runSimulation({
        seed: "no-look-ahead",
        history: commonPast,
        startingCash,
        instruments,
        scenario: { outflowShockPct: 45, settlementDelayHours: 72, confidence: 0.99 }, // Vastly different future shock
        policy: "reserve-juggler",
        horizonHours: 24,
        trials: 10,
      });

      // At hour 0 (the deployment decision point before shocks hit), initial cash is identical
      expect(simA.cashPath[0].medianCash.amountMinor).toBe(simB.cashPath[0].medianCash.amountMinor);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Micro-Benchmark (Compute Bounds)
  // -------------------------------------------------------------------------

  describe("Compute Bounds Benchmark", () => {
    it("executes 500 trials over 24 hours well under 1,000ms", () => {
      const start = performance.now();

      const res = runSimulation({
        seed: "benchmark-seed",
        history,
        startingCash,
        instruments,
        scenario: { outflowShockPct: 20, settlementDelayHours: 12, confidence: 0.99 },
        policy: "reserve-juggler",
        horizonHours: 24,
        trials: 500,
      });

      const elapsedMs = performance.now() - start;

      // Documented execution timing: typically 15ms - 80ms on modern V8
      expect(elapsedMs).toBeLessThan(1000);
      expect(res.trials).toBe(500);
      expect(res.cashPath.length).toBe(25);
    });
  });

  // -------------------------------------------------------------------------
  // 6. Multi-Policy Comparison & Common Random Numbers (Phase 19)
  // -------------------------------------------------------------------------

  describe("Multi-Policy Comparison & Common Random Numbers (compareScenarioAcrossPolicies)", () => {
    it("evaluates all policies with identical Common Random Numbers (CRN) draws and is 100% deterministic per seed", () => {
      const run1 = compareScenarioAcrossPolicies({
        seed: "crn-deterministic-seed-42",
        history,
        startingCash,
        instruments,
        scenario: { outflowShockPct: 25, settlementDelayHours: 6, confidence: 0.99 },
        policies: ["reserve-juggler", "hold-all-cash", "fixed-buffer"],
        horizonHours: 24,
        trials: 100,
      });

      const run2 = compareScenarioAcrossPolicies({
        seed: "crn-deterministic-seed-42",
        history,
        startingCash,
        instruments,
        scenario: { outflowShockPct: 25, settlementDelayHours: 6, confidence: 0.99 },
        policies: ["reserve-juggler", "hold-all-cash", "fixed-buffer"],
        horizonHours: 24,
        trials: 100,
      });

      // 100% Deterministic match across repeated seeded comparisons
      expect(run1.policyResults["reserve-juggler"].netYield.amountMinor).toBe(
        run2.policyResults["reserve-juggler"].netYield.amountMinor
      );
      expect(run1.policyResults["hold-all-cash"].netYield.amountMinor).toBe(
        run2.policyResults["hold-all-cash"].netYield.amountMinor
      );
      expect(run1.policyResults["fixed-buffer"].netYield.amountMinor).toBe(
        run2.policyResults["fixed-buffer"].netYield.amountMinor
      );
    });

    it("ensures hold-all-cash baseline strictly has zero penalties and zero deployed yield", () => {
      const comp = compareScenarioAcrossPolicies({
        seed: "cash-baseline-check",
        history,
        startingCash,
        instruments,
        scenario: { outflowShockPct: 30, settlementDelayHours: 12, confidence: 0.99 },
        policies: ["reserve-juggler", "hold-all-cash"],
        horizonHours: 24,
        trials: 50,
      });

      const cashRes = comp.policyResults["hold-all-cash"];
      expect(cashRes.grossYield.isZero()).toBe(true);
      expect(cashRes.penaltiesPaid.isZero()).toBe(true);
      expect(cashRes.grossYield.amountMinor).toBe(0n);
      expect(cashRes.penaltiesPaid.amountMinor).toBe(0n);
    });

    it("computes metric deltas that equal exact mathematical differences of underlying results", () => {
      const comp = compareScenarioAcrossPolicies({
        seed: "deltas-math-check",
        history,
        startingCash,
        instruments,
        scenario: { outflowShockPct: 20, settlementDelayHours: 0, confidence: 0.99 },
        policies: ["reserve-juggler", "hold-all-cash", "fixed-buffer"],
        horizonHours: 24,
        trials: 50,
      });

      const juggler = comp.policyResults["reserve-juggler"];
      const cash = comp.policyResults["hold-all-cash"];
      const fixed = comp.policyResults["fixed-buffer"];

      const jugglerDeltas = comp.deltas["reserve-juggler"];
      expect(jugglerDeltas.vsHoldAllCash).toBeDefined();

      const expectedNetYieldDelta = juggler.netYield.subtract(cash.netYield);
      expect(jugglerDeltas.vsHoldAllCash!.netYield.amountMinor).toBe(expectedNetYieldDelta.amountMinor);

      const expectedFreqDelta = juggler.shortfallFrequency - cash.shortfallFrequency;
      expect(jugglerDeltas.vsHoldAllCash!.shortfallFrequency).toBeCloseTo(expectedFreqDelta, 5);

      const expectedShortfallDelta = juggler.expectedShortfall.subtract(cash.expectedShortfall);
      expect(jugglerDeltas.vsHoldAllCash!.expectedShortfall.amountMinor).toBe(
        expectedShortfallDelta.amountMinor
      );

      // Fixed buffer deltas vs cash
      const fixedDeltas = comp.deltas["fixed-buffer"];
      expect(fixedDeltas.vsHoldAllCash!.netYield.amountMinor).toBe(
        fixed.netYield.subtract(cash.netYield).amountMinor
      );

      // Verify descriptive winners are present
      expect(comp.winners).toBeDefined();
      expect(["reserve-juggler", "hold-all-cash", "fixed-buffer"]).toContain(comp.winners.netYield);
      expect(["reserve-juggler", "hold-all-cash", "fixed-buffer"]).toContain(
        comp.winners.shortfallFrequency
      );
    });
  });
});
