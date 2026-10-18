// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ThemeProvider, useTheme } from "@/components/providers/theme-provider";
import { ThemeToggle } from "@/components/ui/theme-toggle";

function MockMatchMedia(matches: boolean) {
  return vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

function ThemeStatusProbe() {
  const { theme, toggleTheme } = useTheme();
  return (
    <div>
      <span data-testid="current-theme">{theme}</span>
      <button onClick={toggleTheme} data-testid="toggle-btn">Toggle</button>
    </div>
  );
}

describe("Theme System (ThemeProvider & ThemeToggle)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.classList.remove("dark");
  });

  it("defaults to institutional dark mode by default upon first visit", () => {
    window.matchMedia = MockMatchMedia(true); // even if OS prefers light

    render(
      <ThemeProvider>
        <ThemeStatusProbe />
      </ThemeProvider>
    );

    expect(screen.getByTestId("current-theme").textContent).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("respects user preference when light is saved in localStorage", () => {
    window.localStorage.setItem("reserve-juggler.theme", "light");
    window.matchMedia = MockMatchMedia(false);

    render(
      <ThemeProvider>
        <ThemeStatusProbe />
      </ThemeProvider>
    );

    expect(screen.getByTestId("current-theme").textContent).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("toggle switches data-theme and persists choice to localStorage", () => {
    window.matchMedia = MockMatchMedia(false); // start dark

    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>
    );

    const button = screen.getByRole("button", { name: /switch to light theme/i });
    expect(button).toBeDefined();

    // Click toggle to switch to light
    act(() => {
      fireEvent.click(button);
    });

    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(window.localStorage.getItem("reserve-juggler.theme")).toBe("light");

    // Click toggle to switch back to dark
    const buttonLight = screen.getByRole("button", { name: /switch to dark theme/i });
    act(() => {
      fireEvent.click(buttonLight);
    });

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(window.localStorage.getItem("reserve-juggler.theme")).toBe("dark");
  });

  it("tolerates localStorage throwing errors gracefully", () => {
    window.matchMedia = MockMatchMedia(false);

    // Mock localStorage throwing SecurityError (e.g. private browsing restriction)
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError: Access denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError: Access denied");
    });

    expect(() => {
      render(
        <ThemeProvider>
          <ThemeStatusProbe />
        </ThemeProvider>
      );
    }).not.toThrow();

    const toggleBtn = screen.getByTestId("toggle-btn");
    expect(() => {
      act(() => {
        fireEvent.click(toggleBtn);
      });
    }).not.toThrow();

    // Theme still switches in memory
    expect(screen.getByTestId("current-theme").textContent).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
});
