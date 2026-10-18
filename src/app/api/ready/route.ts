import { NextResponse } from "next/server";

export async function GET(): Promise<NextResponse> {
  try {
    const { getAdminFirestore } = await import("@/server/firebase-admin");
    const db = getAdminFirestore();
    // Non-mutating lightweight probe to confirm Admin SDK Firestore connectivity
    await db.collection("health_probes").limit(1).get();
    return NextResponse.json({
      ok: true,
      status: "ready",
    });
  } catch (error) {
    // Fail safe: reports degraded without leaking raw error text, stack traces, or credentials
    console.warn("[/api/ready] Degraded:", error instanceof Error ? error.message : String(error));
    return NextResponse.json(
      {
        ok: false,
        status: "degraded",
      },
      { status: 503 }
    );
  }
}
