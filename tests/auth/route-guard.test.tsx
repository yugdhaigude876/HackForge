// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuthGuard, withAuth } from "@/components/auth/route-guard";
import { AuthProvider } from "@/lib/firebase/auth-context";
import { DEMO_USERS } from "@/lib/firebase/types";

const mockReplace = vi.fn();
const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
    push: mockPush,
  }),
  usePathname: () => "/dashboard",
}));

describe("Route Guarding and withAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders children when user is authenticated", () => {
    render(
      <AuthProvider initialUser={DEMO_USERS.analyst} forceMock={true}>
        <AuthGuard>
          <div data-testid="protected-content">Secret Treasury Data</div>
        </AuthGuard>
      </AuthProvider>,
    );

    expect(screen.getByTestId("protected-content")).toBeDefined();
    expect(screen.getByText("Secret Treasury Data")).toBeDefined();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("redirects unauthenticated user to login with redirect parameter", () => {
    render(
      <AuthProvider initialUser={null} forceMock={true}>
        <AuthGuard>
          <div data-testid="protected-content">Secret Treasury Data</div>
        </AuthGuard>
      </AuthProvider>,
    );

    expect(screen.queryByTestId("protected-content")).toBeNull();
    expect(mockReplace).toHaveBeenCalledWith("/login?redirect=%2Fdashboard");
  });

  it("renders withAuth HOC correctly for authenticated users", () => {
    function SecretView() {
      return <div data-testid="hoc-view">HOC Protected Content</div>;
    }
    const ProtectedSecretView = withAuth(SecretView);

    render(
      <AuthProvider initialUser={DEMO_USERS.cfo} forceMock={true}>
        <ProtectedSecretView />
      </AuthProvider>,
    );

    expect(screen.getByTestId("hoc-view")).toBeDefined();
  });
});
