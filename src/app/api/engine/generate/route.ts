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
import { type OrgAuthContext } from "@/server/auth";
import { transactionsRepo } from "@/server/repositories/transactions";
import { auditRepo } from "@/server/repositories/audit";
import { canonicalJsonHash } from "@/server/repositories/common";

export const POST = withAuth(
  async function generateRoute(
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

      // Persist generated transactions and write audit log
      let persisted = false;
      let audited = false;

      try {
        await transactionsRepo.batchInsert(
          authContext.orgId,
          transactions.map((tx) => ({
            ts: tx.timestamp,
            type: tx.type.toLowerCase() as "deposit" | "withdrawal" | "settlement",
            amount: tx.amount.amountMinor.toString(),
            source: "synthetic",
            seed: typeof data.seed === "number" ? data.seed : undefined,
          })),
          authContext.user.uid
        );
        persisted = true;

        try {
          const refPath = `orgs/${authContext.orgId}/transactions`;
          const afterHash = canonicalJsonHash({
            orgId: authContext.orgId,
            seed: data.seed,
            count: transactions.length,
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
          });

          await auditRepo.append(authContext.orgId, {
            actorUid: authContext.user.uid,
            action: "transactions.generate",
            refPath,
            afterHash,
          });
          audited = true;
        } catch (auditErr) {
          console.error("[generateRoute] Audit logging failed:", auditErr);
          audited = false;
        }
      } catch (persistErr) {
        console.error("[generateRoute] Transactions persistence failed:", persistErr);
        persisted = false;
        audited = false;
      }

      return NextResponse.json({
        success: true,
        persisted,
        audited,
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
