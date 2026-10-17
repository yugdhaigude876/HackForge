/**
 * Reserve Juggler - Liquidity Decision Engine API Route
 *
 * POST /api/engine/decision
 * Executes the complete Basel III liquidity decision pipeline combining:
 * - Statistical risk-based reserve calculation: R = max(0, -(mu_H + q_H(alpha))) + F + Z
 * - Surplus optimization & greedy allocation into yield instruments
 * - Operational state machine (HEALTHY, UNDER_RESERVED, LOW_CONFIDENCE)
 * - Minimum-penalty, fastest-settlement liquidation solver for liquidity deficits
 * Protected by withAuth: requires valid ID token and organisation membership (min role: analyst).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  DecisionRequestSchema,
  parseMoneyInput,
  parseInstrumentInput,
  parseAllocatedHoldingInput,
} from "@/engine/schemas";
import {
  evaluateLiquidityDecision,
  DecisionContext,
} from "@/engine/decision";
import { generateTransactions } from "@/engine/generator";
import {
  buildContinuousTimeSeries,
  createRollingWindows,
} from "@/engine/timeseries";
import {
  HourOfWeekSmoothingForecaster,
  evaluateForecaster,
} from "@/engine/forecast";
import {
  extractCumulativeResiduals,
  calculateResidualQuantile,
} from "@/engine/reserve";
import { Money } from "@/engine/money";
import { withAuth, createErrorResponse } from "@/server/with-auth";

export const POST = withAuth(
  async function decisionRoute(request: NextRequest): Promise<NextResponse> {
    try {
      let rawBody: unknown;
      try {
        rawBody = await request.json();
      } catch {
        return createErrorResponse(
          400,
          "VALIDATION_ERROR",
          "Invalid JSON in request body",
          [{ message: "Failed to parse JSON body" }]
        );
      }

      const parseResult = DecisionRequestSchema.safeParse(rawBody);
      if (!parseResult.success) {
        return createErrorResponse(
          400,
          "VALIDATION_ERROR",
          "Validation Error",
          parseResult.error.issues
        );
      }

      const { data } = parseResult;
      const currency = data.currency ?? "USD";
      const availableCash = parseMoneyInput(data.availableCash, currency);
      availableCash.assertNonNegative("availableCash must be non-negative");

      const operationalFloor = parseMoneyInput(data.operationalFloor, currency);
      operationalFloor.assertNonNegative("operationalFloor must be non-negative");

      const stressAddOn = data.stressAddOn
        ? parseMoneyInput(data.stressAddOn, currency)
        : Money.zero(currency);
      stressAddOn.assertNonNegative("stressAddOn must be non-negative");

      const horizonHours = data.horizonHours ?? 24;
      const alpha = data.alpha ?? 0.01;

      const currentHoldings = (data.holdings ?? []).map((h) =>
        parseAllocatedHoldingInput(h, currency)
      );
      const availableInstruments = (data.instruments ?? []).map((i) =>
        parseInstrumentInput(i, currency)
      );

      let expectedCumulativeFlow: Money | undefined = data.expectedCumulativeFlow
        ? parseMoneyInput(data.expectedCumulativeFlow, currency)
        : undefined;

      let worstCaseResidualShortfall: Money | undefined =
        data.worstCaseResidualShortfall
          ? parseMoneyInput(data.worstCaseResidualShortfall, currency)
          : undefined;

      let sampleSize = data.sampleSize;
      let mase = data.mase;

      // If statistical parameters are not fully provided, run the pipeline on the fly
      if (
        expectedCumulativeFlow === undefined ||
        worstCaseResidualShortfall === undefined ||
        sampleSize === undefined ||
        mase === undefined ||
        data.seed !== undefined
      ) {
        const seed = data.seed ?? "hackathon-seed-123";
        const endDate = new Date("2026-03-01T00:00:00.000Z");
        const lookbackHours = 168;
        const stepHours = 12;
        const totalHoursNeeded = 24 * 28; // 28 days for >30 rolling windows
        const startDate = new Date(
          endDate.getTime() - totalHoursNeeded * 60 * 60 * 1000
        );

        const transactions = generateTransactions({
          seed,
          startDate,
          endDate,
          baseVolumePerHour: Money.fromMajor(20_000_000, currency),
        });

        const series = buildContinuousTimeSeries(transactions, {
          startDate,
          endDate,
          currency,
        });

        const windows = createRollingWindows(series, {
          lookbackHours,
          horizonHours,
          stepHours,
        });

        const forecaster = new HourOfWeekSmoothingForecaster({
          lambda: 0.3,
          mode: "ewma",
        });

        const backtest = evaluateForecaster(forecaster, windows);
        const residuals = extractCumulativeResiduals(backtest.windows);

        if (expectedCumulativeFlow === undefined) {
          const activeHistory = series.slice(-lookbackHours);
          const activePredictions = forecaster.predict(activeHistory, horizonHours);
          let sumMinor = 0n;
          for (const p of activePredictions) {
            sumMinor += p.amountMinor;
          }
          expectedCumulativeFlow = Money.fromMinor(sumMinor, currency);
        }

        if (worstCaseResidualShortfall === undefined) {
          worstCaseResidualShortfall = calculateResidualQuantile(residuals, alpha);
        }

        if (sampleSize === undefined) {
          sampleSize = backtest.windows.length;
        }

        if (mase === undefined) {
          mase = backtest.metrics.mase;
        }
      }

      const context: DecisionContext = {
        availableCash,
        expectedCumulativeFlow,
        worstCaseResidualShortfall,
        sampleSize,
        mase,
        currentHoldings,
        availableInstruments,
        operationalFloor,
        stressAddOn,
        horizonHours,
        thresholds: data.thresholds,
      };

      const decision = evaluateLiquidityDecision(context);

      return NextResponse.json({
        success: true,
        decision,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Internal server error";

      // Domain validation errors return 400 Bad Request
      if (
        message.includes("must be non-negative") ||
        message.includes("Currency mismatch") ||
        message.includes("Invalid money") ||
        message.includes("Unsupported")
      ) {
        return createErrorResponse(
          400,
          "VALIDATION_ERROR",
          "Validation Error",
          [{ message }]
        );
      }

      console.error("[decisionRoute Error]:", error);
      return createErrorResponse(
        500,
        "INTERNAL",
        "An internal server error occurred."
      );
    }
  },
  { minRole: "analyst" }
);
