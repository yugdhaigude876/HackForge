import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/server/with-auth";
import {
  loadTreasuryDataset,
  getTreasuryDatasetSummary,
} from "@/engine/dataset";
import type { OrgAuthContext } from "@/server/auth";

export const maxDuration = 30;

/**
 * GET /api/engine/dataset
 *
 * Exposes windowed slices and aggregate summary statistics of the 8,760-hour
 * benchmark treasury dataset for dashboard visualization and interactive telemetry.
 * Minimum required role: viewer.
 */
export const GET = withAuth(
  async function getDatasetRoute(
    request: NextRequest,
    _authContext: OrgAuthContext
  ): Promise<NextResponse> {
    void _authContext;
    try {
      const { searchParams } = new URL(request.url);
      const summaryOnly = searchParams.get("summaryOnly") === "true";
      const offsetParam = searchParams.get("offset");
      const limitParam = searchParams.get("limit");

      const offset = Math.max(0, Number.parseInt(offsetParam ?? "0", 10) || 0);
      const limit = Math.min(
        8760,
        Math.max(1, Number.parseInt(limitParam ?? "168", 10) || 168)
      );

      const records = loadTreasuryDataset();
      const summary = getTreasuryDatasetSummary(records);

      if (summaryOnly) {
        return NextResponse.json({
          ok: true,
          data: {
            summary,
          },
        });
      }

      const slice = records.slice(offset, offset + limit);

      return NextResponse.json({
        ok: true,
        data: {
          summary,
          offset,
          limit,
          returnedCount: slice.length,
          records: slice,
        },
      });
    } catch (err) {
      console.error("[api/engine/dataset] Error reading dataset:", err);
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "INTERNAL",
            message: "Failed to load benchmark dataset.",
          },
        },
        { status: 500 }
      );
    }
  },
  { minRole: "viewer" }
);
