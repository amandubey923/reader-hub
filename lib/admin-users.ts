import { getFirebaseDb, db } from "@/lib/firebase";
import { normalizeProgressItem } from "@/lib/reading-merge";
import { User } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
} from "firebase/firestore";
import { getActivityStatus, ActivityStatus } from "./active-tracker";
import { PublicUserProfile, PublicActivity } from "./social";
import { ReadingCollection } from "./reader-storage";

export interface AdminUserListItem {
  uid: string;
  email: string; // Strictly ADMIN-ONLY
  displayName: string;
  username: string | null;
  photoURL?: string;
  lastLoginAt?: number;
  lastActiveAt?: number;
  createdAt?: number;
  status: ActivityStatus;
  booksCompleted: number;
  currentlyReading: number;
  followersCount: number;
  followingCount: number;
  isPublic: boolean;
}

export interface UserDeepInspectionData {
  uid: string;
  email: string;
  displayName: string;
  username: string;
  photoURL?: string;
  bio?: string;
  lastLoginAt?: number;
  lastActiveAt?: number;
  createdAt?: number;
  booksCompleted: number;
  currentlyReading: number;
  currentStreak: number;
  longestStreak: number;
  totalReadingSeconds?: number;
  totalActiveSeconds: number;
  followersCount: number;
  followingCount: number;
  isPublic: boolean;
  // Deep inspection items loaded exclusively on demand:
  favorites: string[];
  collections: ReadingCollection[];
  readingProgress: Array<{
    bookId: string;
    page: number;
    totalPages: number;
    progress: number;
    lastReadAt?: number;
  }>;
  reflections: Record<string, { reflection: string; rating?: number; updatedAt: number }>;
  recentActivities: PublicActivity[];
}

/**
 * Scalable fetcher for Admin Users table.
 * Fetches user records from `/users` and hydrates with `/public_profiles` in batch.
 * Does NOT perform N+1 subcollection queries.
 * First tries the authorized server API (/api/admin/users) which connects directly
 * to real Firebase Auth accounts and merges with Firestore public_profiles + users.
 * Falls back to direct Firestore /users query if server API is unavailable.
 */
export async function getAdminUsersList(options?: {
  limitCount?: number;
  currentUser?: User | null;
}): Promise<AdminUserListItem[]> {
  // 1. Try Server-Side Admin API with Bearer token if user is provided
  if (options?.currentUser) {
    try {
      const idToken = await options.currentUser.getIdToken();
      const res = await fetch("/api/admin/users", {
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      });

      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.users)) {
          return json.users.map((u: any) => ({
            uid: u.uid || u.id,
            email: u.email || "No email",
            displayName: u.displayName || "Reader",
            username: u.username || null,
            photoURL: u.photoURL || "",
            lastLoginAt: u.lastSignInAt || u.lastLoginAt,
            lastActiveAt: u.lastActiveAt,
            createdAt: u.createdAt,
            status: getActivityStatus(u.lastActiveAt).status,
            booksCompleted: u.booksCompleted || 0,
            currentlyReading: u.currentlyReading || 0,
            followersCount: u.followersCount || 0,
            followingCount: u.followingCount || 0,
            isPublic: true,
          }));
        }
      }
    } catch (apiErr) {
      console.warn("[AdminUsers] /api/admin/users fetch error, falling back to Firestore:", apiErr);
    }
  }

  // 2. Client-side Firestore Fallback
  const currentDb = getFirebaseDb() || db;
  if (!currentDb) return [];

  const maxUsers = options?.limitCount || 100;

  try {
    const usersCol = collection(currentDb, "users");
    const q = query(usersCol, limit(maxUsers));
    const usersSnap = await getDocs(q);

    if (usersSnap.empty) return [];

    const rawUsers: Array<{
      uid: string;
      email: string;
      displayName?: string;
      photoURL?: string;
      lastLoginAt?: any;
      lastActiveAt?: number;
      createdAt?: number;
    }> = [];

    usersSnap.forEach((snap) => {
      const data = snap.data();
      let lastLogin: number | undefined = undefined;
      if (data.lastLoginAt) {
        if (typeof data.lastLoginAt.toMillis === "function") {
          lastLogin = data.lastLoginAt.toMillis();
        } else if (typeof data.lastLoginAt === "number") {
          lastLogin = data.lastLoginAt;
        }
      }

      rawUsers.push({
        uid: snap.id,
        email: data.email || "No email",
        displayName: data.displayName || "",
        photoURL: data.photoURL || "",
        lastLoginAt: lastLogin,
        lastActiveAt: typeof data.lastActiveAt === "number" ? data.lastActiveAt : undefined,
        createdAt: typeof data.createdAt === "number" ? data.createdAt : undefined,
      });
    });

    // Batch load corresponding public profiles to enrich with username & social metrics
    const profilePromises = rawUsers.map(async (u) => {
      try {
        const profRef = doc(currentDb, "public_profiles", u.uid);
        const pSnap = await getDoc(profRef);
        return pSnap.exists() ? (pSnap.data() as PublicUserProfile) : null;
      } catch {
        return null;
      }
    });

    const profiles = await Promise.all(profilePromises);

    const mergedList: AdminUserListItem[] = rawUsers.map((u, index) => {
      const p = profiles[index];
      const status = getActivityStatus(u.lastActiveAt).status;

      return {
        uid: u.uid,
        email: u.email,
        displayName: u.displayName || p?.displayName || "Reader",
        username: p?.username || u.email.split("@")[0] || "user",
        photoURL: u.photoURL || p?.photoURL || "",
        lastLoginAt: u.lastLoginAt,
        lastActiveAt: u.lastActiveAt,
        createdAt: u.createdAt || p?.createdAt,
        status,
        booksCompleted: p?.stats?.booksCompleted || 0,
        currentlyReading: p?.stats?.currentlyReading || 0,
        followersCount: p?.followersCount || 0,
        followingCount: p?.followingCount || 0,
        isPublic: p?.isPublic !== false,
      };
    });

    return mergedList;
  } catch (err) {
    console.error("[AdminUsers] getAdminUsersList error:", err);
    return [];
  }
}

