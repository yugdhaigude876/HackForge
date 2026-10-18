# Deployment and Operations Guide

This guide details operational procedures for Reserve Juggler on Vercel and Firebase, including environment configuration, member seeding, and verification steps.

---

## 1. Environment Variables to Confirm in Vercel

Confirm that the following environment variables are set in the Vercel Project Settings (**Settings** -> **Environment Variables**). 
> **Security Notice**: Only check the existence of variable names; never log or print their secret values.

### Server-Side Configuration (Firebase Admin)
- `FIREBASE_SERVICE_ACCOUNT_JSON`: Complete JSON string of the Firebase service account key with Firestore and Firebase Auth permissions. Must parse cleanly as JSON containing `project_id`, `client_email`, and `private_key`.
- `FIREBASE_PROJECT_ID` (Optional fallback): Google Cloud / Firebase project ID.
- `FIREBASE_CLIENT_EMAIL` (Optional fallback): Service account email.
- `FIREBASE_PRIVATE_KEY` (Optional fallback): PEM-formatted private key (with `\n` linebreaks).

### Client-Side Configuration (Firebase Web SDK)
- `NEXT_PUBLIC_FIREBASE_API_KEY`: Web API key.
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`: Auth domain (e.g., `<project-id>.firebaseapp.com`).
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`: Firebase project ID.
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`: Storage bucket URL.
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`: Cloud Messaging sender ID.
- `NEXT_PUBLIC_FIREBASE_APP_ID`: Firebase Web App ID.

### Operational Flags
- `NEXT_PUBLIC_ALLOW_MOCK_AUTH`: Set to `"false"` in production. Mock authentication is strictly disabled in production when unset.

---

## 2. Redeployment Steps

After committing the changes:
1. Ensure your local branch is clean and all tests pass:
   ```bash
   npm test
   npm run lint
   npx tsc --noEmit
   npm run build
   ```
2. Trigger the Vercel deployment:
   ```bash
   vercel --prod
   ```
   *(Or push to the repository default branch if automatic Vercel Git integration is enabled).*

---

## 3. Organisation Member Provisioning (`scripts/seed-member.ts`)

Reserve Juggler enforces strict Role-Based Access Control (RBAC):
- `viewer`: Read-only access to decisions, forecast analytics, and audit logs.
- `analyst`: Ability to run decisions, execute digital twin simulations, and generate datasets.
- `admin`: Full organisation administrative capabilities.

### Provisioning against Local Firestore Emulator (Default & Safe)
The script defaults safely to the local emulator (`127.0.0.1:8080`) when no cloud project flag is passed:
```bash
npx tsx scripts/seed-member.ts --uid <USER_UID> --role analyst --org <ORG_ID>
```

### Provisioning against Live Firebase Project (Explicit Safety Gate)
The seed script will **refuse to run** against a live Firebase project unless BOTH `--project <PROJECT_ID>` and `--yes-i-mean-it` flags are explicitly supplied:

```bash
npx tsx scripts/seed-member.ts --uid <USER_UID> --role analyst --org <ORG_ID> --project <PROJECT_ID> --yes-i-mean-it
```

*Example for user `7zC...` in organisation `org_treasury`:*
```bash
npx tsx scripts/seed-member.ts --uid 7zCabc123xyz --role analyst --org org_treasury --project hack-forge-prod --yes-i-mean-it
```

---

## 4. Post-Deployment Verification Checklist

Verify endpoint status using read-only GET requests:
1. **Liveness Probe**:
   ```bash
   curl -I https://<your-deployment-url>/api/health
   # Expected: HTTP 200 OK
   ```
2. **Readiness Probe**:
   ```bash
   curl -I https://<your-deployment-url>/api/ready
   # Expected: HTTP 200 OK (or HTTP 503 if Firestore is degraded; never 500)
   ```
3. **Protected API Auth Check**:
   ```bash
   curl -I https://<your-deployment-url>/api/decisions
   # Expected: HTTP 400 Bad Request (missing x-org-id) or HTTP 401 Unauthorized (never 500)
   ```
4. **Permanent Route Redirects**:
   ```bash
   curl -I https://<your-deployment-url>/digital-twin  # 308 -> /twin
   curl -I https://<your-deployment-url>/compliance    # 308 -> /audit
   curl -I https://<your-deployment-url>/vaults        # 308 -> /optimizer
   ```
