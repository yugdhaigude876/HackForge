"use client";

import React, { useState, type ReactNode } from "react";
import { Menu, Search } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { cn } from "@/lib/utils";
import { Sidebar } from "./sidebar";
import { CommandPalette } from "./command-palette";
import { ClockDriver } from "./clock-driver";
import { SidebarProvider, useSidebar } from "./sidebar-context";

function Shell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { collapsed } = useSidebar();

  return (
    <div
      data-testid="app-shell"
      data-sidebar-collapsed={collapsed ? "true" : "false"}
      className={cn(
        "min-h-screen bg-background text-foreground lg:grid transition-[grid-template-columns] duration-300 ease-out",
        collapsed ? "lg:grid-cols-[76px_1fr]" : "lg:grid-cols-[250px_1fr]"
      )}
    >
      {/* Desktop sidebar: expanded or collapsed to an icon rail */}
      <aside className="sticky top-0 hidden h-screen bg-sidebar-bg border-r border-sidebar-border lg:block z-30 overflow-y-auto overflow-x-hidden">
        <Sidebar />
      </aside>

      {/* Mobile drawer (always expanded) */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Mobile Navigation">
          <button
            className="absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-72 bg-sidebar-bg border-r border-sidebar-border shadow-2xl animate-in slide-in-from-left duration-200 overflow-y-auto">
            <Sidebar forceExpanded onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-col">
        {/* Compact header for pages that do not render their own top bar, and for mobile */}
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border bg-surface/80 px-4 backdrop-blur-xl lg:hidden">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="text-muted hover:text-foreground"
              aria-label="Open navigation"
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>
            <span className="font-bold text-xs tracking-wider uppercase text-foreground">RESERVE JUGGLER</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPaletteOpen(true)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface-2 text-muted"
              aria-label="Search or command"
            >
              <Search className="h-4 w-4" />
            </button>
            <ThemeToggle className="h-8 w-8 rounded-lg border border-border bg-surface-2" />
          </div>
        </header>

        <main className="w-full flex-1 p-3 sm:p-5 lg:p-6 max-w-[1720px] mx-auto min-w-0">{children}</main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <ClockDriver />
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <Shell>{children}</Shell>
    </SidebarProvider>
  );
}
