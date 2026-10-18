# Reserve Juggler — Institutional Design System & Telemetry Architecture

> **Specification & Component Guidelines for Algorithmic Treasury OS**  
> *Version 2.0-STABLE | Next.js 16 App Router · React 19 · Tailwind CSS 4 · Three.js GLSL · Recharts*

---

## 1. Executive Summary & Art Direction Synthesis

The Reserve Juggler design system bridges the aesthetic precision of tier-1 institutional trading terminals with the organic, kinetic beauty of real-time WebGL visualization (inspired by creative engineering studios like Lusion).

The interface synthesizes three distinct art directions:
1. **Reference 1 (Translucent Glass & Large Radii)**: Translucent glass cards (`rgba(17, 24, 39, 0.7)`), 20px–24px outer radii, refined segmented pills, and top-left specular hairlines.
2. **Reference 2 (Floating Rail & Bento Grid Structure)**: Dark obsidian navigation rail (`#070B14`) that remains dark in both dark and light modes, creating high-contrast authority. Crisp bento grids with dense sparklines and tabular financial metrics.
3. **Reference 3 (Near-Black Obsidian Canvas & Telemetry Rail)**: Near-black obsidian-navy canvas (`#0B1220` to `#070B14`), high-contrast functional telemetry accents, and a live execution rail streaming real-time sweeps, maturities, and cascade liquidations.

---

## 2. Token Architecture & Semantic Variables

All colors, surfaces, borders, and shadows are defined as semantic CSS custom properties in `src/app/globals.css`. Hard-coded hex values are strictly banned from UI components.

### 2.1 Color Tokens & Functional Roles

Colors in Reserve Juggler strictly signify **functional financial telemetry**. Purple, magenta, and lime green are prohibited as primary brand colors.

| Token | Dark Mode (`[data-theme="dark"]`) | Light Mode (`[data-theme="light"]`) | Functional Role |
| :--- | :--- | :--- | :--- |
| `--accent-blue` | `#3B82F6` (Electric Treasury Blue) | `#2563EB` | Primary brand accent, Tier 2 Sovereign Debt, forecast trajectory |
| `--accent-teal` | `#10B981` (Cyan Teal) | `#059669` | Solvency healthy status, Tier 1 Overnight Repo, positive yield |
| `--accent-gold` | `#F59E0B` (Institutional Gold) | `#D97706` | Basel III protected reserve floor ($R$), Tier 3 Equities, VaR uncertainty, warnings |
| `--accent-crimson` | `#EF4444` (Signal Crimson) | `#DC2626` | Deficit liquidations ($C < R$), overdraft shock hazard, under-reserved status |
| `--accent-indigo` | `#6366F1` (Deep Indigo) | `#4F46E5` | Repo auction window clock (17:00 UTC), timeline engine scrubbers |

### 2.2 Surface & Glass Tokens

| Token | Dark Mode | Light Mode | Description |
| :--- | :--- | :--- | :--- |
| `--background` | `#0B1220` (Obsidian Navy) | `#F3F1EC` (Warm Off-White) | Base canvas background |
| `--surface` | `rgba(17, 24, 39, 0.75)` | `#FCFBF9` | Primary card surface |
| `--surface-2` | `rgba(15, 23, 42, 0.65)` | `#F0ECE1` | Secondary nested surface / table headers |
| `--surface-raised` | `rgba(30, 41, 59, 0.85)` | `#FFFFFF` | Popovers, tooltips, dialogs |
| `--sidebar-bg` | `#070B14` | `#070B14` *(Theme Invariant)* | Dark floating navigation rail |
| `--border` | `rgba(255, 255, 255, 0.08)` | `#DED9CD` | Hairline border |
| `--border-strong` | `rgba(255, 255, 255, 0.16)` | `#C8C2B3` | High-emphasis interactive borders |
| `--glass-specular` | `rgba(255, 255, 255, 0.12)` | `rgba(255, 255, 255, 0.80)` | Top-left card specular highlight |

---

## 3. Typography Hierarchy

- **UI Copy**: `Geist Sans`, system sans-serif fallback. Tight kerning on uppercase section badges (`tracking-wider text-[11px] font-semibold`).
- **Telemetry & Financial Figures**: `Geist Mono` with strict `tabular-nums` formatting to ensure zero horizontal layout jitter during ticker updates.
- **KPI Metrics**: 28px–32px font size, `-0.03em` letter-spacing (`tracking-tight`), bold weight, accompanied by micro trend pills.

---

## 4. 3D WebGL Living Reservoir Architecture

Located on the public landing page (`src/components/landing/living-reservoir.tsx`), the Living Reservoir models the digital bank's $20M/hour cash flow dynamics using vanilla Three.js and custom GLSL vertex/fragment shaders.

### 4.1 Mathematical Formulation

