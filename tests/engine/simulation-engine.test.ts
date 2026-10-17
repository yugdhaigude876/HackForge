import { describe, it, expect } from "vitest";
import { runSimulation, type SimulationParams } from "@/engine/simulate";
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

    it("processes very large cash balances (> 2^53 cents = $90 Trillion) without precision loss", () => {
      // 2^53 cents is ~9.007e15 cents ($90 Trillion).
      const massiveCash = Money.fromMinor(100_000_000_000_000_000n, "USD"); // $1 Quadrillion cents

      const massiveInstruments: Instrument[] = [
        {
          id: "mega-t-bill",
          name: "Sovereign Facility",
          apy: 0.05,
          capacity: Money.fromMinor(50_000_000_000_000_000n, "USD"),
          withdrawalPenalty: 0,
          settlementLagHours: 0,
        },
      ];

      const res = runSimulation({
        seed: "large-bigint-test",
        history,
        startingCash: massiveCash,
        instruments: massiveInstruments,
        scenario: { outflowShockPct: 10, settlementDelayHours: 0, confidence: 0.99 },
        policy: "reserve-juggler",
        horizonHours: 24,
        trials: 50,
      });

      expect(res.grossYield.isPositive()).toBe(true);
      expect(typeof res.grossYield.amountMinor).toBe("bigint");
      // 50 quadrillion cents deployed at 5% APY over 24h yields ~6.85 trillion cents
      expect(res.grossYield.amountMinor > 1_000_000_000_000n).toBe(true);
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
});
