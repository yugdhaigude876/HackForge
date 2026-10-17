/**
 * Reserve Juggler - API Route Handlers Integration Test Suite
 *
 * Verifies end-to-end request parsing, Zod validation, HTTP status codes (200, 400),
 * Money serialization through the Next.js NextResponse boundary, and core engine orchestration:
 * - POST /api/engine/generate
 * - POST /api/engine/forecast
 * - POST /api/engine/decision
 */

import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { POST as generateHandler } from "@/app/api/engine/generate/route";
import { POST as forecastHandler } from "@/app/api/engine/forecast/route";
import { POST as decisionHandler } from "@/app/api/engine/decision/route";

function createJsonRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("API Route: POST /api/engine/generate", () => {
  const BASE_URL = "http://localhost:3000/api/engine/generate";

  it("returns 200 and generates transactions with deterministic seed and date range", async () => {
    const req = createJsonRequest(BASE_URL, {
      seed: "hackathon-unit-test-1",
      startDate: "2026-03-01T00:00:00Z",
      endDate: "2026-03-01T03:00:00Z",
      transactionsPerHour: 10,
    });

    const res = await generateHandler(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.count).toBeGreaterThan(0);
    expect(json.transactions).toHaveLength(json.count);
    expect(json.timespan.startDate).toBe("2026-03-01T00:00:00.000Z");
    expect(json.timespan.endDate).toBe("2026-03-01T03:00:00.000Z");

    // Verify Money serialization conforms to DATA_MODEL.md
    const firstTx = json.transactions[0];
    expect(firstTx).toHaveProperty("id");
    expect(firstTx).toHaveProperty("type");
    expect(firstTx).toHaveProperty("amount");
    expect(typeof firstTx.amount.amountMinor).toMatch(/^(number|string)$/);
    expect(firstTx.amount.currency).toBe("USD");
  });

  it("guarantees 100% seeded reproducibility across consecutive calls", async () => {
    const payload = {
      seed: "deterministic-seed-xyz",
      startDate: "2026-03-01T00:00:00Z",
      endDate: "2026-03-01T02:00:00Z",
    };

    const res1 = await generateHandler(createJsonRequest(BASE_URL, payload));
    const json1 = await res1.json();

    const res2 = await generateHandler(createJsonRequest(BASE_URL, payload));
    const json2 = await res2.json();

    expect(json1.count).toBe(json2.count);
    expect(json1.transactions).toEqual(json2.transactions);
  });

  it("returns 400 with structured Zod errors when seed is missing", async () => {
    const req = createJsonRequest(BASE_URL, {
      startDate: "2026-03-01T00:00:00Z",
      endDate: "2026-03-01T02:00:00Z",
    });

    const res = await generateHandler(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toBe("Validation Error");
    expect(json.details).toBeInstanceOf(Array);
    expect(json.details.some((d: { path?: string[] }) => d.path?.includes("seed"))).toBe(true);
  });

  it("returns 400 when startDate is after endDate", async () => {
    const req = createJsonRequest(BASE_URL, {
      seed: "test-seed",
      startDate: "2026-03-02T00:00:00Z",
      endDate: "2026-03-01T00:00:00Z",
    });

    const res = await generateHandler(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toBe("Validation Error");
    expect(json.details[0].message).toContain("startDate must be before or equal to endDate");
  });

  it("returns 400 on invalid JSON syntax in request body", async () => {
    const req = new NextRequest(BASE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ not-a-valid-json ",
    });

    const res = await generateHandler(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toBe("Invalid JSON in request body");
  });
});

describe("API Route: POST /api/engine/forecast", () => {
  const BASE_URL = "http://localhost:3000/api/engine/forecast";

  it("returns 200 with Hour-of-Week EWMA smoothing forecast and rolling backtest", async () => {
    const req = createJsonRequest(BASE_URL, {
      method: "hour_of_week",
      horizonHours: 12,
      lookbackHours: 168,
      stepHours: 24,
      startDate: "2026-02-01T00:00:00Z",
      endDate: "2026-02-21T00:00:00Z",
      lambda: 0.3,
    });

    const res = await forecastHandler(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.method).toBe("hour_of_week");
    expect(json.horizonHours).toBe(12);
    expect(json.predictions).toHaveLength(12);

    // Verify Money serialization on predictions
    const firstPred = json.predictions[0];
    expect(typeof firstPred.amountMinor).toMatch(/^(number|string)$/);
    expect(firstPred.currency).toBe("USD");

    // Verify backtest metrics
    expect(json.backtest).toBeDefined();
    expect(json.backtest.windowCount).toBeGreaterThan(0);
    expect(typeof json.backtest.metrics.maeDollars).toBe("number");
    expect(typeof json.backtest.metrics.mase).toBe("number");
    expect(typeof json.backtest.metrics.pinballLoss95).toBe("number");
  });

  it("supports naive and seasonal_naive forecasters", async () => {
    const reqNaive = createJsonRequest(BASE_URL, {
      method: "naive",
      horizonHours: 6,
      startDate: "2026-02-01T00:00:00Z",
      endDate: "2026-02-15T00:00:00Z",
    });

    const resNaive = await forecastHandler(reqNaive);
    expect(resNaive.status).toBe(200);
    const jsonNaive = await resNaive.json();
    expect(jsonNaive.method).toBe("naive");
    expect(jsonNaive.predictions).toHaveLength(6);

    const reqSeasonal = createJsonRequest(BASE_URL, {
      method: "seasonal_naive",
      horizonHours: 6,
      seasonalLag: 168,
      startDate: "2026-02-01T00:00:00Z",
      endDate: "2026-02-21T00:00:00Z",
    });

    const resSeasonal = await forecastHandler(reqSeasonal);
    expect(resSeasonal.status).toBe(200);
    const jsonSeasonal = await resSeasonal.json();
    expect(jsonSeasonal.method).toBe("seasonal_naive");
    expect(jsonSeasonal.predictions).toHaveLength(6);
  });

  it("returns 400 for unknown forecasting method", async () => {
    const req = createJsonRequest(BASE_URL, {
      method: "deep_neural_transformer",
    });

    const res = await forecastHandler(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toBe("Validation Error");
    expect(json.details.some((d: { path?: string[] }) => d.path?.includes("method"))).toBe(true);
  });

  it("returns 400 for invalid horizon (e.g. horizon > 720)", async () => {
    const req = createJsonRequest(BASE_URL, {
      horizonHours: 1000,
    });

    const res = await forecastHandler(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toBe("Validation Error");
    expect(json.details.some((d: { path?: string[] }) => d.path?.includes("horizonHours"))).toBe(true);
  });

  it("returns 400 when start date is after end date", async () => {
    const req = createJsonRequest(BASE_URL, {
      startDate: "2026-03-10T00:00:00Z",
      endDate: "2026-03-01T00:00:00Z",
    });

    const res = await forecastHandler(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toBe("Validation Error");
  });
});

describe("API Route: POST /api/engine/decision", () => {
  const BASE_URL = "http://localhost:3000/api/engine/decision";

  const sampleInstruments = [
    {
      id: "treasury-repo",
      name: "Overnight Treasury Repo",
      apy: 0.052,
      capacity: 50_000_000,
      withdrawalPenalty: 0.0005,
      settlementLagHours: 0,
    },
    {
      id: "short-term-cd",
      name: "7-Day Commercial Paper",
      apy: 0.056,
      capacity: 30_000_000,
      withdrawalPenalty: 0.002,
      settlementLagHours: 4,
    },
  ];

  it("returns 200 with HEALTHY status and optimized allocations when C >= R", async () => {
    const req = createJsonRequest(BASE_URL, {
      availableCash: "150000000.00", // $150M available
      operationalFloor: "20000000.00", // $20M floor
      expectedCumulativeFlow: "5000000.00", // +$5M expected net inflows
      worstCaseResidualShortfall: "-10000000.00", // -$10M worst shortfall
      sampleSize: 45,
      mase: 0.85,
      instruments: sampleInstruments,
    });

    const res = await decisionHandler(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.decision.status).toBe("HEALTHY");

    // R = max(0, -(5M - 10M)) + 20M = 5M + 20M = 25M
    // C = 150M >= 25M -> Surplus = 125M
    expect(json.decision.requiredReserve.amountMinor).toBe(25_000_000_00);
    expect(json.decision.deployableSurplus.amountMinor).toBe(125_000_000_00);
    expect(json.decision.allocations.length).toBeGreaterThan(0);
    expect(json.decision.liquidationPlan.orders).toHaveLength(0);
  });

  it("returns 200 with UNDER_RESERVED status and optimal liquidation plan when C < R", async () => {
    const activeHoldings = [
      {
        instrument: sampleInstruments[0],
        currentAmount: "30000000.00", // $30M in Overnight Repo (0.05% penalty, instant)
      },
      {
        instrument: sampleInstruments[1],
        currentAmount: "20000000.00", // $20M in Commercial Paper (0.20% penalty, 4h)
      },
    ];

    const req = createJsonRequest(BASE_URL, {
      availableCash: "10000000.00", // Only $10M liquid cash
      operationalFloor: "30000000.00", // $30M floor
      expectedCumulativeFlow: "-15000000.00", // -$15M expected outflow
      worstCaseResidualShortfall: "-10000000.00", // -$10M tail risk
      sampleSize: 50,
      mase: 0.9,
      holdings: activeHoldings,
      instruments: sampleInstruments,
    });

    const res = await decisionHandler(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.decision.status).toBe("UNDER_RESERVED");

    // Required reserve R = max(0, -(-25M)) + 30M = 55M
    // Cash = 10M -> Deficit = 45M
    expect(json.decision.reserveGap.amountMinor).toBe(45_000_000_00);
    expect(json.decision.deployableSurplus.amountMinor).toBe(0);
    expect(json.decision.allocations).toHaveLength(0);

    // Liquidation solver should generate orders prioritizing lowest penalty
    const plan = json.decision.liquidationPlan;
    expect(plan.orders.length).toBeGreaterThan(0);
    expect(plan.orders[0].instrumentId).toBe("treasury-repo"); // Lowest penalty first
    expect(plan.totalNetRecoveredCash.amountMinor).toBeGreaterThan(0);
  });

  it("returns 200 with LOW_CONFIDENCE status when sampleSize < 30 or MASE > 1.2", async () => {
    const req = createJsonRequest(BASE_URL, {
      availableCash: "100000000.00",
      operationalFloor: "20000000.00",
      expectedCumulativeFlow: "0.00",
      worstCaseResidualShortfall: "-5000000.00",
      sampleSize: 15, // Low sample size (< 30)
      mase: 1.65, // High error score (> 1.20)
      instruments: sampleInstruments,
    });

    const res = await decisionHandler(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.decision.status).toBe("LOW_CONFIDENCE");
    expect(json.decision.deployableSurplus.amountMinor).toBe(0);
    expect(json.decision.allocations).toHaveLength(0);
    expect(json.decision.warnings.length).toBeGreaterThan(0);
    expect(json.decision.warnings.some((w: string) => w.includes("sample size"))).toBe(true);
  });

  it("runs the full end-to-end pipeline automatically when parameters are omitted", async () => {
    // Only supply bank cash & floor: route should synthesize data, run forecaster backtest,
    // calculate residual quantiles, and formulate decision
    const req = createJsonRequest(BASE_URL, {
      availableCash: "80000000.00",
      operationalFloor: "15000000.00",
      seed: "auto-pipeline-seed-456",
      instruments: sampleInstruments,
    });

    const res = await decisionHandler(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(["HEALTHY", "UNDER_RESERVED", "LOW_CONFIDENCE"]).toContain(
      json.decision.status
    );
    expect(json.decision.requiredReserve).toBeDefined();
    expect(json.decision.coverageRatio).toBeGreaterThan(0);
  });

  it("returns 400 when required fields like availableCash are missing", async () => {
    const req = createJsonRequest(BASE_URL, {
      operationalFloor: "10000000.00",
    });

    const res = await decisionHandler(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toBe("Validation Error");
    expect(json.details.some((d: { path?: string[] }) => d.path?.includes("availableCash"))).toBe(true);
  });

  it("returns 400 when negative cash is provided", async () => {
    const req = createJsonRequest(BASE_URL, {
      availableCash: "-500000.00",
      operationalFloor: "10000000.00",
    });

    const res = await decisionHandler(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toBe("Validation Error");
    expect(json.details[0].message).toContain("non-negative");
  });
});
