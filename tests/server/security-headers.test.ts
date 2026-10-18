import { describe, it, expect } from "vitest";
import nextConfig, { securityHeaders } from "../../next.config";

describe("Security Headers Configuration (next.config.ts)", () => {
  it("disables the X-Powered-By header (poweredByHeader: false)", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it("configures all mandatory security headers on all routes (/:path*)", async () => {
    expect(typeof nextConfig.headers).toBe("function");
    if (nextConfig.headers) {
      const headerConfigs = await nextConfig.headers();
      expect(headerConfigs).toBeDefined();
      expect(headerConfigs.length).toBeGreaterThan(0);

      const allRouteConfig = headerConfigs.find((c) => c.source === "/:path*");
      expect(allRouteConfig).toBeDefined();

      const headerKeys = allRouteConfig?.headers.map((h) => h.key) ?? [];

      expect(headerKeys).toContain("Content-Security-Policy");
      expect(headerKeys).toContain("X-Frame-Options");
      expect(headerKeys).toContain("X-Content-Type-Options");
      expect(headerKeys).toContain("Referrer-Policy");
      expect(headerKeys).toContain("Permissions-Policy");
    }
  });

  it("enforces clickjacking protection with X-Frame-Options: DENY", () => {
    const frameHeader = securityHeaders.find((h) => h.key === "X-Frame-Options");
    expect(frameHeader).toBeDefined();
    expect(frameHeader?.value).toBe("DENY");
  });

  it("enforces MIME sniffing protection with X-Content-Type-Options: nosniff", () => {
    const nosniffHeader = securityHeaders.find((h) => h.key === "X-Content-Type-Options");
    expect(nosniffHeader).toBeDefined();
    expect(nosniffHeader?.value).toBe("nosniff");
  });

  it("restricts privacy-invasive browser APIs via Permissions-Policy", () => {
    const permHeader = securityHeaders.find((h) => h.key === "Permissions-Policy");
    expect(permHeader).toBeDefined();
    expect(permHeader?.value).toContain("camera=()");
    expect(permHeader?.value).toContain("microphone=()");
    expect(permHeader?.value).toContain("geolocation=()");
  });

  it("configures strict Content-Security-Policy without unsafe-eval", () => {
    const cspHeader = securityHeaders.find((h) => h.key === "Content-Security-Policy");
    expect(cspHeader).toBeDefined();
    const csp = cspHeader?.value ?? "";

    // Strictly forbidden: unsafe-eval is a critical XSS enabler
    expect(csp).not.toContain("'unsafe-eval'");

    // Essential CSP directives
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");

    // Authorized Google & Firebase authentication domains
    expect(csp).toContain("apis.google.com");
    expect(csp).toContain("identitytoolkit.googleapis.com");
    expect(csp).toContain("securetoken.googleapis.com");
  });
});
