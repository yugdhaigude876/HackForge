/**
 * Reserve Juggler - Synthetic Transaction Generator API Route
 *
 * POST /api/engine/generate
 * Generates reproducible, continuous transaction streams using seeded PRNG.
 * Protected by withAuth: requires valid ID token and organisation membership (min role: analyst).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  GenerateTransactionsRequestSchema,
  parseDateInput,
  parseMoneyInput,
} from "@/engine/schemas";
import { generateTransactions } from "@/engine/generator";
import { Money } from "@/engine/money";
import { withAuth, createErrorResponse } from "@/server/with-auth";

export const POST = withAuth(
  async function generateRoute(request: NextRequest): Promise<NextResponse> {
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

      const parseResult = GenerateTransactionsRequestSchema.safeParse(rawBody);
      if (!parseResult.success) {
        return createErrorResponse(
          400,
          "VALIDATION_ERROR",
          "Validation Error",
          parseResult.error.issues
        );
      }

      const { data } = parseResult;
      const startDate = parseDateInput(data.startDate);
      const endDate = parseDateInput(data.endDate);

      if (startDate.getTime() > endDate.getTime()) {
        return createErrorResponse(
          400,
          "VALIDATION_ERROR",
          "Validation Error",
          [
            {
              path: ["startDate"],
              message: "startDate must be before or equal to endDate",
            },
          ]
        );
      }

      const currency = data.currency ?? "USD";
      const baseVolumePerHour = data.baseVolumePerHour
        ? parseMoneyInput(data.baseVolumePerHour, currency)
        : Money.fromMajor(20_000_000, currency);

      const transactions = generateTransactions({
        seed: data.seed,
        startDate,
        endDate,
        baseVolumePerHour,
        transactionsPerHour: data.transactionsPerHour,
      });

      return NextResponse.json({
        success: true,
        count: transactions.length,
        timespan: {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        },
        currency,
        transactions,
      });
    } catch (error) {
      console.error("[generateRoute Error]:", error);
      return createErrorResponse(
        500,
        "INTERNAL",
        "An internal server error occurred."
      );
    }
  },
  { minRole: "analyst" }
);
