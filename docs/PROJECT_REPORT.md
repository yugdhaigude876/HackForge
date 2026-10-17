# Reserve Juggler — Project Report

Status: pre-implementation analysis. Research items are marked **[Verified]** (checked against the linked official source), **[Unverified]** (not checked; needs follow-up) or **[Hypothesis]** (product opinion).

## 1. Executive summary
Reserve Juggler is a liquidity-management engine for a digital bank handling ~$20M/hour of deposits, withdrawals and merchant settlements. It forecasts net cash flow, computes a risk-based liquid reserve, and allocates the remaining surplus to short-term yield instruments, net of withdrawal penalties and settlement delays. A Liquidity Digital Twin replays stress scenarios so every recommendation can be tested against a baseline.

## 2. Problem statement
Source: the hackathon "The Idle Cash Problem" (advanced track), as supplied by the team. The original document is not in the repository; this report uses only the supplied summary. Idle cash earns nothing; over-deploying cash causes payout shortfalls or penalised early withdrawals.

## 3. Business context
- Customer payouts must be funded on time; shortfalls mean emergency borrowing at a premium or failed payouts.
- Yield instruments differ in rate, settlement lag, penalty and capacity.
- Real banks are also bound by regulation (e.g. Basel III LCR requires high-quality liquid assets covering a 30-day stress outflow **[Verified]** [BIS](https://www.bis.org/publ/bcbs238.htm)). The MVP does not implement regulatory ratios.

## 4. Functional requirements
FR1 ingest/generate transactions; FR2 forecast hourly net flow with uncertainty; FR3 compute required reserve at a target confidence; FR4 compute deployable surplus and an allocation; FR5 report expected net yield, penalties and shortfall exposure; FR6 stress-test scenarios; FR7 compare against baseline policies; FR8 authenticated multi-user access; FR9 audit every recommendation.

## 5. Nonfunctional requirements
Deterministic and reproducible (seeded data); exact integer money; engine testable without UI; no secrets in browser; responses typed and validated; engine run on a day of hourly data completes well under serverless limits.

## 6. Research findings
- **Forecast baselines**: naive, seasonal naive, mean and drift are the standard benchmarks any new method must beat **[Verified]** [FPP3 simple methods](https://otexts.com/fpp3/simple-methods.html).
- **Evaluation**: rolling-origin cross-validation, scaled errors (MASE/RMSSE), pinball (quantile) score, Winkler score, CRPS and skill scores vs a benchmark **[Verified]** [FPP3 accuracy](https://otexts.com/fpp3/accuracy.html).
- **Vercel Functions** (Fluid compute): 300 s default; max 300 s Hobby, 800 s Pro; 4.5 MB request/response body; 2 GB memory default **[Verified, page dated 2026-08-24]** [limits](https://vercel.com/docs/functions/limitations).
- **Firestore**: security rules gate client requests; server client libraries (Admin SDK) bypass rules, so server code must authorise itself **[Verified]** [rules](https://firebase.google.com/docs/firestore/security/get-started).
- **Firebase Admin**: use a service account key via `GOOGLE_APPLICATION_CREDENTIALS`/ADC; keep the key out of source control **[Verified]** [setup](https://firebase.google.com/docs/admin/setup).
- **Next.js Route Handlers** are defined in `route.ts` under `app/`, support GET/POST/etc., and are not cached by default **[Verified]** [docs](https://nextjs.org/docs/app/getting-started/route-handlers).
- **shadcn/ui** initialises with `shadcn@latest init` in an existing Next.js app and needs the `@/*` alias **[Verified]** [docs](https://ui.shadcn.com/docs/installation/next).

## 7. Competitive landscape
Treasury platforms exist (Kyriba, GTreasury, Trovata and others). Aggregator sites describe Kyriba as a broad suite with bank connectivity and forecasting, and Trovata as a lighter bank-visibility tool **[Unverified — third-party review sites only; vendor pages not confirmed]**. No uniqueness claim is made. **[Hypothesis]** Gap: open, explainable, backtested liquidity-vs-yield optimisation for fintechs/neobanks with sub-daily cash cycles, rather than corporate treasuries.

## 8. Proposed solution
Pipeline: transactions → hourly net-flow series → forecast with quantile residuals → reserve → optimiser → decision record → digital-twin replay → metrics vs baselines.

## 9. Differentiators (hypotheses to validate)
Probabilistic reserve with stated confidence; backtest against naive policies on every run; explainable decisions; scenario replay; honest "cannot fund" states.

## 10. System architecture
See [ARCHITECTURE.md](ARCHITECTURE.md). Single Next.js repo; pure TypeScript engine in `src/engine`; Route Handlers as thin adapters; Firestore for persistence.

## 11. Stack and justification
Next.js App Router + React + TypeScript strict (single deploy unit on Vercel); Tailwind + shadcn/ui (fast, consistent UI); Recharts (React charts); Zod (runtime validation); Firebase Auth + Firestore (managed auth/db, free tier for demo); Vitest for engine tests. Python deferred: the MVP models (seasonal profiles, exponential smoothing, a greedy/LP allocator) are simple in TS; revisit if ML is justified by backtests.

## 12. Data model
See [DATA_MODEL.md](DATA_MODEL.md).

## 13. Forecasting methodology
Methods compared (details in FINANCIAL_MODEL.md):

| Method | Complexity | Data | Explainable | Fit for synthetic data |
|---|---|---|---|---|
| Naive / seasonal naive | trivial | 1 season | yes | baseline |
| Moving average | low | window | yes | weak with seasonality |
| Exponential smoothing | low | weeks | yes | good |
| Hour-of-week seasonal profile + smoothing | low | 2–4 weeks | yes | **chosen** |
| ML (GBM etc.) | high | months | low | defer; only if it beats the chosen model out of sample |

Evaluation: rolling-origin backtest vs seasonal naive; report MASE and pinball loss at the reserve quantile.

## 14. Reserve methodology
Reserve = upper-tail quantile of cumulative forecast net outflow over the horizon, plus operational floor and stress add-on. Three tiers: fixed buffer (deterministic), probabilistic reserve (target confidence 1−α), true guarantee (only with committed funding lines — out of scope).

## 15. Optimisation model
Maximise expected net yield minus expected penalties minus shortfall cost, subject to the reserve floor, capacities and settlement lags. Full formulation in FINANCIAL_MODEL.md.

## 16. Stress testing
Scenarios: deposit outflow shock, merchant settlement delay, correlated withdrawal run, yield-rate drop, instrument outage. Metrics: shortfall frequency, expected shortfall, emergency-borrowing cost, penalties paid.

## 17. Security and privacy
Admin credentials server-side only; every Route Handler verifies the Firebase ID token and org membership; Firestore rules deny direct client writes to decision/audit data; synthetic data only (no real PII); inputs validated with Zod; audit log for every decision.

## 18. Testing and validation
Unit tests for money, forecasting, reserve, optimiser (property tests: allocation never breaches reserve floor or capacity); seeded-simulation regression tests; Firestore rules tests with the emulator; lint, typecheck, build in CI.

## 19. Deployment
Vercel (Next.js) + Firebase project. Env vars documented in `.env.example`. Heavy simulations are chunked or precomputed to stay under the 4.5 MB body and duration limits.

## 20. Limitations and assumptions
Synthetic data; no bank connectivity; no regulatory modelling; probabilistic forecasts can be wrong, especially under regime change; a quantile reserve is **not** a guarantee that every payout is funded; instrument terms are assumed known and constant; single currency.

## 21. Commercialisation
**[Hypothesis]** First segments: neobanks, payment/merchant-settlement providers, wallet operators. Models: SaaS per volume tier, or a share of incremental yield. Requires pilot data to prove value; no performance uplift is claimed here.

## 22. Roadmap
See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

## 23. References
- https://www.bis.org/publ/bcbs238.htm
- https://otexts.com/fpp3/simple-methods.html
- https://otexts.com/fpp3/accuracy.html
- https://vercel.com/docs/functions/limitations
- https://firebase.google.com/docs/firestore/security/get-started
- https://firebase.google.com/docs/admin/setup
- https://nextjs.org/docs/app/getting-started/route-handlers
- https://ui.shadcn.com/docs/installation/next
