import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("Security: No Hardcoded Password Literals", () => {
  it("verifies login-form.tsx contains zero password literals or auto-fill credentials", () => {
    const loginFormPath = path.resolve(process.cwd(), "src/app/login/login-form.tsx");
    const content = fs.readFileSync(loginFormPath, "utf-8");

    // Must not contain any hardcoded master passwords or admin passwords
    expect(content).not.toMatch(/Admin@ReserveJuggler/);
    expect(content).not.toMatch(/Auto-fill Admin/);
    expect(content).not.toMatch(/setPassword\(["'][^"']+["']\)/);
  });

  it("recursively verifies all source code in src/ contains no password literals", () => {
    const srcDir = path.resolve(process.cwd(), "src");

    function scanDir(dir: string): string[] {
      const files = fs.readdirSync(dir);
      const violations: string[] = [];

      for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          violations.push(...scanDir(fullPath));
        } else if (/\.(tsx?|jsx?|json|css)$/.test(file)) {
          const content = fs.readFileSync(fullPath, "utf-8");

          // Look for suspect password assignments like password = "..." or password: "..."
          const match = content.match(/(?:password|passwd|pwd)\s*[:=]\s*["'][A-Za-z0-9@#$%^&*!_-]{4,}["']/i);
          if (match) {
            // Exclude test mocks if any inside src or standard placeholder words
            violations.push(`${fullPath}: ${match[0]}`);
          }

          if (/Admin@ReserveJuggler/i.test(content)) {
            violations.push(`${fullPath}: contains Admin@ReserveJuggler`);
          }
        }
      }

      return violations;
    }

    const violations = scanDir(srcDir);
    expect(violations).toEqual([]);
  });
});
