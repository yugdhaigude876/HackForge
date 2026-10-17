// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { LoginForm } from "@/app/login/login-form";


import { AuthProvider } from "@/lib/firebase/auth-context";

const mockReplace = vi.fn();
const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
    push: mockPush,
  }),
  useSearchParams: () => new URLSearchParams({ redirect: "/dashboard" }),
}));

describe("LoginForm Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("renders the login form elements correctly", () => {
    render(
      <AuthProvider forceMock={true}>
        <LoginForm />
      </AuthProvider>,
    );

    expect(screen.getByText("Reserve Juggler")).toBeDefined();
    expect(screen.getByLabelText("Work Email")).toBeDefined();
    expect(screen.getByLabelText("Password")).toBeDefined();
    expect(screen.getByRole("button", { name: "Sign In to Terminal" })).toBeDefined();
    expect(screen.getByRole("button", { name: /Continue with Google/i })).toBeDefined();
    expect(screen.getByText("One-Click Demo Personas")).toBeDefined();
  });

  it("toggles between Sign In and Create Account modes", async () => {
    render(
      <AuthProvider forceMock={true}>
        <LoginForm />
      </AuthProvider>,
    );

    expect(screen.queryByLabelText("Full Name")).toBeNull();

    const createAccountTab = screen.getByTestId("tab-signup");
    await act(async () => {
      fireEvent.click(createAccountTab);
    });

    expect(screen.getByLabelText("Full Name")).toBeDefined();
    expect(screen.getByRole("button", { name: "Create Account" })).toBeDefined();
  });

  it("triggers demo persona sign-in", async () => {
    render(
      <AuthProvider forceMock={true}>
        <LoginForm />
      </AuthProvider>,
    );

    const analystButton = screen.getByRole("button", { name: /Analyst/i });
    await act(async () => {
      fireEvent.click(analystButton);
      await vi.waitFor(
        () => {
          expect(mockReplace).toHaveBeenCalledWith("/dashboard");
        },
        { timeout: 2000 },
      );
    });
  });



  it("validates empty submission", async () => {
    render(
      <AuthProvider forceMock={true}>
        <LoginForm />
      </AuthProvider>,
    );

    const form = screen.getByRole("button", { name: "Sign In to Terminal" }).closest("form")!;
    await act(async () => {
      fireEvent.submit(form);
    });

    expect(screen.getByRole("alert")).toBeDefined();
    expect(screen.getByText(/Please enter your email address/i)).toBeDefined();
  });

});
