import { initializeApp, getApps, getApp, FirebaseApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, Auth } from "firebase/auth";
import { getFirestore, Firestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyAra6EtrcmmrfYnxoBFQFSD-YKRiNjbhdQ",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "readers-hub-52be2.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "readers-hub-52be2",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "readers-hub-52be2.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "540362903253",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:540362903253:web:60921c8e8304ce961c5c5c",
};

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let googleProvider: GoogleAuthProvider | null = null;

export function getFirebaseApp(): FirebaseApp | null {
  if (typeof window === "undefined") return null;
  if (!app) {
    try {
      app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
    } catch (e) {
      console.warn("[Firebase] initializeApp notice:", e);
    }
  }
  return app;
}

export function getFirebaseAuth(): Auth | null {
  if (typeof window === "undefined") return null;
  if (!auth) {
    const currentApp = getFirebaseApp();
    if (currentApp) {
      try {
        auth = getAuth(currentApp);
      } catch (e) {
        console.warn("[Firebase] getAuth notice:", e);
      }
    }
  }
  return auth;
}

export function getFirebaseDb(): Firestore | null {
  if (typeof window === "undefined") return null;
  if (!db) {
    const currentApp = getFirebaseApp();
    if (currentApp) {
      try {
        db = getFirestore(currentApp);
      } catch (e) {
        console.warn("[Firebase] getFirestore notice:", e);
      }
    }
  }
  return db;
}

export function getGoogleProvider(): GoogleAuthProvider {
  if (!googleProvider) {
    googleProvider = new GoogleAuthProvider();
    googleProvider.setCustomParameters({ prompt: "select_account" });
  }
  return googleProvider;
}

/**
 * Authorization header for the signed-in reader, or an empty object for guests.
 */
export async function getAuthHeader(): Promise<Record<string, string>> {
  try {
    const token = await getFirebaseAuth()?.currentUser?.getIdToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

// Initial client initialization attempt
if (typeof window !== "undefined") {
  try {
    getFirebaseApp();
    getFirebaseAuth();
    getFirebaseDb();
    getGoogleProvider();
  } catch (err) {
    console.warn("[Firebase] Initial client setup notice:", err);
  }
}

export { app, auth, db, googleProvider };


