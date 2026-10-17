import "server-only";

import { initializeApp, getApps, cert, applicationDefault, type App, type ServiceAccount } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

export class MissingFirebaseAdminConfigError extends Error {
  constructor(message = "FIREBASE_SERVICE_ACCOUNT_JSON environment variable is missing, empty, or invalid.") {
    super(message);
    this.name = "MissingFirebaseAdminConfigError";
  }
}

let cachedAdminApp: App | null = null;

function parseServiceAccount(): ServiceAccount {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) {
    throw new MissingFirebaseAdminConfigError(
      "FIREBASE_SERVICE_ACCOUNT_JSON environment variable is not set. Server Firebase Admin credentials are required."
    );
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new MissingFirebaseAdminConfigError(
      "FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON."
    );
  }

  const clientEmail = parsed.client_email;
  const privateKey = parsed.private_key;
  const projectId = parsed.project_id || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

  if (typeof clientEmail !== "string" || !clientEmail) {
    throw new MissingFirebaseAdminConfigError(
      "FIREBASE_SERVICE_ACCOUNT_JSON is missing 'client_email'."
    );
  }

  if (typeof privateKey !== "string" || !privateKey) {
    throw new MissingFirebaseAdminConfigError(
      "FIREBASE_SERVICE_ACCOUNT_JSON is missing 'private_key'."
    );
  }

  // Handle escaped newlines in private key string
  const formattedPrivateKey = privateKey.replace(/\\n/g, "\n");

  return {
    projectId: typeof projectId === "string" ? projectId : undefined,
    clientEmail,
    privateKey: formattedPrivateKey,
  };
}

/**
 * Returns the singleton Firebase Admin App, initializing it if necessary.
 * Never logs credentials. Throws MissingFirebaseAdminConfigError if config is absent.
 */
export function getAdminApp(): App {
  if (cachedAdminApp) {
    return cachedAdminApp;
  }

  const existingApps = getApps();
  if (existingApps.length > 0) {
    cachedAdminApp = existingApps[0];
    return cachedAdminApp;
  }

  const rawSa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (rawSa) {
    const credentials = parseServiceAccount();
    cachedAdminApp = initializeApp({
      credential: cert(credentials),
      projectId: credentials.projectId,
    });
    return cachedAdminApp;
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    cachedAdminApp = initializeApp({
      credential: applicationDefault(),
      projectId: projectId || undefined,
    });
    return cachedAdminApp;
  }

  throw new MissingFirebaseAdminConfigError(
    "FIREBASE_SERVICE_ACCOUNT_JSON environment variable is not set. Server Firebase Admin credentials are required."
  );
}

/**
 * Returns the Firebase Admin Auth instance.
 */
export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}

let customAdminFirestore: Firestore | null = null;

/**
 * Returns the Firebase Admin Firestore instance.
 * Allows custom Firestore handle injection for tests or emulators.
 */
export function getAdminFirestore(): Firestore {
  if (customAdminFirestore) {
    return customAdminFirestore;
  }
  return getFirestore(getAdminApp());
}

/**
 * Sets a custom Firestore instance (e.g. in-memory stub or emulator) for testing.
 */
export function setAdminFirestore(firestore: Firestore | null): void {
  customAdminFirestore = firestore;
}

/**
 * Test helper to reset internal singleton caches.
 */
export function _resetAdminAppForTesting(): void {
  cachedAdminApp = null;
  customAdminFirestore = null;
}
