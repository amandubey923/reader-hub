"use client";

import React, { createContext, useContext, useEffect, useState, ReactNode } from "react";
import {
  User,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
} from "firebase/auth";
import { getFirebaseAuth, getGoogleProvider } from "@/lib/firebase";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  error: string | null;
  signInWithGoogle: () => Promise<User | null>;
  signOutUser: () => Promise<void>;
  clearAuthError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const authInstance = getFirebaseAuth();
    if (!authInstance) {
      setLoading(false);
      return;
    }

    // Explicitly enforce browserLocalPersistence for session resilience across browser restarts
    setPersistence(authInstance, browserLocalPersistence).catch((err) => {
      console.warn("[Auth] setPersistence notice:", err);
    });

    const unsubscribe = onAuthStateChanged(
      authInstance,
      (currentUser) => {
        setUser(currentUser);
        setLoading(false);
        if (currentUser) {
          // Asynchronously ensure Firestore /users/{uid} document exists
          import("@/lib/firestore-sync").then(({ syncUserProfile }) => {
            syncUserProfile(currentUser).catch((err) => {
              console.warn("[Auth] syncUserProfile background error:", err);
            });
          });
        }
      },
      (err) => {
        console.error("[Auth] Auth state observer error:", err);
        setError(err.message);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const signInWithGoogle = async (): Promise<User | null> => {
    const authInstance = getFirebaseAuth();
    const providerInstance = getGoogleProvider();

    if (!authInstance || !providerInstance) {
      setError("Firebase Authentication could not be initialized in this browser session.");
      return null;
    }

    try {
      setError(null);
      // Ensure persistent storage before opening sign-in popup
      await setPersistence(authInstance, browserLocalPersistence);
      const result = await signInWithPopup(authInstance, providerInstance);
      setUser(result.user);
      return result.user;
    } catch (err: any) {
      const code = err?.code || "";
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
        console.log("[Auth] Sign-in popup closed by user.");
        return null;
      }

      let friendlyMessage = "Failed to sign in with Google. Please try again.";
      if (code === "auth/popup-blocked") {
        friendlyMessage = "Popup was blocked by your browser. Please allow popups for Reader's HUB and try again.";
      } else if (code === "auth/unauthorized-domain") {
        friendlyMessage = "This domain is not authorized in Firebase Console. Please add localhost / this domain to Firebase Auth Authorized Domains.";
      } else if (code === "auth/operation-not-allowed") {
        friendlyMessage = "Google provider is not enabled in Firebase Console. Please enable Google Sign-In in Firebase Authentication settings.";
      } else if (code === "auth/network-request-failed") {
        friendlyMessage = "Network error. Please check your internet connection and try again.";
      } else if (err?.message) {
        friendlyMessage = err.message;
      }

      console.error("[Auth] Google Sign-In notice:", code, err);
      setError(friendlyMessage);
      return null;
    }
  };

  const signOutUser = async () => {
    const authInstance = getFirebaseAuth();
    if (!authInstance) return;
    try {
      // Send the last few seconds of debounced changes while this account can still write them (capped so logout never hangs).
      // The account's local copy is kept either way and is reconciled on the next sign-in.
      try {
        const { flushAllPendingSyncs } = await import("@/lib/firestore-sync");
        await Promise.race([flushAllPendingSyncs(), new Promise((resolve) => setTimeout(resolve, 3000))]);
      } catch {}
      await signOut(authInstance);
      setUser(null);
    } catch (err: any) {
      console.error("[Auth] Sign-out error:", err);
      setError(err.message || "Failed to sign out.");
    }
  };

  const clearAuthError = () => setError(null);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        error,
        signInWithGoogle,
        signOutUser,
        clearAuthError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

const defaultAuthContext: AuthContextType = {
  user: null,
  loading: false,
  error: null,
  signInWithGoogle: async () => null,
  signOutUser: async () => {},
  clearAuthError: () => {},
};

export function useAuth() {
  const context = useContext(AuthContext);
  return context || defaultAuthContext;
}
