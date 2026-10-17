"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "@/lib/firebase/auth-context";
import { ThemeProvider } from "./theme-provider";

export function RootProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <AuthProvider>{children}</AuthProvider>
    </ThemeProvider>
  );
}
