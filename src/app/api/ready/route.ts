import { NextResponse } from "next/server";

export async function GET(): Promise<NextResponse> {
  try {
    const admin = await import("@/server/firebase-admin");
    const db = admin.getAdminFirestore();
    // Non-mutating lightweight probe to confirm Admin SDK Firestore connectivity
    await db.collection("health_probes").limit(1).get();

    // Configuration consistency (no secrets): the browser's Firebase project must be the same
    // project the server's service account belongs to, or every ID token is rejected.
    // Best effort: a failure here never turns a ready service into a degraded one.
    let config:
      | {
          adminProjectId: string | null;
          clientProjectId: string | null;
          projectsMatch: boolean;
          authAdmin: "ok" | "failed";
        }
      | undefined;
    try {
      const adminProjectId = admin.getAdminApp().options.projectId ?? null;
      const clientProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || null;
      let authAdmin: "ok" | "failed" = "ok";
      try {
        // Confirms the service account may use the Auth Admin API (needed for revocation checks)
        await admin.getAdminAuth().listUsers(1);
      } catch {
        authAdmin = "failed";
      }
      config = {
        adminProjectId,
        clientProjectId,
        projectsMatch: adminProjectId !== null && adminProjectId === clientProjectId,
        authAdmin,
      };
    } catch {
      config = undefined;
    }

    return NextResponse.json({
      ok: true,
      status: "ready",
      ...(config ? { config } : {}),
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
