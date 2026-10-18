<p align="center">
  <img src="public/brand/banner.png" alt="Reserve Juggler logo: three orbs juggled in an infinity loop above two open hands" width="640" />
</p>

# Reserve Juggler (HackForge)

> **Autonomous Liquidity Reserve Forecasting & Surplus Cash Optimisation** for digital banks and corporate treasuries.

[![Next.js 16](https://img.shields.io/badge/Next.js-16.4.2-black?logo=next.js)](https://nextjs.org/)
[![React 19](https://img.shields.io/badge/React-19.3.0-blue?logo=react)](https://react.dev/)
[![TypeScript Strict](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Tailwind CSS 4](https://img.shields.io/badge/Tailwind-4-38bdf8?logo=tailwindcss)](https://tailwindcss.com/)
[![Firebase](https://img.shields.io/badge/Firebase-Auth%20%2B%20Firestore-orange?logo=firebase)](https://firebase.google.com/)
[![Vitest](https://img.shields.io/badge/Vitest-346%20Passed-green?logo=vitest)](https://vitest.dev/)

A digital banking platform processing ~$20M/hour in inflows and outflows must maintain sufficient liquidity to guarantee settlement obligations while minimizing the opportunity cost of idle, zero-yield cash. Reserve Juggler dynamically forecasts cash flows, computes risk-based liquid reserves with Basel III-aligned operational floors, allocates deployable surplus to short-term yield instruments net of settlement lags and penalties, stress-tests policies in an interactive Liquidity Digital Twin, and provides plain-language deterministic explanations for every decision.

---

## Key Capabilities

1. **Probabilistic Liquidity Forecasting (`/forecast`)**
   - Hour-of-week kernel smoothing with quantile residual uncertainty bands (p5–p95).
   - Rolling-origin backtesting evaluated on identical windows against **Naive** (flat-line) and **Seasonal Naive** (168h cycle) baselines.
   - Evaluated via MASE (Mean Absolute Scaled Error), Pinball Quantile Loss, and Skill Scores.

2. **Liquid Reserve Determination (`/reserve`)**
   - Step-by-step mathematical derivation: $R = \max(0, -(\mu + q)) + F + Z$, where $\mu$ is expected flow, $q$ is flow tail risk at confidence $\alpha$, $F$ is the regulatory operational floor, and $Z$ is stress add-on.
   - Balance breakdown waterfall chart and standing regulatory caveats.

3. **Surplus Yield Optimizer (`/optimizer`)**
   - Net unit value calculation: $v_i = r_i \cdot \frac{H}{8760} - \pi_i \cdot p_i$, incorporating early-exit penalties $\pi_i$ and liquidity stress risk $p_i$.
   - Greedy allocation prioritizing highest positive net unit values up to instrument capacity constraints.

4. **Liquidity Digital Twin (`/twin`)**
   - Monte Carlo simulation engine with bootstrap residual shocks.
   - **Common Random Numbers (CRN)**: Evaluates multiple policies (`reserve-juggler`, `hold-all-cash`, `fixed-buffer`) over identical drawn shock sequences to eliminate sampling noise.
   - Side-by-side policy comparisons, pairwise metric differentials ($\Delta$), and interactive step-by-step replay scrubber.

5. **Analytics & Explainability (`/analytics`)**
   - Multi-policy cross-simulation aggregates (mean, min, max net yield, shortfall frequency, borrowing costs).
   - Head-to-head win/loss records vs benchmark cash policies.
   - Deterministic, zero-hallucination decision audit history inspector with complete step-by-step figures and instrument funding rationale.

---

## Project Structure

```text
src/
├── app/
│   ├── (app)/               # Authenticated application routes
│   │   ├── dashboard/       # Main treasury command center
│   │   ├── twin/            # Digital Twin scenario replay & comparison
│   │   ├── forecast/        # Forecast accuracy & residual bands
│   │   ├── reserve/         # Reserve derivation & waterfall
│   │   ├── optimizer/       # Instrument allocation matrix & yields
│   │   ├── analytics/       # Multi-policy analytics & explanation drawer
│   │   ├── audit/           # Append-only SHA-256 audit log
│   │   └── settings/        # Org settings & role viewer
│   └── api/                 # Next.js Route Handlers (protected with withAuth)
│       ├── analytics/       # Forecast & multi-policy aggregate endpoints
│       ├── dashboard/       # Summary & engine run triggers
│       ├── decisions/       # Persisted decision query & explanation endpoints
│       ├── engine/          # Pure financial calculation APIs
│       ├── instruments/     # Yield instrument catalog
│       └── simulations/     # Monte Carlo & policy comparison APIs
├── components/              # UI components & financial charts (Recharts)
├── engine/                  # Pure TypeScript financial mathematics engine
│   ├── money.ts             # Safe BigInt minor-unit money math
│   ├── forecast.ts          # Hour-of-week forecaster
│   ├── metrics.ts           # MASE, Pinball loss, Skill scores, Baselines
│   ├── reserve.ts           # Basel III-aligned reserve calculation
│   ├── optimizer.ts         # Net unit value surplus allocation
│   ├── simulate.ts          # Monte Carlo simulator with CRN
│   └── explain.ts           # Deterministic decision explanation generator
└── server/                  # Server-side auth, repositories, and Firebase Admin
```

---

## Getting Started

### 1. Prerequisites
- Node.js 18+ (Node 20+ recommended)
- npm or pnpm

### 2. Installation
```bash
git clone https://github.com/yugdhaigude876/HackForge.git
cd HackForge
npm install
```

### 3. Local Development
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser. The app runs out of the box in **Demonstration Mode** with rich sample data and interactive controls.

### 4. Running Verification Suite
```bash
# Run unit and integration tests (346 tests across 32 suites)
npm test

# Run ESLint
npm run lint

# Run TypeScript strict type-check
npx tsc --noEmit

# Test production build
npm run build
```

---

## Environment Variables

For full live deployment connected to Firebase Auth and Cloud Firestore:

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Firebase Web API Key |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Firebase Auth Domain |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Firebase Project ID |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Firebase Storage Bucket |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Messaging Sender ID |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Firebase App ID |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Firebase Admin SDK Service Account JSON string |

See `.env.example` for a complete template.

---

## Regulatory & Financial Model Caveat

A probabilistic liquidity reserve is a model-derived risk mitigation tool, not an absolute guarantee that every cash outflow will be funded under extreme market dislocations. All metrics and projections reflect modeled assumptions. See `docs/FINANCIAL_MODEL.md` for full mathematical specifications.
