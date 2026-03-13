"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import {
  User,
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile
} from "firebase/auth";
import { auth, googleProvider, db } from "./firebase";
import { doc, setDoc, getDoc, serverTimestamp } from "firebase/firestore";
import { API_URL } from "./api";

type UserRole = "admin" | "public" | "rep";
type VerificationStatus = "none" | "pending" | "approved" | "denied";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  role: UserRole | null;
  verified: boolean;
  verificationStatus: VerificationStatus;
  isAdmin: boolean;
  refreshProfile: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signUpWithEmail: (email: string, password: string, displayName: string) => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<UserRole | null>(null);
  const [verified, setVerified] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus>("none");

  const fetchUserProfile = async (firebaseUser: User) => {
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch(`${API_URL}/api/user/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const profile = await res.json();
        setRole(profile.role || "public");
        setVerified(profile.verified || false);
        setVerificationStatus(profile.verificationStatus || "none");
      }
    } catch (error) {
      console.error("Error fetching user profile:", error);
    }
  };

  const refreshProfile = async () => {
    if (user) {
      await fetchUserProfile(user);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          // Create/update user document in Firestore
          const userRef = doc(db, "users", user.uid);
          const userSnap = await getDoc(userRef);

          if (!userSnap.exists()) {
            // New user - create document with role defaults
            await setDoc(userRef, {
              email: user.email,
              displayName: user.displayName || user.email?.split('@')[0] || "User",
              photoURL: user.photoURL,
              role: "public",
              verified: false,
              verificationStatus: "none",
              createdAt: serverTimestamp(),
              lastLogin: serverTimestamp()
            });
          } else {
            // Existing user - update last login
            await setDoc(userRef, {
              lastLogin: serverTimestamp()
            }, { merge: true });
          }
        } catch (error) {
          console.error("Error updating user document in Firestore:", error);
        }

        // Fetch role/verification from backend
        await fetchUserProfile(user);
      } else {
        setRole(null);
        setVerified(false);
        setVerificationStatus("none");
      }
      setUser(user);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const signInWithGoogle = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Error signing in with Google:", error);
      throw error;
    }
  };

  const signUpWithEmail = async (email: string, password: string, displayName: string) => {
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      // Update profile immediately
      await updateProfile(userCredential.user, { displayName });

      // The onAuthStateChanged listener handles the initial document creation,
      // but because updateProfile is async, it might have written the doc WITHOUT the display name.
      // So we force an update here to ensure the display name is saved to the database.
      const userRef = doc(db, "users", userCredential.user.uid);
      await setDoc(userRef, {
        displayName: displayName
      }, { merge: true });

      // Force user state refresh to reflect new display name in UI
      setUser({ ...userCredential.user, displayName } as User);
    } catch (error) {
      console.error("Error signing up with email:", error);
      throw error;
    }
  };

  const signInWithEmail = async (email: string, password: string) => {
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
      console.error("Error signing in with email:", error);
      throw error;
    }
  };

  const signOut = async () => {
    try {
      await firebaseSignOut(auth);
    } catch (error) {
      console.error("Error signing out:", error);
      throw error;
    }
  };

  const isAdmin = role === "admin";

  return (
    <AuthContext.Provider value={{ user, loading, role, verified, verificationStatus, isAdmin, refreshProfile, signInWithGoogle, signUpWithEmail, signInWithEmail, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
