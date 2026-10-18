import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { AuthGuard } from "@/components/auth/route-guard";
import { OrgAccessGate } from "@/components/auth/org-access-gate";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard>
      <OrgAccessGate>
        <AppShell>{children}</AppShell>
      </OrgAccessGate>
    </AuthGuard>
  );
}
