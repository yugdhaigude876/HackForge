"use client";

import { useAuth } from "@/lib/firebase/auth-context";
import { Badge, Button } from "@/components/ui/primitives";
import { Panel } from "@/components/finance/panels";
import { ShieldCheck, User, LogOut, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";

export default function SettingsPage() {
  const { user, isMock, signOut, signInAsDemoUser } = useAuth();
  const router = useRouter();

  const handleSignOut = async () => {
    await signOut();
    router.push("/login");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Settings & Security</h1>
          <p className="text-xs text-muted">Institutional identity, role permissions, and Firebase authentication.</p>
        </div>
        {isMock ? (
          <Badge tone="info" className="gap-1">
            <Sparkles className="h-3 w-3" />
            Mock Auth Active
          </Badge>
        ) : (
          <Badge tone="positive" className="gap-1">
            <ShieldCheck className="h-3 w-3" />
            Firebase Live
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Active Session" description="Current authenticated operator credentials.">
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-2 p-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/20 text-primary">
                <User className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm text-foreground">{user?.displayName || "Treasury Analyst"}</p>
                <p className="truncate text-xs text-muted">{user?.email || "internal@reservejuggler.internal"}</p>
              </div>
              <Badge tone="info">{user?.role || "Operator"}</Badge>
            </div>

            <dl className="divide-y divide-border text-xs">
              <div className="flex justify-between py-2">
                <dt className="text-muted">User ID (UID)</dt>
                <dd className="tabular text-foreground font-mono">{user?.uid || "mock-anonymous"}</dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="text-muted">Auth Engine</dt>
                <dd className="text-foreground">{isMock ? "Mock Dev Provider" : "Firebase Client SDK"}</dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="text-muted">Session Status</dt>
                <dd className="text-positive font-medium">Active & Verified</dd>
              </div>
            </dl>

            <Button
              variant="outline"
              size="sm"
              onClick={handleSignOut}
              className="w-full text-negative hover:bg-negative/10"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Terminate Session (Sign Out)</span>
            </Button>
          </div>
        </Panel>

        <Panel title="Development & Testing Personas" description="Switch between test accounts instantly.">
          <p className="text-xs text-muted mb-4">
            Switching personas updates your session and re-evaluates role-based access rules:
          </p>
          <div className="space-y-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start text-xs h-9 bg-surface-2 hover:bg-surface-2/80"
              onClick={() => signInAsDemoUser("analyst")}
            >
              ⚡ Alex Vance — Senior Treasury Analyst
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start text-xs h-9 bg-surface-2 hover:bg-surface-2/80"
              onClick={() => signInAsDemoUser("risk_officer")}
            >
              🛡️ Elena Rostova — Chief Risk Officer
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start text-xs h-9 bg-surface-2 hover:bg-surface-2/80"
              onClick={() => signInAsDemoUser("cfo")}
            >
              💼 Marcus Sterling — Treasury Director & CFO
            </Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
