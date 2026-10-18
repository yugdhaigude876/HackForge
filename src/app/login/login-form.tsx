"use client";

import React, { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/firebase/auth-context";
import { GlassCard, Button, Input, Label, Badge } from "@/components/ui/primitives";
import { BrandLogo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { LivingReservoir } from "@/components/landing/living-reservoir";
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
  Layers,
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
    isUnconfigured,
    signInWithEmail,
    signUpWithEmail,
    signInWithGoogle,
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

  const activeError = localError || authError;

  return (
    <div className="min-h-screen w-full lg:grid lg:grid-cols-2 bg-background text-foreground transition-colors">
      {/* Left Pane: Institutional 3D Visual & Brand Hero */}
      <div className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-[#070B14] p-10 xl:p-14 border-r border-sidebar-border text-white select-none">
        {/* 3D Fluid Living Reservoir Canvas */}
        <div className="absolute inset-0 pointer-events-none opacity-60">
          <LivingReservoir scrollProgress={0.15} className="h-full w-full" />
        </div>

        {/* Ambient Top Specular */}
        <div className="absolute top-0 left-0 right-0 h-40 bg-gradient-to-b from-[#0B1220]/80 to-transparent pointer-events-none z-10" />
        <div className="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-[#070B14] to-transparent pointer-events-none z-10" />

        {/* Top Brand Tagline */}
        <div className="relative z-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BrandLogo size={36} />
            <div>
              <span className="font-bold text-sm tracking-widest text-white">RESERVE JUGGLER</span>
              <span className="block text-[10px] font-mono text-[#38BDF8] tracking-wider uppercase">
                INSTITUTIONAL TREASURY OS
              </span>
            </div>
          </div>
          <span className="rounded-full bg-white/10 px-3 py-1 font-mono text-[11px] font-semibold text-emerald-400 border border-white/10 backdrop-blur-md">
            ● ENGINE LIVE
          </span>
        </div>

        {/* Center Institutional Narrative */}
        <div className="relative z-20 max-w-lg space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full bg-blue-500/10 border border-blue-500/20 px-3 py-1 text-xs text-blue-400 font-mono">
            <Layers className="h-3.5 w-3.5" />
            <span>Basel III Probabilistic Solvency Core</span>
          </div>

          <h2 className="text-3xl xl:text-4xl font-extrabold tracking-tight leading-tight text-white">
            Algorithmic Liquidity for High-Velocity Digital Banking
          </h2>

          <p className="text-sm text-slate-400 leading-relaxed">
            Eliminate idle cash drag through automated 4-tier waterfall deployment while maintaining 99% Value-at-Risk statutory solvency buffers.
          </p>

          {/* Institutional Telemetry Metric Cards */}
          <div className="grid grid-cols-2 gap-3 pt-2">
            <div className="rounded-xl border border-white/10 bg-white/5 p-3.5 backdrop-blur-md">
              <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">Yield Alpha</span>
              <div className="text-lg font-bold font-mono text-emerald-400 mt-0.5 tabular-nums">+4.29% APY</div>
              <p className="text-[10px] text-slate-400 mt-1">vs. 0.0% Naive Checking Baseline</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3.5 backdrop-blur-md">
              <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">Tail-Risk Buffer</span>
              <div className="text-lg font-bold font-mono text-blue-400 mt-0.5 tabular-nums">99% VaR</div>
              <p className="text-[10px] text-slate-400 mt-1">Bypasses 12% Emergency Overdrafts</p>
            </div>
          </div>
        </div>

        {/* Bottom Disclaimer */}
        <div className="relative z-20 flex items-center justify-between text-xs text-slate-500 font-mono border-t border-white/10 pt-4">
          <span>AES-256 HSM Cryptographic Ledger</span>
          <span>v0.2.0-STABLE</span>
        </div>
      </div>

      {/* Right Pane: Authentication Terminal Workstation */}
      <div className="relative flex min-h-screen flex-col justify-between p-6 sm:p-10 lg:p-12 xl:p-16">
        {/* Top Action Bar with Theme Toggle */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 lg:hidden">
            <BrandLogo size={28} />
            <span className="font-bold text-xs tracking-wider uppercase text-foreground">
              TREASURY TERMINAL
            </span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle className="h-8 w-8 rounded-lg border border-border bg-surface-2" />
          </div>
        </div>

        {/* Center Auth Card */}
        <div className="mx-auto w-full max-w-md my-auto py-8">
          {/* Header */}
          <div className="mb-6 space-y-1.5 text-center lg:text-left">
            <div className="flex items-center gap-2 lg:justify-start justify-center">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                Reserve Juggler
              </h1>
              <span className="rounded-md bg-accent-blue/15 px-2 py-0.5 text-[10px] font-mono font-bold text-accent-blue border border-accent-blue/30">
                TERMINAL
              </span>
            </div>
            <p className="text-xs text-muted">
              Institutional Liquidity & Risk Management Terminal Access
            </p>
          </div>

          <GlassCard className="p-6 sm:p-7 shadow-2xl">
            {/* Environment Status Badge */}
            <div className="mb-5 flex items-center justify-between border-b border-border pb-3.5 text-xs">
              <span className="text-muted font-medium">Auth Engine</span>
              {isUnconfigured ? (
                <Badge tone="warning" className="gap-1">
                  <AlertCircle className="h-3 w-3" />
                  Unconfigured
                </Badge>
              ) : isMock ? (
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

            {isUnconfigured ? (
              <div className="space-y-4" data-testid="auth-unconfigured-state">
                <div className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4 text-xs text-warning">
                  <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
                  <div className="space-y-1">
                    <p className="font-semibold text-sm">Authentication is not configured</p>
                    <p className="text-muted leading-relaxed">
                      This deployment does not have Firebase credentials configured, and mock authentication is disabled in production to fail closed.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {/* Mode Switch Tabs */}
                <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1 text-xs" role="tablist">
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
                    className={`rounded-lg py-2 font-medium transition-all ${
                      mode === "signin"
                        ? "bg-accent-blue text-white shadow-sm"
                        : "text-muted hover:text-foreground"
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
                    className={`rounded-lg py-2 font-medium transition-all ${
                      mode === "signup"
                        ? "bg-accent-blue text-white shadow-sm"
                        : "text-muted hover:text-foreground"
                    }`}
                  >
                    Create Account
                  </button>
                </div>

                {/* Error Banner */}
                {activeError && (
                  <div
                    role="alert"
                    className="mb-4 rounded-xl border border-negative/40 bg-negative/10 p-3 text-xs text-negative"
                  >
                    <div className="flex items-start gap-2">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      <div className="flex-1 font-medium">{activeError}</div>
                      <button
                        type="button"
                        onClick={() => {
                          setLocalError(null);
                          clearError();
                        }}
                        className="text-negative hover:underline font-bold text-sm leading-none"
                        aria-label="Dismiss error"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                )}

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
                        <span className="text-[11px] text-muted hover:text-accent-blue cursor-pointer">
                          Forgot password?
                        </span>
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
                    className="w-full font-semibold bg-accent-blue hover:opacity-90 text-white shadow-lg shadow-accent-blue/20"
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
                <div className="relative my-5 text-center text-xs">
                  <div className="absolute inset-0 flex items-center" aria-hidden="true">
                    <div className="w-full border-t border-border" />
                  </div>
                  <span className="relative bg-surface px-2.5 text-muted font-mono text-[11px]">
                    Or continue with
                  </span>
                </div>

                {/* Google Auth Button */}
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleGoogleSignIn}
                  disabled={submitting || authLoading}
                  className="w-full bg-surface-2 hover:bg-surface-raised text-xs font-medium border-border"
                >
                  <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24" aria-hidden="true">
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
              </>
            )}
          </GlassCard>
        </div>

        {/* Security & Disclaimer Footer */}
        <div className="text-center text-[11px] text-muted font-mono py-2">
          Institutional grade security · AES-256 encrypted session · Audit logging active
        </div>
      </div>
    </div>
  );
}
