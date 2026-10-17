"use client";

import React, { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/firebase/auth-context";
import { Card, Skeleton } from "@/components/ui/primitives";
import { ShieldCheck, Loader2 } from "lucide-react";

export interface AuthGuardProps {
  children: ReactNode;
  fallback?: ReactNode;
}

export function AuthGuard({ children, fallback }: AuthGuardProps) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) {
      const redirectUrl = pathname ? `/login?redirect=${encodeURIComponent(pathname)}` : "/login";
      router.replace(redirectUrl);
    }
  }, [loading, user, router, pathname]);

  if (loading) {
    if (fallback) return <>{fallback}</>;
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4" data-testid="auth-guard-loading">
        <Card className="w-full max-w-md border-border/80 bg-surface/90 p-6 shadow-2xl backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ShieldCheck className="h-5 w-5 animate-pulse" />
            </div>
            <div>
              <p className="text-sm font-semibold tracking-tight text-foreground">Reserve Juggler</p>
              <p className="text-xs text-muted">Verifying institutional credentials...</p>
            </div>
            <Loader2 className="ml-auto h-4 w-4 animate-spin text-primary" />
          </div>
          <div className="mt-5 space-y-2">
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
          </div>
        </Card>
      </div>
    );
  }

  if (!user) {
    // While router.replace takes effect
    return (
      <div className="flex min-h-screen items-center justify-center bg-background" data-testid="auth-guard-redirecting">
        <div className="flex items-center gap-2 text-xs text-muted">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span>Redirecting to authentication portal...</span>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

/**
 * Higher-Order Component to protect any page or component with authentication.
 */
export function withAuth<P extends object>(
  Component: React.ComponentType<P>,
  options?: { fallback?: ReactNode },
): React.FC<P> {
  const AuthenticatedComponent: React.FC<P> = (props: P) => {
    return (
      <AuthGuard fallback={options?.fallback}>
        <Component {...props} />
      </AuthGuard>
    );
  };
  AuthenticatedComponent.displayName = `withAuth(${Component.displayName || Component.name || "Component"})`;
  return AuthenticatedComponent;
}
