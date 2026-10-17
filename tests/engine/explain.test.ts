import { describe, it, expect } from "vitest";
import { explainDecision, type StoredDecisionInput } from "@/engine/explain";

describe("Deterministic Decision Explanation Engine (explainDecision)", () => {
  it("formats HEALTHY decision with step-by-step numbers and funded instruments", () => {
    const input: StoredDecisionInput = {
      id: "dec-healthy-1",
      status: "HEALTHY",
      confidence: 0.95,
      alpha: 0.05,
      horizonHours: 24,
      reserveMinor: "500000000", // $5,000,000.00
      surplusMinor: "200000000", // $2,000,000.00
      availableCashMinor: "700000000", // $7,000,000.00
      operationalFloorMinor: "200000000", // $2,000,000.00
      stressAddOnMinor: "0",
      expectedCumulativeFlowMinor: "-100000000", // -$1,000,000.00
      worstCaseResidualShortfallMinor: "-200000000", // -$2,000,000.00
      backtest: {
        mase: 0.85,
        sampleSize: 120,
      },
      allocations: [
        {
          instrumentId: "overnight-repo",
          name: "Overnight Repo",
          amountMinor: "200000000",
          annualRateBps: 520,
          penaltyBps: 0,
          capacityMinor: "500000000",
        },
      ],
    };

    const res = explainDecision(input);

    expect(res.decisionId).toBe("dec-healthy-1");
    expect(res.status).toBe("HEALTHY");
    expect(res.statusTriggerRule).toContain("Available cash C ($7,000,000.00) >= required reserve R ($5,000,000.00)");
    expect(res.steps).toHaveLength(7);

    // Verify step symbols and values
    const muStep = res.steps.find((s) => s.symbol === "μ")!;
    expect(muStep.valueFormatted).toBe("-$1,000,000.00");
    expect(muStep.recorded).toBe(true);

    const qStep = res.steps.find((s) => s.symbol === "q")!;
    expect(qStep.valueFormatted).toBe("-$2,000,000.00");

    const floorStep = res.steps.find((s) => s.symbol === "F")!;
    expect(floorStep.valueFormatted).toBe("$2,000,000.00");

    const rStep = res.steps.find((s) => s.symbol === "R")!;
    expect(rStep.valueFormatted).toBe("$5,000,000.00");

    const cashStep = res.steps.find((s) => s.symbol === "C")!;
    expect(cashStep.valueFormatted).toBe("$7,000,000.00");

    // Instrument explanation
    expect(res.instruments).toHaveLength(1);
    const repo = res.instruments[0];
    expect(repo.funded).toBe(true);
    expect(repo.fundingReason).toContain("Funded");
    expect(repo.allocatedFormatted).toBe("$2,000,000.00");
  });

  it("identifies UNDER_RESERVED state and exact trigger rule", () => {
    const input: StoredDecisionInput = {
      id: "dec-under-1",
      status: "UNDER_RESERVED",
      confidence: 0.95,
      reserveMinor: "800000000", // $8,000,000.00
      surplusMinor: "0",
      availableCashMinor: "300000000", // $3,000,000.00
      operationalFloorMinor: "200000000",
      allocations: [
        {
          instrumentId: "tbill-30d",
          amountMinor: "0",
          annualRateBps: 450,
          penaltyBps: 25,
        },
      ],
    };

    const res = explainDecision(input);

    expect(res.status).toBe("UNDER_RESERVED");
    expect(res.statusTriggerRule).toContain("strictly less than required reserve R");
    expect(res.statusTriggerRule).toContain("Rule: C < R");

    // Instrument should be unfunded due to under-reserved state
    expect(res.instruments[0].funded).toBe(false);
    expect(res.instruments[0].fundingReason).toContain("Bank is UNDER_RESERVED");
  });

  it("identifies LOW_CONFIDENCE state and exact triggering rule", () => {
    const input: StoredDecisionInput = {
      id: "dec-low-conf-1",
      status: "LOW_CONFIDENCE",
      reserveMinor: "300000000",
      surplusMinor: "0",
      availableCashMinor: "500000000",
      backtest: {
        mase: 1.45, // > 1.20
        sampleSize: 18, // < 30
      },
      allocations: [],
    };

    const res = explainDecision(input);

    expect(res.status).toBe("LOW_CONFIDENCE");
    expect(res.statusTriggerRule).toContain("sample size N (18) < 30");
    expect(res.statusTriggerRule).toContain("model MASE (1.45) > 1.20");
    expect(res.statusTriggerRule).toContain("Rule: N < 30 or MASE > 1.20");
  });

  it("reports unrecorded fields as 'not recorded' without inventing numbers", () => {
    // Only bare minimum fields stored
    const input: StoredDecisionInput = {
      id: "dec-sparse-1",
      status: "HEALTHY",
      reserveMinor: "100000000",
      surplusMinor: "50000000",
    };

    const res = explainDecision(input);

    const muStep = res.steps.find((s) => s.symbol === "μ")!;
    expect(muStep.recorded).toBe(false);
    expect(muStep.valueFormatted).toBe("not recorded");
    expect(muStep.description).toContain("was not recorded");

    const qStep = res.steps.find((s) => s.symbol === "q")!;
    expect(qStep.recorded).toBe(false);
    expect(qStep.valueFormatted).toBe("not recorded");

    const floorStep = res.steps.find((s) => s.symbol === "F")!;
    expect(floorStep.recorded).toBe(false);
    expect(floorStep.valueFormatted).toBe("not recorded");

    const cashStep = res.steps.find((s) => s.symbol === "C")!;
    expect(cashStep.recorded).toBe(false);
    expect(cashStep.valueFormatted).toBe("not recorded");
  });

  it("explains unfunded instruments due to non-positive net unit value (v_i <= 0)", () => {
    const input: StoredDecisionInput = {
      id: "dec-healthy-2",
      status: "HEALTHY",
      reserveMinor: "100000000",
      surplusMinor: "50000000",
      allocations: [
        {
          instrumentId: "high-penalty-deposit",
          name: "High Penalty Deposit",
          amountMinor: "0",
          annualRateBps: 200, // 2% APY = 0.02 * (24/8760) = ~0.000054
          penaltyBps: 500, // 5% penalty
          earlyWithdrawalRisk: 0.1, // 0.1 * 0.05 = 0.005 >> 0.000054 -> v_i < 0!
        },
      ],
    };

    const res = explainDecision(input);
    const inst = res.instruments[0];
    expect(inst.funded).toBe(false);
    expect(inst.netUnitValue).toBeLessThan(0);
    expect(inst.fundingReason).toContain("Non-positive net unit value");
  });

  it("handles BigInt values above 2^53 without precision loss", () => {
    // 2^53 is ~9.007e15 minor units ($90 trillion)
    // Use $100 trillion (10,000,000,000,000,000 minor units)
    const bigMinor = "10000000000000000000"; // > 2^53
    const input: StoredDecisionInput = {
      id: "dec-huge-1",
      status: "HEALTHY",
      reserveMinor: bigMinor,
      surplusMinor: bigMinor,
      availableCashMinor: bigMinor,
      operationalFloorMinor: bigMinor,
    };

    const res = explainDecision(input);
    const rStep = res.steps.find((s) => s.symbol === "R")!;
    expect(rStep.valueMinor).toBe(bigMinor);
    expect(rStep.valueFormatted).toContain("$");
  });
});
