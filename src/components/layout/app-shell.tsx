"use client";

import React, { useState, type ReactNode } from "react";
import { Menu, Search } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Sidebar } from "./sidebar";
import { CommandPalette } from "./command-palette";

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[250px_1fr] transition-colors duration-150">
      {/* Desktop Left Sidebar: Floating Dark Rail */}
      <aside className="sticky top-0 hidden h-screen bg-sidebar-bg border-r border-sidebar-border lg:block z-30">
        <Sidebar />
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Mobile Navigation"
        >
          <button
            className="absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-72 bg-sidebar-bg border-r border-sidebar-border shadow-2xl animate-in slide-in-from-left duration-200">
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-col">
        {/* Global Workstation Header Banner */}
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
            <span className="font-bold text-xs tracking-wider uppercase text-foreground">
              RESERVE JUGGLER
            </span>
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

        {/* Workstation Canvas */}
        <main className="w-full flex-1 p-3 sm:p-5 lg:p-6 max-w-[1720px] mx-auto min-w-0">
          {children}
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
