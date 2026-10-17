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

const rawSa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
if (!rawSa) {
  console.error("❌ Error: FIREBASE_SERVICE_ACCOUNT_JSON is missing in .env.local.");
  console.error("Please add your Firebase Admin service account JSON string to .env.local first.");
  process.exit(1);
}

const uid = process.argv[2];
const role = process.argv[3] || "admin";
const orgId = process.env.NEXT_PUBLIC_DEFAULT_ORG_ID || "org_demo";

if (!uid) {
  console.log("Usage: node scripts/seed-member.mjs <USER_UID> [role: admin|analyst|viewer]");
  console.log("Example: node scripts/seed-member.mjs 4f8K9vP2... admin");
  process.exit(1);
}

if (!["admin", "analyst", "viewer"].includes(role)) {
  console.error(`❌ Invalid role "${role}". Allowed roles: admin, analyst, viewer`);
  process.exit(1);
}

try {
  const sa = JSON.parse(rawSa);
  if (sa.private_key) {
    sa.private_key = sa.private_key.replace(/\\n/g, "\n");
  }

  const app = getApps().length === 0 ? initializeApp({ credential: cert(sa) }) : getApps()[0];
  const db = getFirestore(app);

  console.log(`⏳ Granting role "${role}" to UID "${uid}" in org "${orgId}"...`);

  // Ensure org document exists
  await db.doc(`orgs/${orgId}`).set(
    {
      id: orgId,
      name: "Demo Treasury Organisation",
      currency: "USD",
      createdAt: Timestamp.now(),
      createdBy: "system_bootstrap",
    },
    { merge: true }
  );

  // Set member role
  await db.doc(`orgs/${orgId}/members/${uid}`).set({
    orgId,
    uid,
    role,
    createdAt: Timestamp.now(),
    createdBy: "system_bootstrap",
  });

  console.log(`✅ Success! UID "${uid}" is now an "${role}" of "${orgId}".`);
  console.log(`You can now sign in at http://localhost:3000/login and use the dashboard.`);
} catch (err) {
  console.error("❌ Failed to seed member:", err);
  process.exit(1);
}
