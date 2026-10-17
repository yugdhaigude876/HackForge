# HackForge — Reserve Juggler

Liquidity-reserve forecasting and surplus-cash optimisation for "The Idle Cash Problem". See `docs/` for the report, architecture, financial model, data model and phased plan.

**Status: Phase 1 (foundation).** The UI shell and dashboard use clearly labelled sample data. No forecasting, optimisation or Firebase integration exists yet.

## Run locally
```bash
npm install
npm run dev      # http://localhost:3000
npm run lint
npx tsc --noEmit
npm run build
```
Copy `.env.example` to `.env.local` only when Phase 2 (Firebase) starts.
