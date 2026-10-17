# Phase 14 — Server auth and authorisation (prompt)

Paste everything below the line into a Claude Code session opened on the HackForge repo.

---

You are working in the HackForge repo (Reserve Juggler: Next.js 16 App Router, TypeScript strict, Zod, Vitest, Firebase). Read `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/IMPLEMENTATION_PLAN.md` and `AGENTS.md` first. Next.js 16 differs from older versions: check `node_modules/next/dist/docs/` before using framework APIs.

## Goal
Protect the engine API routes so only signed-in members of an organisation can call them. Implement **Phase 14: ID-token verification and org authorisation on the server.** Do not start any other phase.

## Current state (verified in the repo)
- Routes exist and are **unauthenticated**: `src/app/api/engine/{generate,forecast,decision}/route.ts`, validated with Zod in `src/engine/schemas.ts`. Tests: `tests/api/routes.test.ts` (Vitest, `npm test`).
- `firebase` (web SDK) is installed. `firebase-admin` is **not** installed.
- No Firebase client code exists yet (Phase 13 not done). Do not build sign-in UI; tests must not need it.
- `.env.example` already lists `FIREBASE_SERVICE_ACCOUNT_JSON` (server only).
- The decision route returns raw `error.message` on 500s; fix that as part of this phase.

## Requirements
1. Install `firebase-admin`. Create `src/server/firebase-admin.ts`: lazy singleton `getAdminApp()`/`getAdminAuth()`, reading credentials from `FIREBASE_SERVICE_ACCOUNT_JSON` (parse JSON, fix escaped `\n` in `private_key`). Mark the module `import "server-only"` (install `server-only`) so it can never be bundled into the browser. Never log the key; throw a clear typed error if config is missing.
2. Create `src/server/auth.ts`:
   - `requireUser(request)`: read `Authorization: Bearer <idToken>`, verify with `verifyIdToken(token, true)` (checkRevoked), return `{ uid, email }`. Missing/invalid/expired/revoked token returns 401.
   - `requireOrgMember(request, orgId, minRole)`: after `requireUser`, check membership. Planned data model: `orgs/{orgId}/members/{uid}` with role `admin | analyst | viewer` (see `docs/DATA_MODEL.md`). Return 403 if not a member or role is too low. Order of roles: viewer < analyst < admin.
   - Because the Admin SDK bypasses Firestore security rules, this route-level check is the real authorisation boundary. Say so in a code comment.
3. Introduce a small wrapper `withAuth(handler, { minRole })` in `src/server/with-auth.ts` and apply it to all three engine routes. `orgId` comes from the `x-org-id` header (validate it with Zod: non-empty, length-limited, safe charset). Do not trust any org or role value from the request body.
4. Typed error envelope for all failures: `{ ok: false, error: { code, message } }` with stable codes (`UNAUTHENTICATED`, `FORBIDDEN`, `VALIDATION_ERROR`, `INTERNAL`). Keep existing success payload shapes unchanged so current tests/clients still work (or update them deliberately and note it). 500 responses must return a generic message and log details server-side only.
5. Local dev/test escape hatch: **do not** add an auth bypass flag that could ship to production. Instead make the verifier injectable (dependency injection or module mock) so tests run with a fake verifier and fake membership lookup.
6. Membership lookup lives behind an interface (`MembershipStore.getRole(orgId, uid)`) with a Firestore-backed implementation using the Admin SDK. Phase 15 owns rules and repositories, so keep this to one small read function.

## Tests (Vitest, required)
- No header → 401; malformed header → 401; invalid/expired/revoked token → 401.
- Valid token, not a member → 403; viewer on a route needing analyst → 403; analyst/admin → 200 with the same engine output as before.
- Missing/invalid `x-org-id` → 400/403 as designed, never a 500.
- Validation errors still return 400 and do not leak stack traces; unexpected errors return a generic 500.
- Existing engine tests still pass.

## Constraints
- Admin credentials and secrets stay server-side; nothing under `src/server` imports from client components, and nothing uses a `NEXT_PUBLIC_` variable for secrets.
- Do not claim Firebase is connected: you have no credentials, so verify with mocks only and say so.
- No fabricated results. Keep changes minimal and match the existing code style.

## Definition of done
`npm test`, `npm run lint`, `npx tsc --noEmit` and `npm run build` all pass (report the real output). Update `docs/ARCHITECTURE.md` (auth section, error envelope) and mark Phase 14 done in `docs/PROJECT_REPORT_PROMPT.md`. List files created and modified, and any manual setup left for the team (service account JSON in `.env.local` and Vercel env vars, members documents in Firestore). Do not commit or push; leave that to me.