/**
 * On-demand deep inspection for a single user.
 * Triggered ONLY when admin clicks "Inspect" on a specific user.
 */
export async function fetchUserDeepInspection(
  uid: string,
  currentUser?: User | null
): Promise<UserDeepInspectionData | null> {
  if (!uid) return null;

  // 1. Try server-side Admin API first (privileged Firebase Admin SDK read)
  if (typeof window !== "undefined") {
    try {
      const headers: Record<string, string> = {};
      if (currentUser) {
        try {
          const token = await currentUser.getIdToken();
          if (token) headers["Authorization"] = `Bearer ${token}`;
        } catch (tokErr) {
          console.warn("[AdminUsers] Could not get user token:", tokErr);
        }
      }

      const res = await fetch(`/api/admin/users/${encodeURIComponent(uid)}`, { headers });
      if (res.ok) {
        const json = await res.json();
        if (json?.user) {
          return json.user as UserDeepInspectionData;
        }
      } else {
        const errJson = await res.json().catch(() => null);
        console.warn(`[AdminUsers] /api/admin/users/${uid} returned status ${res.status}:`, errJson);
      }
    } catch (apiErr) {
      console.warn("[AdminUsers] /api/admin/users/[uid] fetch notice, falling back to client:", apiErr);
    }
  }

  const currentDb = getFirebaseDb() || db;
  if (!currentDb) return null;

  try {
    // 2. Client Firestore fallback
    const userRef = doc(currentDb, "users", uid);
    const profRef = doc(currentDb, "public_profiles", uid);

    const [userSnap, profSnap] = await Promise.all([
      getDoc(userRef).catch(() => ({ exists: () => false, data: () => null })),
      getDoc(profRef).catch(() => ({ exists: () => false, data: () => null })),
    ]);

    if (!userSnap.exists() && !profSnap.exists()) return null;

    const userData = userSnap.data() || {};
    const profData = (profSnap.data() as PublicUserProfile) || {};

    let lastLogin: number | undefined = undefined;
    if (userData.lastLoginAt) {
      if (typeof userData.lastLoginAt.toMillis === "function") {
        lastLogin = userData.lastLoginAt.toMillis();
      } else if (typeof userData.lastLoginAt === "number") {
        lastLogin = userData.lastLoginAt;
      }
    }

    // 2. Fetch deep subcollections on demand:
    // a. Favorites
    const favsCol = collection(currentDb, "users", uid, "favorites");
    const favsPromise = getDocs(favsCol).catch(() => ({ docs: [] }));

    // b. Collections
    const collDocRef = doc(currentDb, "users", uid, "data", "collections");
    const collPromise = getDoc(collDocRef).catch(() => ({ exists: () => false, data: () => null }));

    // c. Reading Progress
    const progCol = collection(currentDb, "users", uid, "reading_progress");
    const progPromise = getDocs(progCol).catch(() => ({ docs: [] }));

    // d. Reflections
    const refDocRef = doc(currentDb, "users", uid, "data", "reflections");
    const refPromise = getDoc(refDocRef).catch(() => ({ exists: () => false, data: () => null }));

    // e. Recent Public Activities
    const actCol = collection(currentDb, "public_activities");
    const actQuery = query(
      actCol,
      where("uid", "==", uid),
      orderBy("timestamp", "desc"),
      limit(10)
    );
    const actPromise = getDocs(actQuery).catch(() => ({ docs: [] }));

    const [favsSnap, collSnap, progSnap, refSnap, actSnap] = await Promise.all([
      favsPromise,
      collPromise,
      progPromise,
      refPromise,
      actPromise,
    ]);

    // Format Favorites
    const favorites: string[] = [];
    (favsSnap as any).docs?.forEach((d: any) => {
      const dData = d.data();
      if (dData.isFavorite !== false) {
        favorites.push(d.id);
      }
    });

    // Format Collections
    let collectionsList: ReadingCollection[] = [];
    if (typeof (collSnap as any).exists === "function" && (collSnap as any).exists()) {
      const cData = (collSnap as any).data();
      if (Array.isArray(cData)) {
        collectionsList = cData;
      } else if (cData?.collections && Array.isArray(cData.collections)) {
        collectionsList = cData.collections;
      }
    }

    // Format Reading Progress
    const progressList: Array<{
      bookId: string;
      page: number;
      totalPages: number;
      progress: number;
      lastReadAt?: number;
    }> = [];
    (progSnap as any).docs?.forEach((d: any) => {
      const p = d.data();
      // Shown against the PDF's verified page count (old records may carry a 100-page default)
      const n = normalizeProgressItem({ bookId: d.id, page: p.page || 1, totalPages: Number(p.totalPages) || 0, progress: Number(p.progress) || 0, lastReadAt: 0 }).item;
      progressList.push({
        bookId: d.id,
        page: n.page,
        totalPages: n.totalPages,
        progress: n.progress,
        lastReadAt: p.lastReadAt,
      });
    });

    // Format Reflections
    let reflectionsMap: Record<string, any> = {};
    if (typeof (refSnap as any).exists === "function" && (refSnap as any).exists()) {
      reflectionsMap = (refSnap as any).data() || {};
    }

    // Format Activities
    const recentActivities: PublicActivity[] = [];
    (actSnap as any).docs?.forEach((d: any) => {
      recentActivities.push(d.data() as PublicActivity);
    });

    return {
      uid,
      email: userData.email || "No email",
      displayName: userData.displayName || profData.displayName || "Reader",
      username: profData.username || userData.email?.split("@")[0] || "user",
      photoURL: userData.photoURL || profData.photoURL || "",
      bio: profData.bio || "",
      lastLoginAt: lastLogin,
      lastActiveAt: typeof userData.lastActiveAt === "number" ? userData.lastActiveAt : undefined,
      createdAt: typeof userData.createdAt === "number" ? userData.createdAt : profData.createdAt,
      booksCompleted: profData.stats?.booksCompleted || 0,
      currentlyReading: profData.stats?.currentlyReading || 0,
      currentStreak: profData.stats?.currentStreak || 0,
      longestStreak: profData.stats?.longestStreak || 0,
      totalActiveSeconds: profData.stats?.totalActiveSeconds || 0,
      followersCount: profData.followersCount || 0,
      followingCount: profData.followingCount || 0,
      isPublic: profData.isPublic !== false,
      favorites,
      collections: collectionsList,
      readingProgress: progressList,
      reflections: reflectionsMap,
      recentActivities,
    };
  } catch (err) {
    console.error("[AdminUsers] fetchUserDeepInspection error:", err);
    return null;
  }
}

