"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, type ReactNode } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  signInWithPopup,
  signOut as fbSignOut,
  type User as FirebaseUser,
} from "firebase/auth";
import { isFirebaseConfigured, getFirebaseAuth, getGoogleAuthProvider } from "./client";
import { type AuthUser, type AuthContextValue, type DemoRole, DEMO_USERS } from "./types";

const MOCK_STORAGE_KEY = "reserve_juggler_mock_auth_user";

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function mapFirebaseUser(user: FirebaseUser): AuthUser {
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName || user.email?.split("@")[0] || "Treasury User",
    photoURL: user.photoURL,
    isAnonymous: user.isAnonymous,
  };
}

function getStoredMockUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(MOCK_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

function setStoredMockUser(user: AuthUser | null) {
  if (typeof window === "undefined") return;
  try {
    if (user) {
      window.localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(user));
    } else {
      window.localStorage.removeItem(MOCK_STORAGE_KEY);
    }
  } catch {
    // ignore localStorage quota errors
  }
}

function translateAuthError(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String((error as { code: string }).code);
    switch (code) {
      case "auth/invalid-credential":
      case "auth/user-not-found":
      case "auth/wrong-password":
        return "Invalid email or password.";
      case "auth/email-already-in-use":
        return "An account with this email address already exists.";
      case "auth/weak-password":
        return "Password must be at least 6 characters long.";
      case "auth/invalid-email":
        return "Please enter a valid email address.";
      case "auth/popup-closed-by-user":
        return "Google sign-in popup was cancelled.";
      case "auth/network-request-failed":
        return "Network connection error. Please check your internet connection.";
      case "auth/too-many-requests":
        return "Access temporarily blocked due to multiple failed attempts. Please try again later.";
      default:
        break;
    }
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "An unexpected authentication error occurred. Please try again.";
}

export interface AuthProviderProps {
  children: ReactNode;
  /** Explicitly override user for test or preview environments */
  initialUser?: AuthUser | null;
  /** Force mock mode even if environment variables are set */
  forceMock?: boolean;
}

export function AuthProvider({ children, initialUser, forceMock }: AuthProviderProps) {
  const isMock = forceMock || !isFirebaseConfigured();
  const [user, setUser] = useState<AuthUser | null>(() => {
    if (initialUser !== undefined) return initialUser;
    if (isMock) {
      return getStoredMockUser();
    }
    return null;
  });
  const [loading, setLoading] = useState<boolean>(() => {
    if (initialUser !== undefined || isMock) return false;
    return true;
  });
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  // Listen to Firebase auth external system
  useEffect(() => {
    if (initialUser !== undefined || isMock) {
      return;
    }

    const auth = getFirebaseAuth();
    if (!auth) {
      return;
    }

    const unsubscribe = onAuthStateChanged(
      auth,
      (firebaseUser) => {
        if (firebaseUser) {
          setUser(mapFirebaseUser(firebaseUser));
        } else {
          setUser(null);
        }
        setLoading(false);
      },
      (err) => {
        setError(translateAuthError(err));
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [isMock, initialUser]);


  const signInWithEmail = useCallback(
    async (email: string, password: string) => {
      setError(null);
      setLoading(true);
      try {
        const trimmedEmail = email.trim();
        if (!trimmedEmail) throw new Error("Email is required.");
        if (!password) throw new Error("Password is required.");

        if (isMock) {
          // Mock login simulation with small realistic latency
          await new Promise((resolve) => setTimeout(resolve, 200));
          const name = trimmedEmail.split("@")[0] || "Treasury Analyst";
          const mockUser: AuthUser = {
            uid: `mock-${Date.now()}`,
            email: trimmedEmail,
            displayName: name.charAt(0).toUpperCase() + name.slice(1),
            photoURL: null,
            role: "Treasury Specialist",
          };
          setUser(mockUser);
          setStoredMockUser(mockUser);
          return;
        }

        const auth = getFirebaseAuth();
        if (!auth) throw new Error("Firebase Auth is not initialized.");
        const credential = await signInWithEmailAndPassword(auth, trimmedEmail, password);
        setUser(mapFirebaseUser(credential.user));
      } catch (err) {
        const msg = translateAuthError(err);
        setError(msg);
        throw new Error(msg);
      } finally {
        setLoading(false);
      }
    },
    [isMock],
  );

  const signUpWithEmail = useCallback(
    async (email: string, password: string, displayName?: string) => {
      setError(null);
      setLoading(true);
      try {
        const trimmedEmail = email.trim();
        if (!trimmedEmail) throw new Error("Email is required.");
        if (password.length < 6) throw new Error("Password must be at least 6 characters long.");

        if (isMock) {
          await new Promise((resolve) => setTimeout(resolve, 200));
          const name = displayName?.trim() || trimmedEmail.split("@")[0] || "Treasury Member";
          const mockUser: AuthUser = {
            uid: `mock-${Date.now()}`,
            email: trimmedEmail,
            displayName: name,
            photoURL: null,
            role: "Treasury Analyst",
          };
          setUser(mockUser);
          setStoredMockUser(mockUser);
          return;
        }

        const auth = getFirebaseAuth();
        if (!auth) throw new Error("Firebase Auth is not initialized.");
        const credential = await createUserWithEmailAndPassword(auth, trimmedEmail, password);
        if (displayName?.trim() && credential.user) {
          try {
            await updateProfile(credential.user, { displayName: displayName.trim() });
          } catch {
            // Profile update non-fatal
          }
        }
        setUser(mapFirebaseUser(credential.user));
      } catch (err) {
        const msg = translateAuthError(err);
        setError(msg);
        throw new Error(msg);
      } finally {
        setLoading(false);
      }
    },
    [isMock],
  );

  const signInWithGoogle = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      if (isMock) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        const mockUser: AuthUser = {
          uid: `google-mock-${Date.now()}`,
          email: "alex.vance@institutional-treasury.com",
          displayName: "Alex Vance (Google Auth)",
          photoURL: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop",
          role: "Institutional Risk Manager",
        };
        setUser(mockUser);
        setStoredMockUser(mockUser);
        return;
      }

      const auth = getFirebaseAuth();
      const provider = getGoogleAuthProvider();
      if (!auth || !provider) throw new Error("Firebase Google Auth is not configured.");
      const credential = await signInWithPopup(auth, provider);
      setUser(mapFirebaseUser(credential.user));
    } catch (err) {
      const msg = translateAuthError(err);
      setError(msg);
      throw new Error(msg);
    } finally {
      setLoading(false);
    }
  }, [isMock]);

  const signInAsDemoUser = useCallback(
    async (role: DemoRole = "analyst") => {
      setError(null);
      setLoading(true);
      try {
        await new Promise((resolve) => setTimeout(resolve, 150));
        const demoUser = DEMO_USERS[role];
        setUser(demoUser);
        setStoredMockUser(demoUser);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const signOut = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      if (!isMock) {
        const auth = getFirebaseAuth();
        if (auth) {
          await fbSignOut(auth);
        }
      }
      setUser(null);
      setStoredMockUser(null);
    } catch (err) {
      const msg = translateAuthError(err);
      setError(msg);
      throw new Error(msg);
    } finally {
      setLoading(false);
    }
  }, [isMock]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      error,
      isMock,
      signInWithEmail,
      signUpWithEmail,
      signInWithGoogle,
      signInAsDemoUser,
      signOut,
      clearError,
    }),
    [user, loading, error, isMock, signInWithEmail, signUpWithEmail, signInWithGoogle, signInAsDemoUser, signOut, clearError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
