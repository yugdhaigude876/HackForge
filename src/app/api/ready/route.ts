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
          tokenVerifier: "ok" | "failed";
          adminProjectId: string | null;
          clientProjectId: string | null;
          projectsMatch: boolean;
          authAdmin: "ok" | "failed";
          authAdminErrorCode?: string;
          authAdminErrorName?: string;
          authAdminErrorHint?: string;
        }
      | undefined;
    try {
      const adminProjectId = admin.getAdminApp().options.projectId ?? null;
      const clientProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || null;
      let authAdmin: "ok" | "failed" = "ok";
      let authAdminErrorCode: string | undefined;
      let authAdminErrorName: string | undefined;
      let authAdminErrorHint: string | undefined;
      try {
        // Confirms the service account may use the Auth Admin API (needed for revocation checks)
        await admin.getAdminAuth().listUsers(1);
      } catch (authErr) {
        authAdmin = "failed";
        // Error code only (for example auth/insufficient-permission or app/network-error). No message text.
        authAdminErrorCode =
          typeof authErr === "object" && authErr !== null && "code" in authErr
            ? String((authErr as { code: unknown }).code).slice(0, 80)
            : "unknown";
        // Error class name and a short, path-stripped message to diagnose bundling problems
        // (for example a module missing from the serverless bundle). No stack, no credentials.
        authAdminErrorName = authErr instanceof Error ? authErr.name.slice(0, 60) : typeof authErr;
        authAdminErrorHint =
          authErr instanceof Error
            ? authErr.message.replace(/\/[\w./@-]+/g, "<path>").replace(/[A-Za-z0-9_-]{30,}/g, "<redacted>").slice(0, 140)
            : undefined;
      }
      // Token verification uses Google's public keys (jose). Confirm they are reachable from here.
      let tokenVerifier: "ok" | "failed" = "ok";
      try {
        const { FIREBASE_JWKS_URL } = await import("@/server/jose-verifier");
        const res = await fetch(FIREBASE_JWKS_URL, { signal: AbortSignal.timeout(4000), cache: "no-store" });
        const body = (await res.json()) as { keys?: unknown[] };
        if (!res.ok || !Array.isArray(body.keys) || body.keys.length === 0) tokenVerifier = "failed";
      } catch {
        tokenVerifier = "failed";
      }

      config = {
        tokenVerifier,
        adminProjectId,
        clientProjectId,
        projectsMatch: adminProjectId !== null && adminProjectId === clientProjectId,
        authAdmin,
        ...(authAdminErrorCode ? { authAdminErrorCode } : {}),
        ...(authAdminErrorName ? { authAdminErrorName } : {}),
        ...(authAdminErrorHint ? { authAdminErrorHint } : {}),
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
