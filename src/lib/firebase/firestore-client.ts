import { getFirestore, connectFirestoreEmulator, type Firestore } from "firebase/firestore";
import { getFirebaseApp } from "./client";

let cachedDb: Firestore | null = null;
let emulatorConnected = false;

/**
 * Lazy, client-only Firestore handle. Returns null when Firebase is not configured (mock mode).
 *
 * Set NEXT_PUBLIC_USE_FIRESTORE_EMULATOR=true (and optionally NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST,
 * default "127.0.0.1:8080") to talk to the local emulator instead of the live project.
 */
export function getFirestoreDb(): Firestore | null {
  if (typeof window === "undefined") return null;
  if (cachedDb) return cachedDb;

  const app = getFirebaseApp();
  if (!app) return null;

  const db = getFirestore(app);
  if (process.env.NEXT_PUBLIC_USE_FIRESTORE_EMULATOR === "true" && !emulatorConnected) {
    const hostPort = (process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080").replace(/^https?:\/\//, "");
    const [host, portRaw] = hostPort.split(":");
    try {
      connectFirestoreEmulator(db, host, Number(portRaw) || 8080);
      emulatorConnected = true;
    } catch {
      // Already connected (hot reload): safe to ignore.
      emulatorConnected = true;
    }
  }

  cachedDb = db;
  return cachedDb;
}
