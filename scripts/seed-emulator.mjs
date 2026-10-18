/**
 * Reserve Juggler - Emulator Seed Script
 *
 * Seeds test users and organisation structures into the LOCAL Firebase Auth
 * and Firestore emulators only (Project ID: demo-reserve-juggler).
 * NEVER WRITES TO LIVE FIREBASE.
 */

import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const PROJECT_ID = process.env.GCLOUD_PROJECT || "demo-reserve-juggler";
process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.FIREBASE_AUTH_EMULATOR_HOST =
  process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";

if (!PROJECT_ID.startsWith("demo-")) {
  console.error("REFUSING TO RUN: Target project ID does not start with 'demo-'. Must run against emulators only!");
  process.exit(1);
}

const app = getApps().length === 0 ? initializeApp({ projectId: PROJECT_ID }) : getApps()[0];
const auth = getAuth(app);
const db = getFirestore(app);

const SEED_USERS = [
  {
    uid: "uid_admin_alice",
    email: "admin@reservejuggler.internal",
    password: "TestAdmin123!",
    displayName: "Alice Admin",
    orgId: "org_alpha",
    role: "admin",
  },
  {
    uid: "uid_analyst_bob",
    email: "analyst@reservejuggler.internal",
    password: "TestAnalyst123!",
    displayName: "Bob Analyst",
    orgId: "org_alpha",
    role: "analyst",
  },
  {
    uid: "uid_viewer_charlie",
    email: "viewer@reservejuggler.internal",
    password: "TestViewer123!",
    displayName: "Charlie Viewer",
    orgId: "org_alpha",
    role: "viewer",
  },
  {
    uid: "uid_other_david",
    email: "otherorg@reservejuggler.internal",
    password: "TestOther123!",
    displayName: "David OtherOrg",
    orgId: "org_beta",
    role: "admin",
  },
];

async function seedEmulator() {
  console.log(`[Seed Emulator] Seeding emulator project "${PROJECT_ID}" on hosts:`);
  console.log(`  Auth:      ${process.env.FIREBASE_AUTH_EMULATOR_HOST}`);
  console.log(`  Firestore: ${process.env.FIRESTORE_EMULATOR_HOST}`);

  // 1. Seed Authentication Users
  for (const u of SEED_USERS) {
    try {
      await auth.deleteUser(u.uid);
    } catch {
      // User might not exist yet
    }

    await auth.createUser({
      uid: u.uid,
      email: u.email,
      password: u.password,
      displayName: u.displayName,
    });
    console.log(`  Created Auth User: ${u.email} (${u.uid})`);
  }

  // 2. Seed Organisations and Membership Roster
  await db.doc("orgs/org_alpha").set({
    name: "Alpha Reserve Fund",
    currency: "USD",
    createdAt: Timestamp.now(),
  });

  await db.doc("orgs/org_beta").set({
    name: "Beta Horizon Capital",
    currency: "USD",
    createdAt: Timestamp.now(),
  });

  for (const u of SEED_USERS) {
    await db.doc(`orgs/${u.orgId}/members/${u.uid}`).set({
      role: u.role,
      email: u.email,
      displayName: u.displayName,
      createdAt: Timestamp.now(),
      createdBy: "system_seed",
    });
    console.log(`  Seeded Membership: orgs/${u.orgId}/members/${u.uid} -> role=${u.role}`);
  }

  // 3. Seed Instruments for Org Alpha
  const instruments = [
    {
      id: "inst_t_bills",
      name: "Treasury Bills (4-Week)",
      annualRateBps: 450,
      capacityMinor: "5000000000", // $50M
      penaltyBps: 10,
      settlementLagHours: 1,
      minHoldHours: 0,
      createdAt: Timestamp.now(),
    },
    {
      id: "inst_fed_repo",
      name: "Overnight Reverse Repo",
      annualRateBps: 520,
      capacityMinor: "3000000000", // $30M
      penaltyBps: 5,
      settlementLagHours: 0,
      minHoldHours: 0,
      createdAt: Timestamp.now(),
    },
  ];

  for (const inst of instruments) {
    await db.doc(`orgs/org_alpha/instruments/${inst.id}`).set(inst);
    console.log(`  Seeded Instrument: orgs/org_alpha/instruments/${inst.id}`);
  }

  console.log("[Seed Emulator] Emulator database seeded successfully.");
}

seedEmulator().catch((err) => {
  console.error("[Seed Emulator Failed]:", err);
  process.exit(1);
});
