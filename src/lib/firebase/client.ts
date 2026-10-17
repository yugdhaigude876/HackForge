import { initializeApp, getApps, getApp, type FirebaseApp, type FirebaseOptions } from "firebase/app";
import { getAuth, connectAuthEmulator, type Auth, GoogleAuthProvider } from "firebase/auth";

/**
 * Browser-safe Firebase Client SDK configuration loaded from environment variables.
 */
export const firebaseConfig: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "",
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || "",
};

/**
 * Checks whether valid Firebase credentials have been supplied via environment variables.
 * Returns false if credentials are missing or placeholders, indicating real Firebase is not available.
 */
export function isFirebaseConfigured(): boolean {
  const apiKey = (process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "").trim();
  const projectId = (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "").trim();

  if (!apiKey || !projectId) {
    return false;
  }
  if (apiKey === "your-api-key" || projectId === "your-project-id" || apiKey === "mock") {
    return false;
  }

  return true;
}

/**
 * Determines whether mock authentication mode is permitted in the current environment.
 * In production (NODE_ENV === "production"), mock auth is disabled by default to fail closed,
 * unless explicitly allowed via NEXT_PUBLIC_ALLOW_MOCK_AUTH=true.
 */
export function isMockAuthAllowed(): boolean {
  if (process.env.NODE_ENV === "production") {
    return process.env.NEXT_PUBLIC_ALLOW_MOCK_AUTH === "true";
  }
  return true;
}

/**
 * Returns true if mock auth mode should be activated (Firebase not configured, but mock mode allowed).
 */
export function isMockModeActive(): boolean {
  return !isFirebaseConfigured() && isMockAuthAllowed();
}

/**
 * Returns true if the app is unconfigured: real Firebase credentials are missing AND
 * mock auth is disallowed (e.g., standard production deployment without credentials).
 */
export function isAuthUnconfigured(): boolean {
  return !isFirebaseConfigured() && !isMockAuthAllowed();
}

let cachedApp: FirebaseApp | null = null;
let cachedAuth: Auth | null = null;
let cachedGoogleProvider: GoogleAuthProvider | null = null;

/**
 * Returns the initialized Firebase App instance, or null if running in mock or unconfigured mode.
 */
export function getFirebaseApp(): FirebaseApp | null {
  if (!isFirebaseConfigured()) {
    return null;
  }

  if (!cachedApp) {
    cachedApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  }

  return cachedApp;
}

/**
 * Returns the Firebase Auth instance, or null if running in mock or unconfigured mode.
 * Connects to local emulator if NEXT_PUBLIC_USE_AUTH_EMULATOR=true.
 */
export function getFirebaseAuth(): Auth | null {
  if (!isFirebaseConfigured()) {
    return null;
  }

  if (!cachedAuth) {
    const app = getFirebaseApp();
    if (app) {
      cachedAuth = getAuth(app);

      if (process.env.NEXT_PUBLIC_USE_AUTH_EMULATOR === "true") {
        const emulatorHost =
          process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST || "http://127.0.0.1:9099";
        try {
          connectAuthEmulator(cachedAuth, emulatorHost, { disableWarnings: true });
        } catch {
          // Emulator already connected in dev HMR
        }
      }
    }
  }

  return cachedAuth;
}

/**
 * Returns a GoogleAuthProvider instance, or null if in mock mode.
 */
export function getGoogleAuthProvider(): GoogleAuthProvider | null {
  if (!isFirebaseConfigured()) {
    return null;
  }

  if (!cachedGoogleProvider) {
    cachedGoogleProvider = new GoogleAuthProvider();
    cachedGoogleProvider.setCustomParameters({ prompt: "select_account" });
  }

  return cachedGoogleProvider;
}

export const firebaseApp = typeof window !== "undefined" && isFirebaseConfigured() ? getFirebaseApp() : null;
export const firebaseAuth = typeof window !== "undefined" && isFirebaseConfigured() ? getFirebaseAuth() : null;
