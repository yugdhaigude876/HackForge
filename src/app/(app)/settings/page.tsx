"use client";

import { useAuth } from "@/lib/firebase/auth-context";
import { Badge, Button } from "@/components/ui/primitives";
import { Panel } from "@/components/finance/panels";
import { ShieldCheck, User, LogOut, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { TeamAccessPanel } from "@/components/settings/team-access-panel";

export default function SettingsPage() {
  const { user, isMock, signOut } = useAuth();
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
          <p className="text-xs text-muted">Institutional identity, role permissions, and team access.</p>
        </div>
        {isMock ? (
          <Badge tone="info" className="gap-1">
            <Sparkles className="h-3 w-3" />
            Local Dev Auth
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
                <dd className="text-foreground">{isMock ? "Local Dev Provider" : "Firebase Client SDK"}</dd>
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

        <TeamAccessPanel />
      </div>
    </div>
  );
}
