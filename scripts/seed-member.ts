#!/usr/bin/env tsx
/**
 * Reserve Juggler - Member Role Seeder
 *
 * Sets orgs/{orgId}/members/{uid} with an administrative or analyst role.
 *
 * SAFETY GUARD:
 * - Defaults to the local Firestore emulator (127.0.0.1:8080).
 * - NEVER touches a live Firebase project unless BOTH --project <id> AND --yes-i-mean-it are supplied.
 *
 * Usage:
 *   # Target local emulator (default):
 *   npm run seed:member -- --uid <UID> --role analyst
 *
 *   # Target live project (explicit confirmation required):
 *   npx tsx scripts/seed-member.ts --uid <UID> --role analyst --org org_demo --project <PROJECT_ID> --yes-i-mean-it
 */

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import * as fs from "fs";
import * as path from "path";

// Load .env.local if present
const envLocalPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envLocalPath)) {
  const content = fs.readFileSync(envLocalPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

function printUsageAndExit(code = 0): never {
  console.log(`
Reserve Juggler - Member Role Seeder

Usage:
  npx tsx scripts/seed-member.ts --uid <UID> [--role <role>] [--org <orgId>] [--project <id> --yes-i-mean-it]

Options:
  --uid <UID>            Firebase user UID to grant permissions to (required)
  --role <role>          Role to grant: admin | analyst | viewer (default: analyst)
  --org <orgId>          Target organisation ID (default: org_demo)
  --project <id>         Firebase project ID to target (requires --yes-i-mean-it)
  --yes-i-mean-it        Safety acknowledgement flag required when targeting a real project
  --help                 Show this help message

By default, this script connects exclusively to the local Firestore emulator (127.0.0.1:8080).
`);
  process.exit(code);
}

// Parse command line arguments
const args = process.argv.slice(2);
let uid = "";
let role = "analyst";
let orgId = process.env.NEXT_PUBLIC_DEFAULT_ORG_ID || "org_demo";
let projectId = "";
let yesIMeanIt = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--help" || arg === "-h") {
    printUsageAndExit(0);
  } else if (arg === "--uid" && i + 1 < args.length) {
    uid = args[++i];
  } else if (arg === "--role" && i + 1 < args.length) {
    role = args[++i].toLowerCase();
  } else if (arg === "--org" && i + 1 < args.length) {
    orgId = args[++i];
  } else if (arg === "--project" && i + 1 < args.length) {
    projectId = args[++i];
  } else if (arg === "--yes-i-mean-it") {
    yesIMeanIt = true;
  } else if (!arg.startsWith("--") && !uid) {
    // Positional fallback for UID
    uid = arg;
  } else if (!arg.startsWith("--") && uid && role === "analyst") {
    // Positional fallback for role
    role = arg.toLowerCase();
  }
}

if (!uid) {
  console.error("❌ Error: Missing required --uid argument.");
  printUsageAndExit(1);
}

if (!["admin", "analyst", "viewer"].includes(role)) {
  console.error(`❌ Error: Invalid role "${role}". Allowed roles: admin, analyst, viewer.`);
  process.exit(1);
}

// Safety Verification
const isLiveTarget = Boolean(projectId);

if (isLiveTarget) {
  if (!yesIMeanIt) {
    console.error(`
❌ SAFETY GUARD REJECTION:
You provided --project "${projectId}" to target a real Firebase project,
but omitted the mandatory confirmation flag: --yes-i-mean-it.

To safely target your live project, re-run with:
  npx tsx scripts/seed-member.ts --uid "${uid}" --role "${role}" --org "${orgId}" --project "${projectId}" --yes-i-mean-it
`);
    process.exit(1);
  }

  // Ensure emulator host is cleared when deliberately targeting live
  delete process.env.FIRESTORE_EMULATOR_HOST;
  console.log(`⚠️  TARGETING LIVE FIREBASE PROJECT: ${projectId}`);
} else {
  // Default to emulator
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
  process.env.FIRESTORE_EMULATOR_HOST = emulatorHost;
  console.log(`🛡️  Targeting local Firestore emulator at ${emulatorHost}`);
  console.log(`ℹ️   To target a real Firebase project, pass BOTH --project <id> AND --yes-i-mean-it.`);
}

async function main() {
  let app;
  const existingApps = getApps();

  if (existingApps.length > 0) {
    app = existingApps[0];
  } else {
    let rawSa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
    if (rawSa) {
      if ((rawSa.startsWith("'") && rawSa.endsWith("'")) || (rawSa.startsWith('"') && rawSa.endsWith('"'))) {
        rawSa = rawSa.slice(1, -1).trim();
      }
      try {
        const sa = JSON.parse(rawSa);
        if (sa.private_key) {
          sa.private_key = sa.private_key.replace(/\\n/g, "\n");
        }
        app = initializeApp({
          credential: cert(sa),
          projectId: projectId || sa.project_id || "demo-hackforge",
        });
      } catch (err) {
        console.warn("Could not parse FIREBASE_SERVICE_ACCOUNT_JSON, falling back to default credentials:", err);
        app = initializeApp({ projectId: projectId || "demo-hackforge" });
      }
    } else {
      app = initializeApp({ projectId: projectId || "demo-hackforge" });
    }
  }

  const db = getFirestore(app);

  console.log(`⏳ Writing membership record: orgs/${orgId}/members/${uid} (role: ${role})...`);

  // Ensure organisation document exists
  await db.doc(`orgs/${orgId}`).set(
    {
      id: orgId,
      name: `${orgId.toUpperCase()} Treasury`,
      currency: "USD",
      updatedAt: Timestamp.now(),
      updatedBy: "scripts/seed-member.ts",
    },
    { merge: true }
  );

  // Set member record
  await db.doc(`orgs/${orgId}/members/${uid}`).set(
    {
      orgId,
      uid,
      role,
      updatedAt: Timestamp.now(),
      updatedBy: "scripts/seed-member.ts",
    },
    { merge: true }
  );

  console.log(`
✅ SUCCESS: Member document created!
   Collection Path: orgs/${orgId}/members/${uid}
   Granted Role:    ${role}
   Target:          ${isLiveTarget ? `Live Project (${projectId})` : `Firestore Emulator (${process.env.FIRESTORE_EMULATOR_HOST})`}
`);
}

main().catch((err) => {
  console.error("❌ Fatal error during member seeding:", err);
  process.exit(1);
});
