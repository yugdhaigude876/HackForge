/**
 * Reserve Juggler - Forecast Engine API Route
 *
 * POST /api/engine/forecast
 * Runs benchmark time-series forecasters (Naive, Seasonal Naive, Hour-of-Week EWMA)
 * with rolling-origin backtesting and performance metrics (MAE, MASE, Pinball Loss).
 * Protected by withAuth: requires valid ID token and organisation membership (min role: analyst).
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
import { withAuth, createErrorResponse } from "@/server/with-auth";
import { type OrgAuthContext } from "@/server/auth";
import { forecastsRepo } from "@/server/repositories/forecasts";
import { auditRepo } from "@/server/repositories/audit";
import { canonicalJsonHash } from "@/server/repositories/common";
import { calculateQuantile } from "@/engine/reserve";

export const POST = withAuth(
  async function forecastRoute(
    request: NextRequest,
    authContext: OrgAuthContext
  ): Promise<NextResponse> {
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

      const parseResult = ForecastRequestSchema.safeParse(rawBody);
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
        return createErrorResponse(
          400,
          "VALIDATION_ERROR",
          "Validation Error",
          [
            {
              path: ["startDate"],
              message: "startDate must be strictly before endDate",
            },
          ]
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
        return createErrorResponse(
          400,
          "VALIDATION_ERROR",
          "Validation Error",
          [
            {
              message: `History duration of ${series.length} hours is insufficient for lookback (${lookbackHours}h) + horizon (${horizonHours}h)`,
            },
          ]
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

      // 7. Persist forecast run and write audit log
      let persisted = false;
      let audited = false;
      let forecastId: string | undefined = undefined;

      try {
        const asOfDate = new Date(series[series.length - 1].hourStart);
        const asOfMs = asOfDate.getTime();

        const savedForecast = await forecastsRepo.create(
          authContext.orgId,
          {
            method: data.method,
            params: {
              lookbackHours,
              horizonHours,
              stepHours,
              seasonalLag: data.seasonalLag,
              lambda: data.lambda,
              mode: data.mode,
            },
            asOf: asOfDate,
            horizon: horizonHours,
            points: predictions.map((p, idx) => {
              let bandLowerMinor: string | undefined;
              let bandUpperMinor: string | undefined;
              if (backtest.windows.length > 0) {
                const stepResiduals = backtest.windows.map(
                  (w) => Number(w.residuals[idx]?.amountMinor ?? 0n)
                );
                if (stepResiduals.length > 0) {
                  const q05 = calculateQuantile(stepResiduals, 0.05);
                  const q95 = calculateQuantile(stepResiduals, 0.95);
                  bandLowerMinor = (p.amountMinor + BigInt(Math.round(q05))).toString();
                  bandUpperMinor = (p.amountMinor + BigInt(Math.round(q95))).toString();
                }
              }
              return {
                ts: new Date(asOfMs + (idx + 1) * 60 * 60 * 1000),
                mean: p.amountMinor,
                bandLower: bandLowerMinor,
                bandUpper: bandUpperMinor,
              };
            }),
            residualQuantiles: {
              mase: backtest.metrics.mase,
              maeMinor: backtest.metrics.maeMinor,
              maeDollars: backtest.metrics.maeDollars,
              pinballLoss95: backtest.metrics.pinballLoss95,
              pinballLoss99: backtest.metrics.pinballLoss99,
            },
            backtest: {
              mase: backtest.metrics.mase,
              pinball: backtest.metrics.pinballLoss95,
              sampleSize: backtest.windowCount,
            },
          },
          authContext.user.uid
        );
        forecastId = savedForecast.id;
        persisted = true;

        try {
          const refPath = `orgs/${authContext.orgId}/forecasts/${forecastId}`;
          const afterHash = canonicalJsonHash({
            id: forecastId,
            orgId: authContext.orgId,
            method: data.method,
            asOf: savedForecast.asOf.toISOString(),
            horizon: horizonHours,
            metrics: backtest.metrics,
          });

          await auditRepo.append(authContext.orgId, {
            actorUid: authContext.user.uid,
            action: "forecast.create",
            refPath,
            afterHash,
          });
          audited = true;
        } catch (auditErr) {
          console.error("[forecastRoute] Audit logging failed:", auditErr);
          audited = false;
        }
      } catch (persistErr) {
        console.error("[forecastRoute] Forecast persistence failed:", persistErr);
        persisted = false;
        audited = false;
      }

      return NextResponse.json({
        success: true,
        id: forecastId,
        persisted,
        audited,
        ...(persisted
          ? {}
          : {
              warning:
                "Result computed successfully but could not be persisted to the organisation store.",
            }),
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
      console.error("[forecastRoute Error]:", error);
      return createErrorResponse(
        500,
        "INTERNAL",
        "An internal server error occurred."
      );
    }
  },
  { minRole: "analyst" }
);
