"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/firebase/auth-context";
import { apiFetch } from "@/lib/api-client";
import type { DashboardSummaryPayload } from "@/app/api/dashboard/summary/route";

export type OrgRole = "admin" | "analyst" | "viewer";

export interface UseOrgRoleResult {
  role: OrgRole | null;
  loading: boolean;
  isLive: boolean;
}

/**
 * Hook to retrieve the authenticated user's verified role within the active organisation
 * from the server-side dashboard summary endpoint.
 */
export function useOrgRole(): UseOrgRoleResult {
  const { user, isMock } = useAuth();
  const [role, setRole] = useState<OrgRole | null>(null);
  const [loading, setLoading] = useState(true);

  const isLive = Boolean(user && !isMock);

  useEffect(() => {
    if (!isLive) return;

    let cancelled = false;
    apiFetch<DashboardSummaryPayload>("/api/dashboard/summary")
      .then((res) => {
        if (!cancelled && res.ok && res.data?.userRole) {
          const fetchedRole = res.data.userRole.toLowerCase();
          if (fetchedRole === "admin" || fetchedRole === "analyst" || fetchedRole === "viewer") {
            setRole(fetchedRole as OrgRole);
          } else {
            setRole("viewer");
          }
        }
      })
      .catch(() => {
        if (!cancelled) setRole("viewer");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isLive]);

  return {
    role: isLive ? role : null,
    loading: isLive ? loading : false,
    isLive,
  };
}
