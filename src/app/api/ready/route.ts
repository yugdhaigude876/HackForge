import { NextResponse } from "next/server";
import { getAdminFirestore } from "@/server/firebase-admin";

export async function GET(): Promise<NextResponse> {
  try {
    const db = getAdminFirestore();
    // Non-mutating lightweight probe to confirm Admin SDK Firestore connectivity
    await db.collection("health_probes").limit(1).get();
    return NextResponse.json({
      ok: true,
      status: "ready",
    });
  } catch {
    // Fail safe: reports degraded without leaking raw error text, stack traces, or credentials
    return NextResponse.json(
      {
        ok: false,
        status: "degraded",
      },
      { status: 503 }
    );
  }
}
