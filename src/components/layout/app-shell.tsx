"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Menu, X, LogOut, User as UserIcon } from "lucide-react";
import { Badge, Button } from "@/components/ui/primitives";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/firebase/auth-context";
import { navItems } from "./nav";

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { user, isMock, signOut } = useAuth();
  const router = useRouter();

  const handleSignOut = async () => {
    await signOut();
    router.push("/login");
  };

  return (
    <div className="flex h-full flex-col justify-between p-3">
      <nav aria-label="Primary" className="flex flex-col gap-1">
        <div className="mb-4 px-2 pt-1">
          <p className="text-sm font-semibold tracking-tight text-foreground">Reserve Juggler</p>
          <p className="text-[11px] uppercase tracking-widest text-muted">Treasury terminal</p>
        </div>
        {navItems.map(({ href, label, icon: Icon, phase }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                active ? "bg-primary-soft text-foreground" : "text-muted hover:bg-surface-2 hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
              <span className="flex-1">{label}</span>
              {phase && <span className="text-[10px] text-muted">P{phase}</span>}
            </Link>
          );
        })}
      </nav>

      {user && (
        <div className="border-t border-border pt-3">
          <div className="flex items-center gap-2 rounded-md bg-surface-2/60 px-2 py-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/20 text-xs font-semibold text-primary">
              {user.displayName ? user.displayName.charAt(0).toUpperCase() : <UserIcon className="h-3.5 w-3.5" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-foreground">{user.displayName || "Treasury User"}</p>
              <p className="truncate text-[10px] text-muted">{user.email || (isMock ? "Mock User" : "")}</p>
            </div>
            <button
              onClick={handleSignOut}
              title="Sign out"
              aria-label="Sign out"
              className="rounded p-1 text-muted transition-colors hover:bg-surface hover:text-negative"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { user, isMock, signOut } = useAuth();
  const router = useRouter();

  const handleSignOut = async () => {
    await signOut();
    router.push("/login");
  };

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[232px_1fr]">
      <aside className="sticky top-0 hidden h-screen border-r border-border bg-surface lg:block">
        <Sidebar />
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button className="absolute inset-0 bg-black/60" aria-label="Close navigation" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-border bg-surface">
            <Sidebar onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/90 px-4 backdrop-blur">
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation" onClick={() => setOpen(true)}>
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </Button>
          <p className="text-sm text-muted">Digital bank · USD</p>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            {isMock ? (
              <Badge tone="info">Demo Auth</Badge>
            ) : user ? (
              <Badge tone="positive">Firebase Connected</Badge>
            ) : (
              <Badge tone="warning">Firebase not connected</Badge>
            )}
            <Badge tone="info">Sample data</Badge>
            {user && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSignOut}
                className="hidden text-xs text-muted hover:text-negative sm:inline-flex"
                title="Sign Out"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Sign Out</span>
              </Button>
            )}
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}

