# Realtime dataset stream

The app streams the official hackathon dataset (`data/treasury_4tier_dataset.csv`, 8,760 hourly rows) one hour at a time. This is a **simulated feed built from a provided dataset, not real bank data**. It is labelled "Official dataset (streamed)" in the UI.

## How it works
1. `scripts/build-dataset.mjs` validates the CSV and generates `src/engine/data/dataset.generated.json` (runs in `prebuild`). The server reads that asset through `src/server/dataset.ts` (server-only). Never read the CSV with `fs` in a route: on Vercel it is not in the serverless bundle.
2. A per-organisation clock lives in `orgs/{orgId}/clock/state`. `POST /api/clock/advance` applies up to 24 hours in one Firestore transaction: it writes `stream/{hour}` documents, the server-only `engine/state`, and the clock.
3. `stepTreasury` (`src/engine/treasury-step.ts`) is the single hour step shared by the batch simulator and the stream. Tests prove stepping equals the batch run.
4. Each `stream` document carries the treasury snapshot, reserve decision, a 24 h forecast with a band, out-of-sample forecast accuracy versus a seasonal-naive baseline, and events.
5. The browser listens with Firestore `onSnapshot` (`LiveTreasuryProvider`). Dashboard, Forecast, Reserve, Optimizer, Audit and the top-bar notifications update live.

## Who drives the clock
- **Client driver (default):** an analyst/admin session that holds the lease advances the clock while its tab is visible. Works on Vercel Hobby. It stops when the tab is hidden for more than 60 s.
- **Cron driver (opt-in):** `GET /api/cron/tick` with `Authorization: Bearer $CRON_SECRET`. Vercel Hobby cron runs at most once per day, so use Pro for per-minute ticks (https://vercel.com/docs/cron-jobs/usage-and-pricing).

## Deploy checklist (why it can work on localhost and fail on the website URL)
- Set every `NEXT_PUBLIC_*` variable in Vercel (`FIREBASE_API_KEY`, `AUTH_DOMAIN`, `PROJECT_ID`, `APP_ID`, `NEXT_PUBLIC_DEFAULT_ORG_ID`, ...) and **redeploy**: they are inlined at build time. A missing `NEXT_PUBLIC_DEFAULT_ORG_ID` falls back to `org_demo`, where the signed-in user has no membership, so every API call returns 403.
- Set `FIREBASE_SERVICE_ACCOUNT_JSON` (server only) in Vercel.
- Add the Vercel domain to Firebase Authentication > Settings > Authorized domains.
- Deploy `firestore.rules` and `firestore.indexes.json`. The `clock`, `stream` and `engine` paths are new; without the rules, live listeners return permission-denied.
- Create `orgs/{orgId}/members/{uid}` with a role for the signed-in user. Without it the user is treated as a viewer or gets 403.
- Optional: set `CRON_SECRET` only if you use the cron driver.

## Local emulators
Set `NEXT_PUBLIC_USE_AUTH_EMULATOR=true`, `NEXT_PUBLIC_USE_FIRESTORE_EMULATOR=true` (optional `NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST`, default `127.0.0.1:8080`), plus `FIREBASE_AUTH_EMULATOR_HOST` and `FIRESTORE_EMULATOR_HOST` for the Admin SDK. The emulators need Java.

## Known gaps
- Digital Twin and Analytics pages are not yet wired to the stream.
- Firestore rules tests for the new paths and browser end-to-end tests have not been run.
