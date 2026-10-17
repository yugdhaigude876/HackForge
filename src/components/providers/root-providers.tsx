"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "@/lib/firebase/auth-context";

export function RootProviders({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}
