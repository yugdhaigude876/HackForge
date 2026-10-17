// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { AuthProvider, useAuth } from "@/lib/firebase/auth-context";

describe("AuthContext and AuthProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <AuthProvider forceMock={true}>{children}</AuthProvider>
  );

  it("throws error when useAuth is accessed outside AuthProvider", () => {
    // Suppress expected console.error during throw test
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useAuth())).toThrow("useAuth must be used within an AuthProvider");
    consoleSpy.mockRestore();
  });

  it("initializes in mock mode with null user and loading false", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    expect(result.current.isMock).toBe(true);
    expect(result.current.user).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("signs in as demo user successfully", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.signInAsDemoUser("analyst");
    });

    expect(result.current.user).not.toBeNull();
    expect(result.current.user?.email).toBe("analyst@reservejuggler.internal");
    expect(result.current.user?.role).toBe("Senior Treasury Analyst");
  });

  it("signs in with email and password in mock mode", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.signInWithEmail("treasury@bank.com", "secure123");
    });

    expect(result.current.user).not.toBeNull();
    expect(result.current.user?.email).toBe("treasury@bank.com");
    expect(result.current.user?.displayName).toBe("Treasury");
  });

  it("signs up with email and password in mock mode", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.signUpWithEmail("director@fund.org", "pass12345", "Jane Director");
    });

    expect(result.current.user?.email).toBe("director@fund.org");
    expect(result.current.user?.displayName).toBe("Jane Director");
  });

  it("rejects weak passwords during sign up", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    let caughtMessage = "";
    await act(async () => {
      try {
        await result.current.signUpWithEmail("user@fund.org", "123");
      } catch (err) {
        caughtMessage = (err as Error).message;
      }
    });

    expect(caughtMessage).toBe("Password must be at least 6 characters long.");
    expect(result.current.error).toBe("Password must be at least 6 characters long.");
  });


  it("signs in with Google in mock mode", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.signInWithGoogle();
    });

    expect(result.current.user).not.toBeNull();
    expect(result.current.user?.displayName).toContain("Google");
  });

  it("signs out and clears stored session", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.signInAsDemoUser("cfo");
    });
    expect(result.current.user).not.toBeNull();

    await act(async () => {
      await result.current.signOut();
    });
    expect(result.current.user).toBeNull();
  });

  it("clears error state when clearError is invoked", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      try {
        await result.current.signUpWithEmail("invalid", "short");
      } catch {
        // Expected
      }
    });

    expect(result.current.error).toBe("Password must be at least 6 characters long.");

    act(() => {
      result.current.clearError();
    });

    expect(result.current.error).toBeNull();
  });
});

