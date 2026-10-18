"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Menu, X, LogOut } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { useAuth } from "@/lib/firebase/auth-context";
import { useDataSource } from "@/components/providers/data-source-provider";
import { Sidebar } from "./sidebar";

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { user, isMock, signOut } = useAuth();
  const { source } = useDataSource();
  const router = useRouter();

  const handleSignOut = async () => {
    await signOut();
    router.push("/login");
  };

  return (
    <div className="min-h-screen bg-[#0B0E14] text-[#F8FAFC] lg:grid lg:grid-cols-[240px_1fr]">
      {/* Desktop Left Sidebar */}
      <aside className="sticky top-0 hidden h-screen border-r border-[#1E2536] bg-[#0B0E14] lg:block">
        <Sidebar />
      </aside>

      {/* Mobile Drawer */}
      {open && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
        >
          <button
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-[#1E2536] bg-[#0B0E14]">
            <Sidebar onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-col">
        {/* Top Header */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-[#1E2536] bg-[#0B0E14]/90 px-4 backdrop-blur">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden text-[#94A3B8] hover:text-[#F8FAFC]"
            aria-label="Open navigation"
            onClick={() => setOpen(true)}
          >
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </Button>

          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#A3E635] shadow-[0_0_8px_#A3E635]" />
            <span className="font-mono text-xs text-[#94A3B8] tracking-wider uppercase">
              INSTITUTIONAL TREASURY WORKSTATION · USD
            </span>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            {source === "offline-fallback" ? (
              <span
                data-testid="top-bar-fallback-badge"
                className="rounded bg-amber-500/20 px-2 py-0.5 font-mono text-[10px] font-bold text-amber-400 border border-amber-500/40"
              >
                Offline fallback
              </span>
            ) : isMock ? (
              <span className="rounded bg-[#38BDF8]/15 px-2 py-0.5 font-mono text-[10px] font-bold text-[#38BDF8] border border-[#38BDF8]/30">
                Demo Auth
              </span>
            ) : user ? (
              <span className="rounded bg-[#22C55E]/15 px-2 py-0.5 font-mono text-[10px] font-bold text-[#22C55E] border border-[#22C55E]/30">
                Live Firebase
              </span>
            ) : (
              <span className="rounded bg-[#F59E0B]/15 px-2 py-0.5 font-mono text-[10px] font-bold text-[#F59E0B] border border-[#F59E0B]/30">
                Unauthenticated
              </span>
            )}

            {user && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSignOut}
                className="hidden text-xs text-[#94A3B8] hover:text-[#EF4444] hover:bg-[#121620] sm:inline-flex"
                title="Sign Out"
              >
                <LogOut className="h-3.5 w-3.5 mr-1" />
                <span>Sign Out</span>
              </Button>
            )}
          </div>
        </header>

        {/* Workstation Canvas */}
        <main className="w-full flex-1 p-3 lg:p-5">{children}</main>
      </div>
    </div>
  );
}
