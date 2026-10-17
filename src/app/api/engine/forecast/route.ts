/**
 * Reserve Juggler - Forecast Engine API Route
 *
 * POST /api/engine/forecast
 * Runs benchmark time-series forecasters (Naive, Seasonal Naive, Hour-of-Week EWMA)
 * with rolling-origin backtesting and performance metrics (MAE, MASE, Pinball Loss).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  ForecastRequestSchema,
  parseDateInput,
  parseMoneyInput,
} from "@/engine/schemas";
import { generateTransactions } from "@/engine/generator";
import {
  buildContinuousTimeSeries,
  createRollingWindows,
} from "@/engine/timeseries";
import {
  Forecaster,
  NaiveForecaster,
  SeasonalNaiveForecaster,
  HourOfWeekSmoothingForecaster,
  evaluateForecaster,
} from "@/engine/forecast";
import { Money } from "@/engine/money";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json(
        {
          error: "Invalid JSON in request body",
          details: [{ message: "Failed to parse JSON body" }],
        },
        { status: 400 }
      );
    }

    const parseResult = ForecastRequestSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: "Validation Error",
          details: parseResult.error.issues,
        },
        { status: 400 }
      );
    }

    const { data } = parseResult;
    const currency = data.currency ?? "USD";
    const horizonHours = data.horizonHours ?? 24;
    const lookbackHours = data.lookbackHours ?? 168;
    const stepHours = data.stepHours ?? 12;
    const seed = data.seed ?? "hackathon-seed-123";

    // Determine generation time boundaries
    const endDate = data.endDate
      ? parseDateInput(data.endDate)
      : new Date("2026-03-01T00:00:00.000Z");

    const minHoursNeeded = Math.max(lookbackHours + horizonHours + 168, 24 * 21);
    const startDate = data.startDate
      ? parseDateInput(data.startDate)
      : new Date(endDate.getTime() - minHoursNeeded * 60 * 60 * 1000);

    if (startDate.getTime() >= endDate.getTime()) {
      return NextResponse.json(
        {
          error: "Validation Error",
          details: [
            {
              path: ["startDate"],
              message: "startDate must be strictly before endDate",
            },
          ],
        },
        { status: 400 }
      );
    }

    const baseVolumePerHour = data.baseVolumePerHour
      ? parseMoneyInput(data.baseVolumePerHour, currency)
      : Money.fromMajor(20_000_000, currency);

    // 1. Synthesize transaction flow
    const transactions = generateTransactions({
      seed,
      startDate,
      endDate,
      baseVolumePerHour,
    });

    // 2. Build continuous zero-filled hourly series
    const series = buildContinuousTimeSeries(transactions, {
      startDate,
      endDate,
      currency,
    });

    if (series.length < lookbackHours + horizonHours) {
      return NextResponse.json(
        {
          error: "Validation Error",
          details: [
            {
              message: `History duration of ${series.length} hours is insufficient for lookback (${lookbackHours}h) + horizon (${horizonHours}h)`,
            },
          ],
        },
        { status: 400 }
      );
    }

    // 3. Create rolling backtest windows
    const windows = createRollingWindows(series, {
      lookbackHours,
      horizonHours,
      stepHours,
    });

    // 4. Instantiate selected forecaster model
    let forecaster: Forecaster;
    switch (data.method) {
      case "naive":
        forecaster = new NaiveForecaster();
        break;
      case "seasonal_naive":
        forecaster = new SeasonalNaiveForecaster({
          seasonalLag: data.seasonalLag ?? 168,
        });
        break;
      case "hour_of_week":
      default:
        forecaster = new HourOfWeekSmoothingForecaster({
          lambda: data.lambda ?? 0.3,
          mode: data.mode ?? "ewma",
        });
        break;
    }

    // 5. Run rolling-origin evaluation harness
    const backtest = evaluateForecaster(forecaster, windows);

    // 6. Generate active out-of-sample forecast for upcoming horizon
    const activeHistory = series.slice(-lookbackHours);
    const predictions = forecaster.predict(activeHistory, horizonHours);

    return NextResponse.json({
      success: true,
      method: data.method,
      horizonHours,
      lookbackHours,
      asOf: series[series.length - 1].hourStart.toISOString(),
      predictions,
      backtest: {
        forecasterName: backtest.forecasterName,
        windowCount: backtest.windowCount,
        horizonHours: backtest.horizonHours,
        metrics: backtest.metrics,
        windows: backtest.windows.slice(-5), // Return last 5 windows for concise payload
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
