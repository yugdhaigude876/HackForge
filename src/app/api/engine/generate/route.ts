/**
 * Reserve Juggler - Synthetic Transaction Generator API Route
 *
 * POST /api/engine/generate
 * Generates reproducible, continuous transaction streams using seeded PRNG.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  GenerateTransactionsRequestSchema,
  parseDateInput,
  parseMoneyInput,
} from "@/engine/schemas";
import { generateTransactions } from "@/engine/generator";
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

    const parseResult = GenerateTransactionsRequestSchema.safeParse(rawBody);
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
    const startDate = parseDateInput(data.startDate);
    const endDate = parseDateInput(data.endDate);

    if (startDate.getTime() > endDate.getTime()) {
      return NextResponse.json(
        {
          error: "Validation Error",
          details: [
            {
              path: ["startDate"],
              message: "startDate must be before or equal to endDate",
            },
          ],
        },
        { status: 400 }
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
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
