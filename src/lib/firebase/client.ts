import { initializeApp, getApps, getApp, type FirebaseApp, type FirebaseOptions } from "firebase/app";
import { getAuth, type Auth, GoogleAuthProvider } from "firebase/auth";

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
 * Returns false if credentials are missing or placeholders, indicating mock mode should be used.
 */
export function isFirebaseConfigured(): boolean {
  const apiKey = (process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "").trim();
  const projectId = (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "").trim();

  // If apiKey or projectId are missing or equal to demo placeholders, fallback to mock mode
  if (!apiKey || !projectId) {
    return false;
  }
  if (apiKey === "your-api-key" || projectId === "your-project-id" || apiKey === "mock") {
    return false;
  }

  return true;
}

let cachedApp: FirebaseApp | null = null;
let cachedAuth: Auth | null = null;
let cachedGoogleProvider: GoogleAuthProvider | null = null;

/**
 * Returns the initialized Firebase App instance, or null if running in mock mode.
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
 * Returns the Firebase Auth instance, or null if running in mock mode.
 */
export function getFirebaseAuth(): Auth | null {
  if (!isFirebaseConfigured()) {
    return null;
  }

  if (!cachedAuth) {
    const app = getFirebaseApp();
    if (app) {
      cachedAuth = getAuth(app);
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
