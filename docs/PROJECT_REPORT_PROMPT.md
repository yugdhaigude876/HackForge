# Reserve Juggler — Project Report Prompt (reusable)

Copy everything below the line into a new Claude session to generate or refresh the project report.

---

Act as a senior fintech software architect and technical writer. Write a professional, concise project report for **Reserve Juggler**, our hackathon (advanced track, "The Idle Cash Problem") project, in repo `https://github.com/yugdhaigude876/HackForge`.

## Ground rules
- Read `docs/` and the code in the repo first; report only what actually exists. Do not invent results, benchmarks or yield improvements.
- Mark every claim as **Verified** (official source linked), **Unverified**, or **Hypothesis**.
- A probabilistic liquidity reserve is not a guarantee that every payout is funded; say so wherever relevant.
- Keep it brief: executive summary first, then sections, tables over prose.

## Project in one paragraph
A digital bank processes ~$20M/hour in deposits, withdrawals and merchant settlements. Reserve Juggler forecasts net cash flow, computes a risk-based liquid reserve, and allocates the surplus to short-term yield instruments, net of withdrawal penalties and settlement delays, then stress-tests the result in a "Liquidity Digital Twin".

## Stack
Next.js 16 (App Router) · React 19 · TypeScript strict · Tailwind CSS 4 · shadcn-style primitives (cva + cn) · Recharts · Zod · Firebase Auth + Firestore (planned) · Vitest (planned) · Vercel.

## Done so far (as of commit f09ebf2, local, not yet pushed)
| Item | State |
|---|---|
| Problem analysis and research (Vercel limits, Firestore rules, Firebase Admin, Next.js route handlers, forecasting benchmarks, Basel III LCR) | Done; competitor claims **Unverified** |
| Five docs: PROJECT_REPORT, ARCHITECTURE, FINANCIAL_MODEL, DATA_MODEL, IMPLEMENTATION_PLAN | Done |
| Next.js app scaffold, strict TS, Tailwind, dark-first design tokens | Done |
| Responsive shell: sidebar, top bar, mobile drawer | Done |
| Dashboard: KPI cards, net-flow chart, instruments table, loading/empty/error states | Done, **sample data only**, labelled |
| Placeholder pages for Forecast, Reserve, Optimizer, Digital Twin, Analytics, Settings | Done (marked "Planned for Phase N") |
| Lint, `tsc --noEmit`, production build, browser check at desktop and phone width | Passed |
| Forecasting, reserve, optimiser, Firebase, API routes, tests | **Not started** |

## Phase-wise implementation (small phases for tracking)
Each phase ends with: tests pass, lint/tsc/build pass, docs updated.

| # | Phase | Deliverable | Status |
|---|---|---|---|
| 0 | Research and docs | Five docs in `docs/` | Done |
| 1 | Scaffold and tooling | Next.js, strict TS, Tailwind, lint | Done |
| 2 | Design tokens and app shell | Sidebar, top bar, theme | Done |
| 3 | Sample-data dashboard | KPI cards, chart, table, states | Done |
| 4 | Money module and test setup | Integer/BigInt money, Vitest, unit tests | Done |
| 5 | Synthetic transaction generator | Seeded, reproducible deposits/withdrawals/settlements | Done |
| 6 | Hourly aggregation | Transactions to hourly net-flow series | Done |
| 7 | Baseline forecasters and backtest harness | Naive, seasonal naive, rolling-origin evaluation | Done |
| 8 | Hour-of-week smoothing forecaster | Model plus MASE and pinball metrics vs baseline | Done |
| 9 | Reserve calculation | Residual quantiles, reserve, deployable surplus | Done |
| 10 | Optimiser | Allocation across instruments with penalties and capacity | Done |
| 11 | Insufficient-funds and low-confidence handling | `UNDER_RESERVED`, `LOW_CONFIDENCE` paths | Done |
| 12 | API routes | Route Handlers plus Zod, typed responses | Done |
| 13 | Firebase client auth | Sign-in UI (needs Firebase project) | Done |
| 14 | Server auth and authorisation | ID-token verify, org membership checks | Done |
| 15 | Firestore repos and rules | Repositories, rules, emulator tests | Done (repos, rules, indexes, unit tests verified; emulator tests not executed due to missing Java) |
| 16 | Persistence, audit, and dual-theme dashboard redesign | Persist forecasts, decisions, append-only SHA-256 audit records; read endpoints; dual-theme system (dark + soft off-white); dashboard redesign | Done (verified with 239 Vitest tests, lint, tsc, build, and browser subagent desktop & mobile verification) |
| 17 | Wire dashboard to engine | Replace sample data with real engine output | Done (verified with 263 Vitest tests, lint, tsc, build, and browser subagent desktop & mobile verification in sample/mock mode) |
| 18 | Stress scenario simulator | Outflow shock, settlement delay, run | Done (pure TS Monte Carlo engine in `src/engine/simulate.ts` with bootstrap residuals, 3 policies, liquidation & emergency borrowing, `/api/simulations` endpoints, persistence + audit, interactive dashboard stress panel; verified with 292 Vitest tests, lint, tsc, build, and browser verification in sample/mock mode) |
| 19 | Digital twin UI | Scenario replay, policy comparison | Done (multi-policy simulation with Common Random Numbers, `POST /api/simulations/compare`, `GET /api/simulations/compare/[comparisonId]`, Digital Twin UI at `/twin` with scenario builder presets, overlaid policy cash paths + p5-p95 bands, comparison table with deltas and descriptive winner badges, interactive keyboard-accessible replay scrubber, comparison history; verified with 317 Vitest tests, lint, tsc, and production build) |
| 20 | Analytics and explainability | Metrics vs baselines, decision explanations | Done (metrics evaluated on identical rolling-origin windows vs Naive and Seasonal Naive, MASE with zero-scale fallback, pinball loss, skill scores, interval coverage; `GET /api/analytics/forecast`, `GET /api/analytics/policies`; deterministic non-LLM decision explanations in `explain.ts` added to `GET /api/decisions/[id]`; four dedicated full pages `/forecast`, `/reserve`, `/optimizer`, `/analytics`; verified with 346 Vitest tests, ESLint, tsc, Next.js 16 build, and browser verification in both dark and light modes at desktop and mobile widths) |
| 21 | Security and reliability | Hardening, rate limits, e2e tests | Todo |
| 22 | Vercel deployment | Live URL, documented env vars | Todo |
| 23 | Demo and final report | Demo script, final report with measured results | Todo |

Dependencies: 13 needs Firebase credentials from the team; 5-11 can proceed with no external access; 17 needs 6-11 and 12.

## Report structure to produce
1. Executive summary (5 lines) 2. Problem and constraints 3. Approach (forecast, reserve, optimiser) 4. Architecture (one diagram) 5. Progress table (above) 6. Results (only measured, with seed and method; otherwise "not yet measured") 7. Risks and limitations 8. Next three phases 9. References (working URLs).
