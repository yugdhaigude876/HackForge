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
import { isMockModeActive, isAuthUnconfigured, getFirebaseAuth, getGoogleAuthProvider } from "./client";
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
      case "auth/unauthorized-domain":
        return "This domain is not authorized for Google Sign-In in Firebase. Add your Vercel domain to Firebase Console > Authentication > Settings > Authorized domains.";
      case "auth/popup-blocked":
        return "Google sign-in popup was blocked by your browser. Please allow popups for this site.";
      case "auth/operation-not-allowed":
        return "Google sign-in is not enabled in Firebase Console. Please enable Google provider in Authentication > Sign-in method.";
      case "auth/cancelled-popup-request":
        return "Google sign-in was cancelled due to another popup opening.";
      default:
        break;
    }
  }
  if (error instanceof Error) {
    if (error.message.includes("auth/unauthorized-domain")) {
      return "This domain is not authorized for Google Sign-In in Firebase. Add your Vercel domain to Firebase Console > Authentication > Settings > Authorized domains.";
    }
    if (error.message.includes("auth/popup-blocked")) {
      return "Google sign-in popup was blocked by your browser. Please allow popups for this site.";
    }
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
  const isUnconfigured = !forceMock && isAuthUnconfigured();
  const isMock = forceMock || isMockModeActive();

  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [user, setUser] = useState<AuthUser | null>(() => {
    if (initialUser !== undefined) return initialUser;
    if (isMock) {
      return getStoredMockUser();
    }
    return null;
  });
  const [loading, setLoading] = useState<boolean>(() => {
    if (initialUser !== undefined || isMock || isUnconfigured) return false;
    return true;
  });
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  // Listen to Firebase auth external system
  useEffect(() => {
    if (initialUser !== undefined || isMock || isUnconfigured) {
      return;
    }

    const auth = getFirebaseAuth();
    if (!auth) {
      return;
    }

    const unsubscribe = onAuthStateChanged(
      auth,
      (fbUser) => {
        setFirebaseUser(fbUser);
        if (fbUser) {
          setUser(mapFirebaseUser(fbUser));
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
  }, [isMock, isUnconfigured, initialUser]);

  const getIdToken = useCallback(
    async (forceRefresh = false): Promise<string | null> => {
      if (isMock || isUnconfigured) {
        return null;
      }
      if (firebaseUser) {
        return await firebaseUser.getIdToken(forceRefresh);
      }
      const auth = getFirebaseAuth();
      if (auth?.currentUser) {
        return await auth.currentUser.getIdToken(forceRefresh);
      }
      return null;
    },
    [isMock, isUnconfigured, firebaseUser]
  );

  const signInWithEmail = useCallback(
    async (email: string, password: string) => {
      setError(null);
      setLoading(true);
      try {
        if (isUnconfigured) {
          throw new Error("Authentication is not configured in this production environment.");
        }

        const trimmedEmail = email.trim();
        if (!trimmedEmail) throw new Error("Email is required.");
        if (!password) throw new Error("Password is required.");

        if (isMock) {
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
        setFirebaseUser(credential.user);
        setUser(mapFirebaseUser(credential.user));
      } catch (err) {
        const msg = translateAuthError(err);
        setError(msg);
        throw new Error(msg);
      } finally {
        setLoading(false);
      }
    },
    [isMock, isUnconfigured],
  );

  const signUpWithEmail = useCallback(
    async (email: string, password: string, displayName?: string) => {
      setError(null);
      setLoading(true);
      try {
        if (isUnconfigured) {
          throw new Error("Authentication is not configured in this production environment.");
        }

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
        setFirebaseUser(credential.user);
        setUser(mapFirebaseUser(credential.user));
      } catch (err) {
        const msg = translateAuthError(err);
        setError(msg);
        throw new Error(msg);
      } finally {
        setLoading(false);
      }
    },
    [isMock, isUnconfigured],
  );

  const signInWithGoogle = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      if (isUnconfigured) {
        throw new Error("Authentication is not configured in this production environment.");
      }

      if (isMock) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        const mockUser: AuthUser = {
          uid: `google-mock-${Date.now()}`,
          email: "alex.vance@institutional-treasury.com",
          displayName: "Alex Vance (Google Auth)",
          photoURL: null,
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
      setFirebaseUser(credential.user);
      setUser(mapFirebaseUser(credential.user));
    } catch (err) {
      const msg = translateAuthError(err);
      setError(msg);
      throw new Error(msg);
    } finally {
      setLoading(false);
    }
  }, [isMock, isUnconfigured]);

  const signInAsDemoUser = useCallback(
    async (role: DemoRole = "analyst") => {
      setError(null);
      setLoading(true);
      try {
        if (isUnconfigured) {
          throw new Error("Demo personas are disabled in unconfigured production environments.");
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
        const demoUser = DEMO_USERS[role];
        setUser(demoUser);
        setStoredMockUser(demoUser);
      } finally {
        setLoading(false);
      }
    },
    [isUnconfigured],
  );

  const signOut = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      if (!isMock && !isUnconfigured) {
        const auth = getFirebaseAuth();
        if (auth) {
          await fbSignOut(auth);
        }
      }
      setFirebaseUser(null);
      setUser(null);
      setStoredMockUser(null);
    } catch (err) {
      const msg = translateAuthError(err);
      setError(msg);
      throw new Error(msg);
    } finally {
      setLoading(false);
    }
  }, [isMock, isUnconfigured]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      error,
      isMock,
      isUnconfigured,
      getIdToken,
      signInWithEmail,
      signUpWithEmail,
      signInWithGoogle,
      signInAsDemoUser,
      signOut,
      clearError,
    }),
    [
      user,
      loading,
      error,
      isMock,
      isUnconfigured,
      getIdToken,
      signInWithEmail,
      signUpWithEmail,
      signInWithGoogle,
      signInAsDemoUser,
      signOut,
      clearError,
    ],
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
