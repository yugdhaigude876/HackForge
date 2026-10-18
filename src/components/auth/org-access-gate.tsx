"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { LogOut, RefreshCw, ShieldAlert } from "lucide-react";
import { useAuth } from "@/lib/firebase/auth-context";
import { apiFetch } from "@/lib/api-client";
import { Button } from "@/components/ui/primitives";

type GateState =
  | { status: "checking" }
  | { status: "granted" }
  | { status: "denied"; reason: string }
  | { status: "error"; message: string };

const DENIED_COPY: Record<string, string> = {
  "no-invitation": "This account has not been invited to the organisation.",
  "email-not-verified": "Verify your email address, then check again.",
  "no-email": "This account has no email address, so it cannot be matched to an invitation.",
};

/**
 * Real accounts only: after sign-in the server either recognises the user as a member, converts a
 * matching invitation into membership, or refuses. Refused users see how to get access instead of
 * a dashboard full of "Not a member" errors.
 */
export function OrgAccessGate({ children }: { children: ReactNode }) {
  const { user, isMock, signOut } = useAuth();
  const router = useRouter();
  const needsCheck = Boolean(user && !isMock);
  const uid = user?.uid;
  const [state, setState] = useState<GateState>({ status: "checking" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!needsCheck) return;
    let cancelled = false;
    apiFetch("/api/org/join", { method: "POST" })
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          setState({ status: "granted" });
        } else if (res.status === 403) {
          const details = res.error.details as { reason?: string } | undefined;
          setState({ status: "denied", reason: details?.reason ?? "no-invitation" });
        } else {
          setState({ status: "error", message: res.error.message });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ status: "error", message: err instanceof Error ? err.message : "Request failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [needsCheck, uid, attempt]);

  const recheck = useCallback(() => {
    setState({ status: "checking" });
    setAttempt((n) => n + 1);
  }, []);

  const leave = useCallback(async () => {
    await signOut();
    router.push("/login");
  }, [signOut, router]);

  if (!needsCheck || state.status === "granted") return <>{children}</>;

  if (state.status === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted" role="status">
        Verifying organisation access…
      </div>
    );
  }

  const message =
    state.status === "denied" ? (DENIED_COPY[state.reason] ?? "Access to this organisation was refused.") : state.message;

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md space-y-4 rounded-xl border border-border bg-surface p-6 text-center">
        <ShieldAlert className="mx-auto h-8 w-8 text-negative" aria-hidden />
        <h1 className="text-base font-semibold text-foreground">
          {state.status === "denied" ? "Access not granted" : "Could not verify access"}
        </h1>
        <p className="text-sm text-muted">{message}</p>
        {state.status === "denied" && (
          <p className="text-xs text-muted">
            Ask an organisation admin to invite <span className="font-medium text-foreground">{user?.email}</span> from
            Settings → Team access, then press Check again.
          </p>
        )}
        <div className="flex justify-center gap-2">
          <Button variant="outline" size="sm" onClick={recheck}>
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Check again</span>
          </Button>
          <Button variant="outline" size="sm" onClick={leave}>
            <LogOut className="h-3.5 w-3.5" />
            <span>Sign out</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
