"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

const STORAGE_KEY = "rj.sidebar.collapsed";

interface SidebarContextValue {
  /** Desktop sidebar is collapsed to an icon rail. */
  collapsed: boolean;
  toggle: () => void;
  setCollapsed: (value: boolean) => void;
}

const SidebarContext = createContext<SidebarContextValue>({
  collapsed: false,
  toggle: () => undefined,
  setCollapsed: () => undefined,
});

function readStored(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeStored(value: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {
    // Storage can be blocked (private mode, blocked site data). The sidebar still works for the session.
  }
}

/**
 * Holds the desktop sidebar state. The choice is remembered in localStorage (best effort) and can be
 * toggled with Ctrl+B / Cmd+B. Starts expanded on the server and first paint to avoid a hydration mismatch.
 */
export function SidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsedState] = useState(false);

  useEffect(() => {
    // Defer to a frame so the stored value is applied after hydration.
    const id = requestAnimationFrame(() => setCollapsedState(readStored()));
    return () => cancelAnimationFrame(id);
  }, []);

  const setCollapsed = useCallback((value: boolean) => {
    setCollapsedState(value);
    writeStored(value);
  }, []);

  const toggle = useCallback(() => {
    setCollapsedState((prev) => {
      const next = !prev;
      writeStored(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "b") {
        const el = e.target as HTMLElement | null;
        const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
        if (typing) return;
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  const value = useMemo(() => ({ collapsed, toggle, setCollapsed }), [collapsed, toggle, setCollapsed]);
  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebar(): SidebarContextValue {
  return useContext(SidebarContext);
}
