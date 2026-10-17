"use client";

import React, { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/firebase/auth-context";
import { Card, Button, Input, Label, Badge } from "@/components/ui/primitives";
import {
  ShieldCheck,
  Lock,
  Mail,
  User as UserIcon,
  Eye,
  EyeOff,
  AlertCircle,
  Loader2,
  Sparkles,
  Zap,
} from "lucide-react";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectUrl = searchParams.get("redirect") || "/dashboard";

  const {
    user,
    loading: authLoading,
    error: authError,
    isMock,
    signInWithEmail,
    signUpWithEmail,
    signInWithGoogle,
    signInAsDemoUser,
    clearError,
  } = useAuth();

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // If already authenticated, redirect immediately
  useEffect(() => {
    if (!authLoading && user) {
      router.replace(redirectUrl);
    }
  }, [user, authLoading, router, redirectUrl]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    clearError();

    if (!email.trim()) {
      setLocalError("Please enter your email address.");
      return;
    }
    if (!password) {
      setLocalError("Please enter your password.");
      return;
    }
    if (mode === "signup" && password.length < 6) {
      setLocalError("Password must be at least 6 characters.");
      return;
    }

    setSubmitting(true);
    try {
      if (mode === "signin") {
        await signInWithEmail(email, password);
      } else {
        await signUpWithEmail(email, password, displayName);
      }
      router.replace(redirectUrl);
    } catch (err) {
      // Error is set in AuthContext or thrown
      if (err instanceof Error) {
        setLocalError(err.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLocalError(null);
    clearError();
    setSubmitting(true);
    try {
      await signInWithGoogle();
      router.replace(redirectUrl);
    } catch (err) {
      if (err instanceof Error) {
        setLocalError(err.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDemoSignIn = async (role: "analyst" | "risk_officer" | "cfo") => {
    setLocalError(null);
    clearError();
    setSubmitting(true);
    try {
      await signInAsDemoUser(role);
      router.replace(redirectUrl);
    } catch (err) {
      if (err instanceof Error) {
        setLocalError(err.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const activeError = localError || authError;

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-background p-4 sm:p-6 lg:p-8">
      {/* Subtle radial ambient background glow */}
      <div
        className="pointer-events-none absolute -top-40 left-1/2 h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-primary/10 blur-[120px]"
        aria-hidden="true"
      />

      <div className="relative w-full max-w-md space-y-6">
        {/* Logo and Terminal Brand Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary shadow-lg shadow-primary/10">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Reserve Juggler</h1>
            <p className="text-xs uppercase tracking-widest text-muted">Institutional Liquidity & Risk Terminal</p>
          </div>
        </div>

        {/* Main Card */}
        <Card className="border-border/80 bg-surface/90 p-6 shadow-2xl backdrop-blur sm:p-8">
          {/* Environment Status Badge */}
          <div className="mb-6 flex items-center justify-between border-b border-border pb-4 text-xs">
            <span className="text-muted">Auth Engine</span>
            {isMock ? (
              <Badge tone="info" className="gap-1">
                <Sparkles className="h-3 w-3" />
                Local Mock Mode
              </Badge>
            ) : (
              <Badge tone="positive" className="gap-1">
                <ShieldCheck className="h-3 w-3" />
                Firebase Live
              </Badge>
            )}
          </div>

          {/* Mode Switch Tabs */}
          <div className="mb-6 grid grid-cols-2 gap-1 rounded-lg bg-surface-2 p-1 text-xs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "signin"}
              data-testid="tab-signin"
              onClick={() => {
                setMode("signin");
                setLocalError(null);
                clearError();
              }}
              className={`rounded-md py-1.5 font-medium transition-colors ${
                mode === "signin" ? "bg-primary text-white shadow-sm" : "text-muted hover:text-foreground"
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "signup"}
              data-testid="tab-signup"
              onClick={() => {
                setMode("signup");
                setLocalError(null);
                clearError();
              }}
              className={`rounded-md py-1.5 font-medium transition-colors ${
                mode === "signup" ? "bg-primary text-white shadow-sm" : "text-muted hover:text-foreground"
              }`}
            >
              Create Account
            </button>
          </div>

          {/* Error Banner */}
          {activeError && (
            <div
              role="alert"
              className="mb-4 flex items-start gap-2 rounded-md border border-negative/40 bg-negative/10 p-3 text-xs text-negative"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="flex-1">{activeError}</div>
              <button
                type="button"
                onClick={() => {
                  setLocalError(null);
                  clearError();
                }}
                className="text-negative hover:underline"
              >
                ×
              </button>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} noValidate className="space-y-4">

            {mode === "signup" && (
              <div className="space-y-1.5">
                <Label htmlFor="displayName">Full Name</Label>
                <div className="relative">
                  <UserIcon className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" />
                  <Input
                    id="displayName"
                    type="text"
                    placeholder="Marcus Sterling"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="pl-9"
                    autoComplete="name"
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="email">Work Email</Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" />
                <Input
                  id="email"
                  type="email"
                  placeholder="analyst@reservejuggler.internal"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-9"
                  autoComplete="email"
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                {mode === "signin" && (
                  <span className="text-[11px] text-muted hover:text-primary cursor-pointer">Forgot password?</span>
                )}
              </div>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-9 pr-9"
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-2.5 text-muted hover:text-foreground"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              variant="primary"
              disabled={submitting || authLoading}
              className="w-full font-semibold shadow-md shadow-primary/20"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Authenticating...</span>
                </>
              ) : mode === "signin" ? (
                "Sign In to Terminal"
              ) : (
                "Create Account"
              )}
            </Button>
          </form>

          {/* Social Sign-in Divider */}
          <div className="relative my-6 text-center text-xs">
            <div className="absolute inset-0 flex items-center" aria-hidden="true">
              <div className="w-full border-t border-border" />
            </div>
            <span className="relative bg-surface px-2 text-muted">Or continue with</span>
          </div>

          {/* Google Auth Button */}
          <Button
            type="button"
            variant="outline"
            onClick={handleGoogleSignIn}
            disabled={submitting || authLoading}
            className="w-full bg-surface-2 hover:bg-surface-2/80 text-xs font-medium"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                fill="#EA4335"
              />
            </svg>
            <span>Continue with Google</span>
          </Button>

          {/* Quick Demo Personas (Hackathon / Team Evaluation) */}
          <div className="mt-6 rounded-md border border-border/60 bg-surface-2/40 p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
              <Zap className="h-3 w-3 text-warning" />
              <span>One-Click Demo Personas</span>
            </div>
            <p className="mt-1 text-[11px] text-muted">Instant authorization for development and testing:</p>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleDemoSignIn("analyst")}
                disabled={submitting}
                className="text-[11px] h-7 px-2.5 bg-surface hover:bg-surface-2"
              >
                ⚡ Analyst
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleDemoSignIn("risk_officer")}
                disabled={submitting}
                className="text-[11px] h-7 px-2.5 bg-surface hover:bg-surface-2"
              >
                🛡️ Risk Officer
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleDemoSignIn("cfo")}
                disabled={submitting}
                className="text-[11px] h-7 px-2.5 bg-surface hover:bg-surface-2"
              >
                💼 Treasury CFO
              </Button>
            </div>
          </div>
        </Card>

        {/* Security & Disclaimer Footer */}
        <p className="text-center text-[11px] text-muted">
          Institutional grade security · AES-256 encrypted session · Audit logging active
        </p>
      </div>
    </div>
  );
}
