import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isFirebaseConfigured, getFirebaseApp, getFirebaseAuth, getGoogleAuthProvider } from "@/lib/firebase/client";

describe("Firebase Client SDK Initialization", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("identifies unconfigured state when environment variables are empty", () => {
    delete process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    delete process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

    expect(isFirebaseConfigured()).toBe(false);
    expect(getFirebaseApp()).toBeNull();
    expect(getFirebaseAuth()).toBeNull();
    expect(getGoogleAuthProvider()).toBeNull();
  });

  it("identifies placeholder values as unconfigured (mock mode)", () => {
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY = "your-api-key";
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "your-project-id";

    expect(isFirebaseConfigured()).toBe(false);
  });

  it("identifies valid credentials as configured", () => {
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY = "AIzaSyFakeKeyForTesting1234567890";
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "reserve-juggler-test";

    expect(isFirebaseConfigured()).toBe(true);
  });
});
