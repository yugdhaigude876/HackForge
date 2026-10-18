"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Zap,
  Layers,
  Cpu,
  ChevronDown,
  Lock,
  Sparkles,
} from "lucide-react";
import { BrandLogo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Button } from "@/components/ui/primitives";
import { LivingReservoir } from "@/components/landing/living-reservoir";

export default function LandingPage() {
  const [scrollProgress, setScrollProgress] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Calculate normalized scroll progress [0, 1] across the scrollytelling container
  useEffect(() => {
    const handleScroll = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const totalHeight = containerRef.current.scrollHeight - window.innerHeight;
      if (totalHeight <= 0) return;
      
      const currentScroll = -rect.top;
      const progress = Math.min(Math.max(currentScroll / totalHeight, 0), 1);
      setScrollProgress(progress);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground transition-colors duration-150 selection:bg-accent-blue/30 selection:text-white">
      {/* 1. Public Top Navigation Bar */}
      <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-border bg-surface/80 px-6 lg:px-12 backdrop-blur-xl">
        <Link href="/" className="flex items-center gap-3">
          <BrandLogo size={34} />
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold tracking-tight text-sm text-foreground">RESERVE JUGGLER</span>
              <span className="rounded bg-accent-blue/15 border border-accent-blue/30 px-1.5 py-0.2 font-mono text-[9px] font-bold text-accent-blue">
                OS
              </span>
            </div>
            <p className="text-[10px] font-mono tracking-wider text-muted uppercase">
              Institutional Treasury Workstation
            </p>
          </div>
        </Link>

        {/* Center Nav Links */}
        <nav className="hidden md:flex items-center gap-6 text-xs font-semibold text-muted">
          <a href="#hero" className="hover:text-foreground transition-colors">
            Living Reservoir
          </a>
          <a href="#narrative" className="hover:text-foreground transition-colors">
            Cash Flow Dynamics
          </a>
          <a href="#routing" className="hover:text-foreground transition-colors">
            4-Tier Routing
          </a>
          <a href="#workstation" className="hover:text-foreground transition-colors">
            Terminal Preview
          </a>
        </nav>

        {/* Right CTA */}
        <div className="flex items-center gap-3">
          <ThemeToggle className="h-8 w-8 rounded-xl border border-border bg-surface-2" />
          <Link href="/dashboard">
            <Button variant="primary" size="sm" className="font-semibold text-xs shadow-md shadow-accent-blue/20">
              <span>Launch Workstation</span>
              <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </Link>
        </div>
      </header>

      {/* 2. Main Scrollytelling Canvas Section */}
      <div ref={containerRef} className="relative min-h-[350vh]">
        {/* Sticky WebGL Canvas Viewport pinned behind text chapters */}
        <div className="sticky top-16 h-[calc(100vh-4rem)] w-full overflow-hidden flex items-center justify-center pointer-events-auto">
          {/* Ambient background glows */}
          <div
            className="pointer-events-none absolute -top-40 left-1/2 h-[500px] w-[900px] -translate-x-1/2 rounded-full bg-accent-blue/10 blur-[130px]"
            aria-hidden="true"
          />
          <div
            className="pointer-events-none absolute bottom-10 left-1/4 h-[400px] w-[600px] rounded-full bg-accent-gold/10 blur-[100px]"
            aria-hidden="true"
          />

          {/* Living Reservoir 3D WebGL Canvas */}
          <div className="absolute inset-0 z-0">
            <LivingReservoir scrollProgress={scrollProgress} />
          </div>

          {/* Persistent Telemetry Pill in Bottom-Left of sticky viewport */}
          <div className="absolute bottom-6 left-6 z-10 hidden sm:flex items-center gap-2 rounded-xl border border-border/80 bg-surface/90 px-3.5 py-2 text-xs backdrop-blur-md shadow-lg">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-teal opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-accent-teal" />
            </span>
            <span className="font-mono text-[11px] text-muted">DYNAMIC FLOW:</span>
            <span className="font-mono text-[11px] font-bold text-foreground tabular-nums">
              $20,000,000 / HOUR
            </span>
            <div className="h-3 w-px bg-border mx-1" />
            <span className="font-mono text-[10px] text-accent-teal font-semibold">
              SCROLL PROGRESS: {Math.round(scrollProgress * 100)}%
            </span>
          </div>

          {/* Floating Tier Nodes overlay (Appears at scroll > 70%) */}
          <div
            className={`absolute right-6 top-1/2 -translate-y-1/2 z-10 hidden lg:flex flex-col gap-3 transition-all duration-500 pointer-events-none ${
              scrollProgress > 0.65 ? "opacity-100 translate-x-0" : "opacity-0 translate-x-8"
            }`}
          >
            <div className="rounded-xl border border-accent-blue/40 bg-surface/85 p-3 backdrop-blur-xl shadow-xl w-60">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-accent-blue">Tier 1: Overnight Repo</span>
                <span className="font-mono font-bold text-accent-teal">4.29% APY</span>
              </div>
              <p className="mt-1 text-[10px] text-muted font-mono">Swept 17:00 UTC · Zero Idle Drag</p>
            </div>

            <div className="rounded-xl border border-cyan-500/40 bg-surface/85 p-3 backdrop-blur-xl shadow-xl w-60">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-cyan-400">Tier 2: 2Y Sovereign Debt</span>
                <span className="font-mono font-bold text-cyan-400">4.80% YTM</span>
              </div>
              <p className="mt-1 text-[10px] text-muted font-mono">D_mod = 1.92 · T+1h Liquidity</p>
            </div>

            <div className="rounded-xl border border-accent-gold/40 bg-surface/85 p-3 backdrop-blur-xl shadow-xl w-60">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-accent-gold">Tier 3: Growth Equities</span>
                <span className="font-mono font-bold text-accent-gold">10.00% APY</span>
              </div>
              <p className="mt-1 text-[10px] text-muted font-mono">Surplus Yield Alpha · T+2h</p>
            </div>
          </div>
        </div>

        {/* 3. Scrollytelling Narrative Story Chapters */}
        <div className="relative z-10 -mt-[calc(100vh-4rem)]">
          {/* Chapter 1: Hero (0% Scroll) */}
          <section id="hero" className="flex min-h-screen flex-col justify-center px-6 lg:px-16 max-w-4xl pointer-events-none">
            <div className="pointer-events-auto space-y-5">
              <div className="inline-flex items-center gap-2 rounded-full border border-accent-blue/30 bg-accent-blue/10 px-3 py-1 text-xs font-semibold text-accent-blue backdrop-blur-md">
                <Sparkles className="h-3.5 w-3.5" />
                <span>Institutional Treasury Workstation · Basel III Ready</span>
              </div>

              <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-foreground leading-[1.08]">
                Algorithmic Liquidity for the{" "}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-accent-blue via-sky-400 to-accent-teal">
                  $20M/Hour Bank
                </span>
              </h1>

              <p className="text-base sm:text-lg text-muted max-w-2xl leading-relaxed">
                Eliminate idle cash drag. Dynamically calculate required liquid reserves using 99% Value-at-Risk,
                and deploy surplus capital across a 4-tier waterfall before the 17:00 UTC repo window closes.
              </p>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <Link href="/dashboard">
                  <Button variant="primary" size="md" className="h-11 px-6 font-semibold text-sm shadow-xl shadow-accent-blue/25">
                    <span>Enter Workstation Terminal</span>
                    <ArrowRight className="h-4 w-4 ml-1.5" />
                  </Button>
                </Link>

                <a href="#narrative">
                  <Button variant="outline" size="md" className="h-11 px-5 text-sm font-medium border-border hover:bg-surface-2">
                    <span>Explore Reservoir Dynamics</span>
                    <ChevronDown className="h-4 w-4 ml-1.5" />
                  </Button>
                </a>
              </div>
            </div>
          </section>

          {/* Chapter 2: Volatility Shock (30% Scroll) */}
          <section id="narrative" className="flex min-h-screen flex-col justify-center px-6 lg:px-16 max-w-2xl pointer-events-none">
            <div className="pointer-events-auto rounded-[24px] border border-border bg-surface/90 p-8 backdrop-blur-2xl shadow-2xl space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-accent-crimson/40 bg-accent-crimson/15 px-3 py-1 font-mono text-xs font-bold text-accent-crimson">
                <Zap className="h-3.5 w-3.5" />
                <span>30% Volatility Shock Event</span>
              </div>

              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                Acute Outflow Surges & Displacement Ridges
              </h2>

              <p className="text-sm text-muted leading-relaxed">
                As outbound transactions surge past nominal thresholds, the organic fluid core experiences
                analytical Simplex turbulence. Crimson veins pulse along displacement ridges, illustrating
                sudden liquidity drawdowns without look-ahead bias.
              </p>

              <div className="grid grid-cols-2 gap-3 pt-2 font-mono text-xs">
                <div className="rounded-xl border border-border bg-surface-2 p-3">
                  <span className="text-muted block text-[10px] uppercase">Peak Inflow Rate</span>
                  <span className="text-sm font-bold text-foreground">+$3.4M / Hr</span>
                </div>
                <div className="rounded-xl border border-accent-crimson/30 bg-accent-crimson/10 p-3">
                  <span className="text-accent-crimson block text-[10px] uppercase">Outflow Surge Shock</span>
                  <span className="text-sm font-bold text-accent-crimson">-35% Drawdown</span>
                </div>
              </div>
            </div>
          </section>

          {/* Chapter 3: Phase Separation (60% Scroll) */}
          <section className="flex min-h-screen flex-col justify-center px-6 lg:px-16 max-w-2xl pointer-events-none ml-auto">
            <div className="pointer-events-auto rounded-[24px] border border-border bg-surface/90 p-8 backdrop-blur-2xl shadow-2xl space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-accent-gold/40 bg-accent-gold/15 px-3 py-1 font-mono text-xs font-bold text-accent-gold">
                <Lock className="h-3.5 w-3.5" />
                <span>60% Phase Separation</span>
              </div>

              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                The Golden Basel III Reserve Floor
              </h2>

              <p className="text-sm text-muted leading-relaxed">
                As outer surplus liquidity is redeemed, the outer fluid pulls back to reveal the protected
                golden nucleus. Sized strictly via:
              </p>

              <div className="rounded-xl border border-accent-gold/30 bg-accent-gold/10 p-3.5 font-mono text-xs text-foreground text-center font-bold">
                R = max(0, -(μ_H + q_H(α))) + F + Z
              </div>

              <p className="text-xs text-muted leading-relaxed">
                Even during systemic panics, the operational floor ($15M) and 99% VaR tail buffer ($6M)
                remain completely unbreached.
              </p>
            </div>
          </section>

          {/* Chapter 4: 4-Tier Automated Waterfall (85% Scroll) */}
          <section id="routing" className="flex min-h-screen flex-col justify-center px-6 lg:px-16 max-w-2xl pointer-events-none">
            <div className="pointer-events-auto rounded-[24px] border border-border bg-surface/90 p-8 backdrop-blur-2xl shadow-2xl space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-accent-teal/40 bg-accent-teal/15 px-3 py-1 font-mono text-xs font-bold text-accent-teal">
                <Layers className="h-3.5 w-3.5" />
                <span>85% Automated 4-Tier Routing</span>
              </div>

              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                Streamline Dispatch & Zero Drag
              </h2>

              <p className="text-sm text-muted leading-relaxed">
                Unencumbered surplus cash branches along animated streamlines into 3 yield vaults sorted by net unit value:
                Tier 1 Overnight Repo (0.5% fee), Tier 2 Sovereign Bonds (2.0% haircut), and Tier 3 Equities (15.0% slippage).
              </p>

              <div className="space-y-2 pt-2 text-xs">
                <div className="flex items-center justify-between p-2.5 rounded-lg border border-border bg-surface-2">
                  <span className="font-semibold">Tier 1: Overnight Repo</span>
                  <span className="font-mono text-accent-teal font-bold">4.29% APY · $25M Cap</span>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-lg border border-border bg-surface-2">
                  <span className="font-semibold">Tier 2: 2Y Sovereign Debt</span>
                  <span className="font-mono text-cyan-400 font-bold">4.80% YTM · $15M Cap</span>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-lg border border-border bg-surface-2">
                  <span className="font-semibold">Tier 3: Growth Equities</span>
                  <span className="font-mono text-accent-gold font-bold">10.00% APY · $10M Cap</span>
                </div>
              </div>
            </div>
          </section>

          {/* Chapter 5: Terminal Entry Preview (100% Scroll) */}
          <section id="workstation" className="flex min-h-screen flex-col justify-center items-center px-6 lg:px-16 pointer-events-none">
            <div className="pointer-events-auto w-full max-w-3xl rounded-[28px] border border-border-strong bg-surface-raised p-8 lg:p-10 backdrop-blur-2xl shadow-2xl space-y-6 text-center transform perspective-1000">
              <div className="inline-flex items-center gap-2 rounded-full border border-accent-blue/30 bg-accent-blue/10 px-3.5 py-1 text-xs font-semibold text-accent-blue">
                <Cpu className="h-4 w-4" />
                <span>100% Terminal Convergence</span>
              </div>

              <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-foreground">
                Enter the Live Treasury Workstation
              </h2>

              <p className="text-sm sm:text-base text-muted max-w-xl mx-auto leading-relaxed">
                Experience the institutional workstation with real-time Monte Carlo digital twins,
                deterministic Basel III explanations, and sub-16ms stress-testing simulation.
              </p>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-xs pt-2">
                <div className="rounded-xl border border-border bg-surface-2 p-3 text-center">
                  <span className="text-muted block text-[10px] uppercase">Available Cash</span>
                  <span className="text-base font-bold text-foreground">$50.0M</span>
                </div>
                <div className="rounded-xl border border-accent-gold/30 bg-accent-gold/10 p-3 text-center">
                  <span className="text-accent-gold block text-[10px] uppercase">Required Reserve</span>
                  <span className="text-base font-bold text-accent-gold">$16.5M</span>
                </div>
                <div className="rounded-xl border border-accent-teal/30 bg-accent-teal/10 p-3 text-center">
                  <span className="text-accent-teal block text-[10px] uppercase">Surplus Deployed</span>
                  <span className="text-base font-bold text-accent-teal">$33.5M</span>
                </div>
                <div className="rounded-xl border border-accent-blue/30 bg-accent-blue/10 p-3 text-center">
                  <span className="text-accent-blue block text-[10px] uppercase">Net Portfolio APY</span>
                  <span className="text-base font-bold text-accent-blue">+4.62%</span>
                </div>
              </div>

              <div className="pt-4 flex flex-wrap justify-center gap-4">
                <Link href="/dashboard">
                  <Button variant="primary" size="md" className="h-12 px-8 font-bold text-sm shadow-xl shadow-accent-blue/30">
                    <span>Launch Live Workstation</span>
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </Link>

                <Link href="/login">
                  <Button variant="outline" size="md" className="h-12 px-6 font-medium text-sm border-border hover:bg-surface-2">
                    <span>Operator Sign In</span>
                  </Button>
                </Link>
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* 4. Institutional Footer */}
      <footer className="border-t border-border bg-surface-card px-6 lg:px-12 py-10 text-xs text-muted">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <BrandLogo size={26} />
            <span className="font-semibold text-foreground">Reserve Juggler Treasury OS</span>
            <span className="text-muted/60">·</span>
            <span>Version 0.2.0</span>
          </div>

          <p className="text-center sm:text-right text-[11px] leading-relaxed max-w-md">
            Probabilistic liquidity reserve does not constitute a credit guarantee. Modeled under stationary
            backtested residual assumptions in accordance with Basel III LCR standards.
          </p>
        </div>
      </footer>
    </div>
  );
}
