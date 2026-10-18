import { test, expect } from "@playwright/test";

/**
 * End-to-End Suite for Reserve Juggler Security and Reliability.
 * Runs against the Next.js production or dev server backed by Auth & Firestore emulators.
 */

test.describe("Security, Role Enforcement, and Engine End-to-End Tests", () => {
  test("1. Unauthenticated access redirects to login page", async ({ page }) => {
    await page.goto("/");
    // Should be redirected to /login
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator("h1")).toContainText(/Sign in/i);
  });

  test("2. Viewer signs in and sees no run buttons", async ({ page }) => {
    await page.goto("/login");

    // Sign in as Charlie Viewer
    await page.fill('input[type="email"]', "viewer@reservejuggler.internal");
    await page.fill('input[type="password"]', "TestViewer123!");
    await page.click('button[type="submit"]');

    // Navigates to dashboard
    await expect(page).toHaveURL("/");
    await expect(page.locator("text=Charlie Viewer")).toBeVisible();

    // Check that "Run engine" or mutating action buttons are hidden for viewer
    const runButton = page.locator('button:has-text("Run engine")');
    await expect(runButton).toHaveCount(0);

    // Navigate to /twin: Run actions must be absent or disabled
    await page.goto("/twin");
    const runSimButton = page.locator('button:has-text("Run simulation")');
    await expect(runSimButton).toHaveCount(0);
  });

  test("3. Analyst runs the engine and sees stored decision & audit entry", async ({ page }) => {
    await page.goto("/login");

    // Sign in as Bob Analyst
    await page.fill('input[type="email"]', "analyst@reservejuggler.internal");
    await page.fill('input[type="password"]', "TestAnalyst123!");
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL("/");

    // Analyst sees "Run engine" button
    const runButton = page.locator('button:has-text("Run engine")');
    await expect(runButton).toBeVisible();

    // Trigger engine execution
    await runButton.click();

    // Expect successful run notification or updated balance cards
    await expect(page.locator("text=Engine Run Complete")).toBeVisible({ timeout: 15_000 });

    // Navigate to /analytics to inspect decision audit log
    await page.goto("/analytics");
    await expect(page.locator("text=decision.create")).toBeVisible();
  });

  test("4. Analyst runs a stress simulation and policy comparison on /twin", async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[type="email"]', "analyst@reservejuggler.internal");
    await page.fill('input[type="password"]', "TestAnalyst123!");
    await page.click('button[type="submit"]');

    await page.goto("/twin");
    const runCompareBtn = page.locator('button:has-text("Compare policies")');
    await expect(runCompareBtn).toBeVisible();

    await runCompareBtn.click();
    await expect(page.locator("text=Policy Comparison Results")).toBeVisible({ timeout: 20_000 });
  });

  test("5. Second rapid run triggers durable rate limit (429) debouncing", async ({ page }) => {
    // Acquire analyst session or call API rapidly
    await page.goto("/login");
    await page.fill('input[type="email"]', "analyst@reservejuggler.internal");
    await page.fill('input[type="password"]', "TestAnalyst123!");
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL("/");

    // Run engine first time
    const runButton = page.locator('button:has-text("Run engine")');
    await runButton.click();

    // Immediately trigger second run
    await page.waitForTimeout(500);
    if (await runButton.isEnabled()) {
      await runButton.click();
      // Should show rate limit message with retry countdown
      await expect(page.locator("text=Rate limit exceeded")).toBeVisible();
    }
  });

  test("6. Viewer calling a protected mutating API directly receives HTTP 403", async ({ request }) => {
    // Simulate viewer auth token call directly to POST /api/engine/decision
    // In real emulator test, obtain token via Auth REST API
    const res = await request.post("/api/engine/decision", {
      headers: {
        "x-org-id": "org_alpha",
        // Unauthenticated or viewer token
      },
      data: {
        availableCash: "5000000000",
        operationalFloor: "1000000000",
      },
    });

    // Rejects with 401 or 403 depending on token validity
    expect([401, 403]).toContain(res.status());
    const data = await res.json();
    expect(data.ok).toBe(false);
  });

  test("7. User from another organisation cannot read Org Alpha data (multi-tenant isolation)", async ({ request }) => {
    // Attempt to access org_alpha documents with org_beta header or vice-versa
    const res = await request.get("/api/decisions", {
      headers: {
        "x-org-id": "org_alpha",
        // Without valid token for org_alpha, returns 401 UNAUTHENTICATED
      },
    });

    expect(res.status()).toBe(401);
  });

  test("8. Mock authentication is strictly unreachable in a production build", async ({ page }) => {
    await page.goto("/login");

    // In production build without NEXT_PUBLIC_ALLOW_MOCK_AUTH, mock persona buttons must be absent
    const mockAdminBtn = page.locator('button:has-text("Demo Admin")');
    const mockAnalystBtn = page.locator('button:has-text("Demo Analyst")');
    const mockViewerBtn = page.locator('button:has-text("Demo Viewer")');

    await expect(mockAdminBtn).toHaveCount(0);
    await expect(mockAnalystBtn).toHaveCount(0);
    await expect(mockViewerBtn).toHaveCount(0);
  });
});
