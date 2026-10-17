import { NextRequest, NextResponse } from "next/server";
import { withAuth, createErrorResponse } from "@/server/with-auth";
import { forecastsRepo } from "@/server/repositories/forecasts";
import { seriesRepo } from "@/server/repositories/series";
import {
  evaluateModelAndBaselinesOnWindows,
  type ComparativeEvaluationResult,
} from "@/engine/metrics";
import {
  HourOfWeekSmoothingForecaster,
  NaiveForecaster,
  SeasonalNaiveForecaster,
  type Forecaster,
} from "@/engine/forecast";
import { createRollingWindows } from "@/engine/timeseries";
import { HourlyBucket } from "@/engine/models";
import { Money } from "@/engine/money";
import type { OrgAuthContext } from "@/server/auth";

/**
 * GET /api/analytics/forecast
 * Minimum role: viewer.
 * Returns comparative backtest metrics between the latest stored forecast model and baselines
 * (Naive & Seasonal Naive) evaluated on identical rolling-origin windows.
 */
export const GET = withAuth(
  async function getForecastAnalyticsRoute(
    _request: NextRequest,
    authContext: OrgAuthContext
  ): Promise<NextResponse> {
    try {
      const orgId = authContext.orgId;

      // 1. Fetch latest forecast record for the organisation
      const forecasts = await forecastsRepo.list(orgId, { limit: 1 });
      if (forecasts.length === 0) {
        return NextResponse.json({
          ok: true,
          data: {
            forecastId: null,
            source: null,
            asOf: null,
            seed: null,
            method: null,
            windowCount: 0,
            evaluation: null,
            reason: "No forecast records stored for organisation.",
          },
        });
      }

      const latest = forecasts[0];
      const source = latest.source ?? "unknown";
      const seed = (latest.params?.seed as number | string) ?? null;
      const horizonHours = latest.horizon ?? 24;

      // 2. Attempt to reconstruct rolling windows from stored series
      const asOf = latest.asOf;
      // Fetch up to 720 hours (30 days) prior to asOf to construct backtest windows
      const fromDate = new Date(asOf.getTime() - 720 * 60 * 60 * 1000);
      let seriesBuckets: HourlyBucket[] = [];

      try {
        const storedBuckets = await seriesRepo.listRange(orgId, fromDate, asOf, { limit: 750 });
        seriesBuckets = storedBuckets.map((b) => ({
          bucketId: b.bucketId,
          hourStart: b.hourStart,
          inbound: b.inFlow,
          outbound: b.outFlow,
          netFlow: b.inFlow.subtract(b.outFlow),
          grossVolume: b.inFlow.add(b.outFlow),
          transactionCount: 1,
        }));
      } catch {
        // Series repo read failure or no series table
      }

      // Check if series is sufficient for comparative rolling backtest (need at least history + horizon)
      const minRequiredHours = 168 + horizonHours; // At least 1 week + 1 horizon
      if (seriesBuckets.length >= minRequiredHours) {
        try {
          const windows = createRollingWindows(seriesBuckets, {
            lookbackHours: 168,
            horizonHours,
            stepHours: 24,
          });

          if (windows.length > 0) {
            let modelForecaster: Forecaster;
            if (latest.method.toLowerCase().includes("naive")) {
              modelForecaster = new NaiveForecaster();
            } else if (latest.method.toLowerCase().includes("seasonal")) {
              modelForecaster = new SeasonalNaiveForecaster({ seasonalLag: 168, fallbackToNaive: true });
            } else {
              const lambda = typeof latest.params?.lambda === "number" ? latest.params.lambda : 0.3;
              modelForecaster = new HourOfWeekSmoothingForecaster({ lambda });
            }

            // Extract residual lower/upper bounds from stored forecast points if available
            const lowerBounds: Money[] = [];
            const upperBounds: Money[] = [];
            for (const pt of latest.points) {
              if (pt.bandLowerMinor && pt.bandUpperMinor) {
                lowerBounds.push(Money.fromMinor(BigInt(pt.bandLowerMinor)));
                upperBounds.push(Money.fromMinor(BigInt(pt.bandUpperMinor)));
              }
            }

            const compResult: ComparativeEvaluationResult = evaluateModelAndBaselinesOnWindows(
              modelForecaster,
              windows,
              {
                tau: 0.95,
                seasonalLag: 168,
                residualLowerBounds: lowerBounds.length === windows[0].target.length ? lowerBounds : undefined,
                residualUpperBounds: upperBounds.length === windows[0].target.length ? upperBounds : undefined,
              }
            );

            return NextResponse.json({
              ok: true,
              data: {
                forecastId: latest.id,
                source,
                asOf: latest.asOf.toISOString(),
                seed,
                method: latest.method,
                windowCount: compResult.windowCount,
                evaluation: compResult,
                residualQuantiles: latest.residualQuantiles ?? null,
              },
            });
          }
        } catch {
          // Fall through to summary metadata fallback
        }
      }

      // 3. Fallback: If series is too short or missing, report stored backtest metrics with null baseline fields
      const storedMase = latest.backtest?.mase ?? null;
      const storedPinball = latest.backtest?.pinball ?? null;
      const storedSkill = latest.backtest?.skillVsBaseline ?? null;
      const sampleSize = latest.backtest?.sampleSize ?? 0;

      const fallbackEvaluation = {
        windowCount: sampleSize,
        horizonHours,
        tau: 0.95,
        model: {
          name: latest.method,
          maeMinor: null,
          maeDollars: null,
          mase: storedMase,
          pinballLoss: storedPinball,
          reason: "Sourced from stored forecast backtest summary",
        },
        naive: {
          name: "Naive (Flat Line)",
          maeMinor: null,
          maeDollars: null,
          mase: null,
          pinballLoss: null,
          reason: "Stored series history insufficient to re-evaluate baseline on rolling windows",
        },
        seasonalNaive: {
          name: "Seasonal Naive (Same Hour Last Week)",
          maeMinor: null,
          maeDollars: null,
          mase: null,
          pinballLoss: null,
          reason: "Stored series history insufficient to re-evaluate baseline on rolling windows",
        },
        skillScores: {
          vsNaive: {
            mase: {
              skill: storedSkill,
              isBetter: storedSkill !== null ? storedSkill > 0 : false,
              reason: storedSkill !== null ? undefined : "Stored series insufficient to recompute vs Naive",
            },
            pinball: { skill: null, isBetter: false, reason: "Insufficient series history" },
            mae: { skill: null, isBetter: false, reason: "Insufficient series history" },
          },
          vsSeasonalNaive: {
            mase: {
              skill: storedSkill,
              isBetter: storedSkill !== null ? storedSkill > 0 : false,
              reason: storedSkill !== null ? undefined : "Stored series insufficient to recompute vs Seasonal Naive",
            },
            pinball: { skill: null, isBetter: false, reason: "Insufficient series history" },
            mae: { skill: null, isBetter: false, reason: "Insufficient series history" },
          },
        },
        reason: "Stored series history is too short for live rolling-origin backtesting; returning stored forecast metadata.",
      };

      return NextResponse.json({
        ok: true,
        data: {
          forecastId: latest.id,
          source,
          asOf: latest.asOf.toISOString(),
          seed,
          method: latest.method,
          windowCount: sampleSize,
          evaluation: fallbackEvaluation,
          residualQuantiles: latest.residualQuantiles ?? null,
        },
      });
    } catch (error) {
      console.error("[getForecastAnalyticsRoute Error]:", error);
      return createErrorResponse(
        500,
        "INTERNAL",
        "An internal error occurred while generating forecast analytics."
      );
    }
  },
  { minRole: "viewer" }
);
