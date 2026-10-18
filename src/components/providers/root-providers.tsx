"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "@/lib/firebase/auth-context";
import { ThemeProvider } from "./theme-provider";
import { DataSourceProvider } from "./data-source-provider";

export function RootProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <DataSourceProvider>{children}</DataSourceProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
