import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E configuration for Reserve Juggler.
 * Designed to execute against the local Next.js server wired to the Firebase Auth
 * and Firestore local emulators (project id: demo-reserve-juggler).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // Sequential execution to prevent emulator state races
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [["html", { open: "never" }], ["list"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_TEST_BASE_URL || "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      NODE_ENV: "production",
      NEXT_PUBLIC_USE_AUTH_EMULATOR: "true",
      FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
      GCLOUD_PROJECT: "demo-reserve-juggler",
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-reserve-juggler",
    },
  },
});