Vertex displacement is evaluated analytically entirely on the GPU via 4D Simplex noise:

$$\vec{P}' = \vec{P} + \vec{N} \cdot \text{noise}(\vec{P} \cdot f + t \cdot \text{speed}) \cdot A$$

Where:
- $\vec{P}$ is the unit sphere vertex position
- $\vec{N}$ is the normal vector
- $f$ is noise frequency (baseline $0.85$)
- $\text{speed}$ is time multiplier ($0.30$)
- $A$ is displacement amplitude ($0.28$)

### 4.2 Dual-Layer Optical Composition

1. **Outer Fluid (Surplus Cash)**: High-refraction, translucent deep-sea obsidian (`#070B14` to `#0B1220`) with Fresnel rim lighting reflecting pointer coordinates with smooth exponential damping (`lerp(target, 0.05)`).
2. **Inner Nucleus (Basel III Reserve $R$)**: A dense, bioluminescent gold core (`#FBBF24`) visible through the outer fluid, representing the untouchable reserve floor:

$$R = \max(0, -(\mu_H + q_H(\alpha))) + F$$

### 4.3 Scrollytelling Progression

- **0% Scroll (Hero)**: Viscous resting state ($\text{speed} = 0.30$). Responsive to pointer turbulence.
- **30% Scroll (Volatility Shock)**: Frequency doubles to $2.2$, pulse ridges glow crimson (`uCrimsonShock`), representing sudden intraday outflow drawdowns.
- **60% Scroll (Phase Separation)**: Outer fluid pulls back (`uPullback = 0.85`) to reveal the golden Basel III reserve core remaining completely intact.
- **85% Scroll (4-Tier Routing)**: Surplus branches into floating glass nodes: Tier 1 Overnight Repo, Tier 2 Bonds, Tier 3 Equities.
- **100% Scroll (Terminal Entry)**: Camera aligns with an interactive 2.5D preview of the live workstation.

### 4.4 WebGL Performance Boundaries

- **Pixel Ratio Clamp**: `dpr = [1, Math.min(window.devicePixelRatio, 1.75)]`
- **Zero CPU Array Mutations**: All deformations occur purely in vertex shaders.
- **Demand Frameloop Throttling**: Pauses render cycles when offscreen (`IntersectionObserver`) or when pointer remains idle for $>2$ seconds.
- **Graceful Fallbacks**: Renders a rich CSS radial gradient core when WebGL is unavailable or when `prefers-reduced-motion: reduce` is active.

---

## 5. Universal Component Primitives Kit

Exported from `src/components/ui/primitives.tsx`:

- **`GlassCard`**: Translucent card with hairline specular border, rounded-2xl radii, and hover lift.
- **`HeroCard`**: Glass card featuring an ambient radial backdrop glow pinned behind the primary metric.
- **`StatCard`**: Tabular numeral metric with animated counter, sparkline slot, and trend badge.
- **`RangePills`**: Keyboard-navigable segmented timeline switches (`1D`, `1W`, `1M`, `6M`, `1Y`).
- **`ProgressRing`**: SVG circular gauge with animated stroke offset for reserve coverage ratio.
- **`AnimatedCounter`**: Kinetic rolling number animation using `requestAnimationFrame` with quartic ease-out.

---

## 6. Themed Financial Chart Kit

Exported from `src/components/charts/`:

- **`AreaTrendChart`**: Cubic bezier area with vertical gradient fill, dynamic crosshair, and floating glass tooltip.
- **`DonutChart`**: Centered total metric, 4-tier asset segments, and interactive hover explosion.
- **`BandChart`**: Forecast curve enveloped by 99% Value-at-Risk ($q_H$) uncertainty confidence bounds.
- **`WaterfallChart`**: Step-by-step visual derivation of the Basel III formula ($C \to \mu_H \to q_H \to F \to R$).

All charts read colors from `useChartTheme()`, ensuring instantaneous, flash-free toggling between dark and light modes.

---

## 7. Liquidation Waterfall Cascade Animation

When an outflow shock ($C < R$) triggers liquidation:
1. Tier 1 Repo (0.5% fee) highlights with a cyan pulse and depletes first.
2. Tier 2 Bonds (2.0% haircut) activates after a 300ms delay.
3. Tier 3 Equities (15.0% slippage) activates after a 600ms delay.
4. Confirms visually that the 12.0% emergency overdraft penalty was bypassed.

---

## 8. Accessibility & Compliance (WCAG AA)

- All text meets minimum 4.5:1 contrast against surface backgrounds.
- High-contrast telemetry badges meet 3:1 graphical contrast.
- Full keyboard support: `⌘K` command palette, `Tab` order on pills and tabs, arrow key navigation on sliders.
- Strict adherence to `prefers-reduced-motion: reduce`: WebGL pauses animation loops, counters render final values synchronously, and pulse animations are deactivated.
