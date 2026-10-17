export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL?: string | null;
  isAnonymous?: boolean;
  role?: string;
}

export type DemoRole = "analyst" | "risk_officer" | "cfo";

export interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  isMock: boolean;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string, displayName?: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInAsDemoUser: (role?: DemoRole) => Promise<void>;
  signOut: () => Promise<void>;
  clearError: () => void;
}

export const DEMO_USERS: Record<DemoRole, AuthUser> = {
  analyst: {
    uid: "mock-user-analyst",
    email: "analyst@reservejuggler.internal",
    displayName: "Alex Vance (Treasury Analyst)",
    photoURL: null,
    role: "Senior Treasury Analyst",
  },
  risk_officer: {
    uid: "mock-user-risk-officer",
    email: "risk@reservejuggler.internal",
    displayName: "Elena Rostova (Chief Risk Officer)",
    photoURL: null,
    role: "Chief Risk Officer",
  },
  cfo: {
    uid: "mock-user-cfo",
    email: "cfo@reservejuggler.internal",
    displayName: "Marcus Sterling (Treasury Director)",
    photoURL: null,
    role: "Treasury Director & CFO",
  },
};
