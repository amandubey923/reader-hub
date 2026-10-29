import { User } from "firebase/auth";
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  collection,
  query,
  where,
  getDocs,
  limit,
  orderBy,
  runTransaction,
  serverTimestamp,
  getCountFromServer,
} from "firebase/firestore";
import { getFirebaseDb, db, getFirebaseAuth, getAuthHeader } from "./firebase";
import { isAdminUser } from "./admin";
import { Book, BOOKS } from "@/data/books";
import { getGenuinelyCompletedBookIds } from "@/lib/reader-storage";

export interface PublicUserProfile {
  uid: string;
  username: string;
  displayName: string;
  bio: string;
  photoURL: string;
  createdAt: number;
  followersCount: number;
  followingCount: number;
  isPublic: boolean;
  stats: {
    booksCompleted: number;
    currentlyReading: number;
    currentStreak: number;
    longestStreak: number;
    totalReadingSeconds?: number;
    totalActiveSeconds: number;
  };
  achievements: string[];
  updatedAt: number;
}

export interface FollowItem {
  followerUid: string;
  followingUid: string;
  createdAt: number;
}

export interface PublicActivity {
  id: string;
  uid: string;
  username: string;
  displayName: string;
  photoURL?: string;
  type: "completed_book" | "started_book" | "milestone_streak" | "achievement_unlocked";
  bookId?: string;
  bookTitle?: string;
  bookCover?: string;
  details?: string;
  timestamp: number;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  category: "reading" | "streak" | "exploration" | "reflection" | "focus" | "curation";
  unlocked: boolean;
  progress: number; // 0 - 100
  unlockedAt?: number;
  currentValue?: number;
  targetValue?: number;
  unit?: string;
  progressLabel?: string;
}

export const ACHIEVEMENTS_CATALOG: Omit<Achievement, "unlocked" | "progress" | "unlockedAt">[] = [
  // 1. Volume & Books Completed (All 4 original preserved + expanded)
  {
    id: "first_book",
    title: "First Steps",
    description: "Complete your first book on Reader's HUB",
    icon: "🌱",
    category: "reading",
  },
  {
    id: "five_books",
    title: "Avid Reader",
    description: "Complete 5 timeless books or tracks",
    icon: "📚",
    category: "reading",
  },
  {
    id: "ten_books",
    title: "Bookworm",
    description: "Complete 10 books across any literary realm",
    icon: "🐛",
    category: "reading",
  },
  {
    id: "twenty_five_books",
    title: "Scholar",
    description: "Complete 25 books or technical masterworks",
    icon: "🎓",
    category: "reading",
  },
  {
    id: "fifty_books",
    title: "Master of Lore",
    description: "Complete 50 volumes from the grand library",
    icon: "🏛️",
    category: "reading",
  },
  {
    id: "hundred_books",
    title: "Centurion Reader",
    description: "Complete 100 volumes in your reading journey",
    icon: "👑",
    category: "reading",
  },
  {
    id: "page_turner_50",
    title: "Eager Reader",
    description: "Read your first 50 verified book pages",
    icon: "📄",
    category: "reading",
  },
  {
    id: "page_turner_250",
    title: "Chapter Devotee",
    description: "Read 250 verified book pages",
    icon: "📑",
    category: "reading",
  },
  {
    id: "page_turner_1000",
    title: "Millennium Reader",
    description: "Read over 1,000 verified book pages",
    icon: "📜",
    category: "reading",
  },
  {
    id: "page_turner_5000",
    title: "Grand Archivist",
    description: "Read over 5,000 verified book pages",
    icon: "🗝️",
    category: "reading",
  },

  // 2. Streaks & Diya Habits (All 3 original preserved + expanded)
  {
    id: "streak_3",
    title: "Kindled Spark",
    description: "Maintain a 3-day daily reading streak",
    icon: "✨",
    category: "streak",
  },
  {
    id: "streak_7",
    title: "Steady Flame",
    description: "Maintain a 7-day daily reading streak",
    icon: "🔥",
    category: "streak",
  },
  {
    id: "streak_14",
    title: "Fortnight Flame",
    description: "Maintain a 14-day unbroken daily reading habit",
    icon: "🌟",
    category: "streak",
  },
  {
    id: "streak_21",
    title: "Habit Master",
    description: "Achieve 21 consecutive days of dedicated reading",
    icon: "🛡️",
    category: "streak",
  },
  {
    id: "streak_30",
    title: "Eternal Diya",
    description: "Complete a 30-day unbroken reading streak",
    icon: "🪔",
    category: "streak",
  },
  {
    id: "streak_60",
    title: "Guiding Beacon",
    description: "Reach an incredible 60-day reading streak",
    icon: "🏮",
    category: "streak",
  },
  {
    id: "streak_100",
    title: "Century of Light",
    description: "Achieve a legendary 100-day daily reading streak",
    icon: "☀️",
    category: "streak",
  },
  {
    id: "streak_365",
    title: "Timeless Devotion",
    description: "Complete an unbroken 365-day year of daily reading",
    icon: "🌌",
    category: "streak",
  },

  // 3. Genuine Study Focus Time
  {
    id: "reading_time_1h",
    title: "First Hour",
    description: "Accumulate 1 hour of active focus reading",
    icon: "⏱️",
    category: "focus",
  },
  {
    id: "reading_time_5h",
    title: "Deep Focus",
    description: "Accumulate 5 hours of verified PDF focus study",
    icon: "⏳",
    category: "focus",
  },
  {
    id: "reading_time_20h",
    title: "Deep Thinker",
    description: "Accumulate 20 hours of genuine focus study",
    icon: "🧠",
    category: "focus",
  },
  {
    id: "reading_time_50h",
    title: "Master Scholar",
    description: "Accumulate 50 hours of verified focus study",
    icon: "⚡",
    category: "focus",
  },
  {
    id: "reading_time_100h",
    title: "Grand Philosopher",
    description: "Accumulate 100 hours of deep reading study",
    icon: "💎",
    category: "focus",
  },

  // 4. Literary Realms & Categories (Original preserved + expanded)
  {
    id: "three_realms",
    title: "Realm Explorer",
    description: "Read books across 3 different realms",
    icon: "🧭",
    category: "exploration",
  },
  {
    id: "five_realms",
    title: "Wayfarer",
    description: "Read books across 5 distinct literary genres",
    icon: "🗺️",
    category: "exploration",
  },
  {
    id: "eight_realms",
    title: "Cosmopolitan Mind",
    description: "Read books across 8 distinct catalog realms",
    icon: "🌐",
    category: "exploration",
  },
  {
    id: "all_realms",
    title: "Universal Sage",
    description: "Explore books from across all catalog categories",
    icon: "🪐",
    category: "exploration",
  },

  // 5. Reflection, Notes & Annotations (Original preserved + expanded)
  {
    id: "first_reflection",
    title: "Philosopher",
    description: "Write your first reader reflection",
    icon: "✍️",
    category: "reflection",
  },
  {
    id: "five_reflections",
    title: "Modern Socrates",
    description: "Pen 5 thoughtful book reflections",
    icon: "📝",
    category: "reflection",
  },
  {
    id: "ten_reflections",
    title: "Sage of Solitude",
    description: "Pen 10 in-depth book reflections",
    icon: "📖",
    category: "reflection",
  },
  {
    id: "annotator_1",
    title: "Keen Eye",
    description: "Create your first highlight or study note",
    icon: "🔍",
    category: "reflection",
  },
  {
    id: "annotator_25",
    title: "Active Annotator",
    description: "Create 25 study notes, highlights, or markings",
    icon: "✏️",
    category: "reflection",
  },
  {
    id: "annotator_100",
    title: "Master Illuminator",
    description: "Create 100 study notes, highlights, or markings",
    icon: "✒️",
    category: "reflection",
  },

  // 6. Curation & Shelf Mastery
  {
    id: "first_favorite",
    title: "Curator",
    description: "Save your first cherished book to Favorites",
    icon: "❤️",
    category: "curation",
  },
  {
    id: "first_collection",
    title: "Anthologist",
    description: "Curate your first custom personal book collection",
    icon: "📂",
    category: "curation",
  },
  {
    id: "offline_scholar",
    title: "Nomad Reader",
    description: "Save a volume for offline study and access",
    icon: "📦",
    category: "curation",
  },
];

/**
 * Validates a proposed username: 3-20 characters, lowercase alphanumeric and underscores only.
 */
export function isValidUsername(val: string): boolean {
  return /^[a-z0-9_]{3,20}$/.test(val);
}

/**
 * Sanitizes input string into a valid username candidate.
 * Strips leading '@' characters and enforces lowercase alphanumeric with underscores.
 */
export function sanitizeUsername(val: string): string {
  if (!val) return "";
  return val
    .trim()
    .replace(/^@+/, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 20);
}

/**
 * Checks if a username is available in the usernames registry.
 */
export async function isUsernameAvailable(username: string, currentUid?: string): Promise<boolean> {
  const clean = sanitizeUsername(username);
  if (!isValidUsername(clean)) return false;

  const currentDb = getFirebaseDb() || db;
  if (!currentDb) return true;

  try {
    const ref = doc(currentDb, "usernames", clean);
    const snap = await getDoc(ref);
    if (!snap.exists()) return true;
    const data = snap.data();
    return Boolean(currentUid && data.uid === currentUid);
  } catch (err: any) {
    // If Firestore throws permission-denied or network errors, do NOT falsely claim the username is taken!
    console.warn("[Social] isUsernameAvailable check notice:", err?.code || err?.message || err);
    return true;
  }
}

/**
 * Generates an available candidate username suggestion from user's displayName or email.
 */
export async function suggestUsername(
  displayNameOrEmail?: string | null,
  currentUid?: string
): Promise<string> {
  let base = "reader";
  if (displayNameOrEmail) {
    const cleaned = sanitizeUsername(displayNameOrEmail.split("@")[0]);
    if (cleaned.length >= 3) {
      base = cleaned;
    }
  }

  // Check if base itself is available
  if (await isUsernameAvailable(base, currentUid)) {
    return base;
  }

  // Try appending short random numbers
  for (let i = 1; i <= 15; i++) {
    const candidate = `${base.slice(0, 16)}_${Math.floor(10 + Math.random() * 90)}`;
    if (await isUsernameAvailable(candidate, currentUid)) {
      return candidate;
    }
  }

  return `${base.slice(0, 15)}_${Date.now().toString().slice(-4)}`;
}

/**
 * Retrieves a public profile by its unique username with multi-source resolution.
 */
export async function getProfileByUsername(username: string): Promise<PublicUserProfile | null> {
  const clean = sanitizeUsername(username);
  if (!clean) return null;

  // 1. Query Server API endpoint first (uses Firebase Admin SDK and computes live counts)
  if (typeof window !== "undefined") {
    try {
      const res = await fetch(`/api/users/profile?username=${encodeURIComponent(clean)}`);
      if (res.ok) {
        const data = await res.json();
        if (data?.profile) {
          const prof = data.profile as PublicUserProfile;
          prof.displayName = (prof.displayName || prof.username).replace(/^@+/, "").trim();
          try {
            localStorage.setItem(
              `reader_social_profile_${prof.uid}`,
              JSON.stringify(prof)
            );
          } catch {}
          return prof;
        }
      }
    } catch (apiErr) {
      console.warn("[Social] Server profile API notice:", apiErr);
    }
  }

  const currentDb = getFirebaseDb() || db;

  // 2. Try usernames registry doc
  if (currentDb) {
    try {
      const userRef = doc(currentDb, "usernames", clean);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        const { uid } = userSnap.data();
        if (uid) {
          const prof = await getProfileByUid(uid);
          if (prof) return prof;
        }
      }
    } catch (err) {
      console.warn("[Social] getProfileByUsername doc notice:", err);
    }

    // 3. Try querying public_profiles where username == clean
    try {
      const q = query(
        collection(currentDb, "public_profiles"),
        where("username", "==", clean),
        limit(1)
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        const prof = snap.docs[0].data() as PublicUserProfile;
        prof.uid = snap.docs[0].id;
        prof.displayName = (prof.displayName || prof.username).replace(/^@+/, "").trim();
        return prof;
      }
    } catch (err) {
      console.warn("[Social] getProfileByUsername public_profiles query notice:", err);
    }

    // 4. Try querying users collection where username == clean (admin privilege only in firestore.rules)
    const auth = getFirebaseAuth();
    const isAdmin = isAdminUser(auth?.currentUser?.email);
    if (isAdmin) {
      try {
        const q = query(
          collection(currentDb, "users"),
          where("username", "==", clean),
          limit(1)
        );
        const snap = await getDocs(q);
        if (!snap.empty) {
          const uData = snap.docs[0].data();
          const rawDisp = uData.displayName || clean;
          const fallbackProfile: PublicUserProfile = {
            uid: snap.docs[0].id,
            username: uData.username || clean,
            displayName: rawDisp.replace(/^@+/, "").trim(),
            bio: uData.bio || "Passionate reader exploring literature, philosophy & technology on Reader's HUB.",
            photoURL: uData.photoURL || "",
            createdAt: uData.createdAt || Date.now(),
            followersCount: 0,
            followingCount: 0,
            isPublic: true,
            stats: {
              booksCompleted: 0,
              currentlyReading: 0,
              currentStreak: 0,
              longestStreak: 0,
              totalActiveSeconds: 0,
            },
            achievements: [],
            updatedAt: Date.now(),
          };
          return fallbackProfile;
        }
      } catch (err) {
        // Non-fatal if list access is omitted
      }
    }
  }

  // 5. Fallback to local cache if network/Firestore unavailable
  if (typeof window !== "undefined") {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith("reader_social_profile_")) {
          const item = localStorage.getItem(key);
          if (item) {
            const parsed = JSON.parse(item);
            if (parsed?.username && parsed.username.toLowerCase() === clean.toLowerCase()) {
              parsed.displayName = (parsed.displayName || parsed.username).replace(/^@+/, "").trim();
              return parsed;
            }
          }
        }
      }
    } catch {}
  }

  return null;
}

/**
 * Retrieves a public profile by its user UID with multi-layer fallback.
 */
export async function getProfileByUid(uid: string): Promise<PublicUserProfile | null> {
  if (!uid) return null;

  const currentDb = getFirebaseDb() || db;
  if (!currentDb) return null;

  // 1. Try server API first (Admin SDK privileged read with auto-healing and live counts)
  if (typeof window !== "undefined") {
    try {
      const res = await fetch(`/api/users/profile?uid=${encodeURIComponent(uid)}`);
      if (res.ok) {
        const data = await res.json();
        if (data?.profile?.username) {
          const prof = data.profile as PublicUserProfile;
          const rawName = prof.displayName || prof.username || "Reader";
          prof.displayName = typeof rawName === "string" ? rawName.replace(/^@+/, "").trim() : "Reader";
          try {
            localStorage.setItem(`reader_social_profile_${uid}`, JSON.stringify(prof));
          } catch {}
          return prof;
        }
      }
    } catch (apiErr) {
      console.warn("[Social] getProfileByUid API notice:", apiErr);
    }
  }

  // 2. Try client-side public_profiles collection
  try {
    const profRef = doc(currentDb, "public_profiles", uid);
    const snap = await getDoc(profRef);
    if (snap.exists()) {
      const prof = snap.data() as PublicUserProfile;
      prof.uid = uid;
      if (prof.username) {
        const rawName = prof.displayName || prof.username || "Reader";
        prof.displayName = typeof rawName === "string" ? rawName.replace(/^@+/, "").trim() : "Reader";
        if (typeof window !== "undefined") {
          try {
            localStorage.setItem(`reader_social_profile_${uid}`, JSON.stringify(prof));
          } catch {}
        }
        return prof;
      }
    }
  } catch (err) {
    console.warn("[Social] getProfileByUid notice:", err);
  }

  // 3. Check local cache fallback
  if (typeof window !== "undefined") {
    try {
      const cached = localStorage.getItem(`reader_social_profile_${uid}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed?.uid === uid && parsed?.username) {
          const rawName = parsed.displayName || parsed.username || "Reader";
          parsed.displayName = typeof rawName === "string" ? rawName.replace(/^@+/, "").trim() : "Reader";
          return parsed;
        }
      }
    } catch {}
  }

  // 4. Fallback to /users/{uid} document ONLY if the current authenticated user owns this document or is admin
  // Private /users/{uid} is strictly restricted in firestore.rules to (request.auth.uid == userId || isAdmin())
  const auth = getFirebaseAuth();
  const isOwnerOrAdmin = auth?.currentUser?.uid === uid || isAdminUser(auth?.currentUser?.email);
  if (isOwnerOrAdmin) {
    try {
      const userRef = doc(currentDb, "users", uid);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        const data = userSnap.data();
        if (data?.username) {
          const rawName = data.displayName || data.username || "Reader";
          const fallbackProfile: PublicUserProfile = {
            uid,
            username: data.username,
            displayName: typeof rawName === "string" ? rawName.replace(/^@+/, "").trim() : "Reader",
            bio: data.bio || "Passionate reader exploring literature, philosophy & technology on Reader's HUB.",
            photoURL: data.photoURL || "",
            createdAt: data.createdAt || Date.now(),
            followersCount: 0,
            followingCount: 0,
            isPublic: true,
            stats: {
              booksCompleted: 0,
              currentlyReading: 0,
              currentStreak: 0,
              longestStreak: 0,
              totalActiveSeconds: 0,
            },
            achievements: [],
            updatedAt: Date.now(),
          };
          return fallbackProfile;
        }
      }
    } catch (err) {
      // Non-fatal if private document cannot be read
    }
  }

  return null;
}

/**
 * Claims a chosen username and initializes or updates the user's public profile document.
 * Includes resilience against Firestore security rule latency by persisting across multiple layers.
 */
export async function claimUsernameAndCreateProfile(
  user: User,
  chosenUsername: string,
  extra?: { displayName?: string; bio?: string }
): Promise<PublicUserProfile> {
  const currentDb = getFirebaseDb() || db;
  if (!currentDb || !user) throw new Error("Firebase unavailable or user unauthenticated");

  const clean = sanitizeUsername(chosenUsername);
  if (!isValidUsername(clean)) {
    throw new Error("Invalid username. Use 3-20 lowercase letters, numbers, or underscores.");
  }

  const existingProfile = await getProfileByUid(user.uid);
  const oldUsername = existingProfile?.username;

  const newProfile: PublicUserProfile = {
    uid: user.uid,
    username: clean,
    displayName: (
      extra?.displayName?.trim() ||
      existingProfile?.displayName ||
      user.displayName ||
      clean
    )
      .replace(/^@+/, "")
      .trim() || clean,
    bio:
      extra?.bio !== undefined
        ? extra.bio.trim()
        : existingProfile?.bio ||
          "Passionate reader exploring literature, philosophy & technology on Reader's HUB.",
    photoURL: user.photoURL || existingProfile?.photoURL || "",
    createdAt: existingProfile?.createdAt || Date.now(),
    followersCount: existingProfile?.followersCount || 0,
    followingCount: existingProfile?.followingCount || 0,
    isPublic: existingProfile?.isPublic !== false,
    stats: existingProfile?.stats || {
      booksCompleted: 0,
      currentlyReading: 0,
      currentStreak: 0,
      longestStreak: 0,
      totalActiveSeconds: 0,
    },
    achievements: existingProfile?.achievements || [],
    updatedAt: Date.now(),
  };

  // 1. Always persist to the user's authoritative document /users/{uid} first (permitted for request.auth.uid)
  try {
    const userDocRef = doc(currentDb, "users", user.uid);
    await setDoc(
      userDocRef,
      {
        uid: user.uid,
        username: clean,
        displayName: newProfile.displayName,
        bio: newProfile.bio,
        photoURL: newProfile.photoURL,
        updatedAt: Date.now(),
      },
      { merge: true }
    );
  } catch (err) {
    console.warn("[Social] saving username to users/{uid} notice:", err);
  }

  // 2. Cache in localStorage immediately so UI updates instantly without blocking
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(`reader_social_profile_${user.uid}`, JSON.stringify(newProfile));
    } catch {}
  }

  // 3. Atomically register in /usernames and /public_profiles in Firestore
  try {
    await runTransaction(currentDb, async (transaction) => {
      const newUsernameRef = doc(currentDb, "usernames", clean);
      const newUsernameSnap = await transaction.get(newUsernameRef);

      if (newUsernameSnap.exists()) {
        const data = newUsernameSnap.data();
        if (data.uid !== user.uid) {
          throw new Error(`@${clean} is already taken. Please choose another username.`);
        }
      }

      const profileDocRef = doc(currentDb, "public_profiles", user.uid);

      if (oldUsername && oldUsername !== clean) {
        const oldUsernameRef = doc(currentDb, "usernames", oldUsername);
        transaction.delete(oldUsernameRef);
      }

      transaction.set(newUsernameRef, {
        uid: user.uid,
        createdAt: Date.now(),
      });

      transaction.set(profileDocRef, newProfile, { merge: true });
    });
  } catch (err: any) {
    if (err.message && err.message.includes("already taken")) {
      throw err;
    }
    console.warn("[Social] Cloud registry transaction notice (please ensure firestore.rules are published):", err);
  }

  return newProfile;
}

/**
 * Automatically generates a unique username for a new user and claims it consistently
 * across users/{uid}.username, public_profiles/{uid}.username, and usernames/{username}.
 */
export async function autoGenerateAndClaimUsername(user: User): Promise<PublicUserProfile> {
  const currentDb = getFirebaseDb() || db;
  if (!currentDb || !user) throw new Error("Firebase unavailable or user unauthenticated");

  // 1. Derive candidate base username from displayName or email
  let base = "reader";
  if (user.displayName) {
    const cleaned = sanitizeUsername(user.displayName.replace(/\s+/g, "_"));
    if (cleaned.length >= 3) base = cleaned;
  } else if (user.email) {
    const cleaned = sanitizeUsername(user.email.split("@")[0]);
    if (cleaned.length >= 3) base = cleaned;
  }

  // Ensure base is within max length to allow suffixes (3-14 chars)
  base = base.slice(0, 14);
  if (base.length < 3) base = "reader";

  // 2. Find an available candidate
  let chosenUsername = "";
  if (await isUsernameAvailable(base, user.uid)) {
    chosenUsername = base;
  } else {
    for (let i = 0; i < 20; i++) {
      const suffix = Math.floor(1000 + Math.random() * 9000).toString();
      const candidate = `${base.slice(0, 15)}_${suffix}`.slice(0, 20);
      if (await isUsernameAvailable(candidate, user.uid)) {
        chosenUsername = candidate;
        break;
      }
    }
    if (!chosenUsername) {
      chosenUsername = `${base.slice(0, 14)}_${Date.now().toString().slice(-5)}`.slice(0, 20);
    }
  }

  // 3. Claim username and initialize profile
  const rawDisp = user.displayName || chosenUsername;
  const cleanDisplayName = typeof rawDisp === "string" ? rawDisp.replace(/^@+/, "").trim() : chosenUsername;
  const creationTime = user.metadata?.creationTime
    ? new Date(user.metadata.creationTime).getTime()
    : Date.now();

  const newProfile: PublicUserProfile = {
    uid: user.uid,
    username: chosenUsername,
    displayName: cleanDisplayName || chosenUsername,
    bio: "Passionate reader exploring literature, philosophy & technology on Reader's HUB.",
    photoURL: user.photoURL || "",
    createdAt: !isNaN(creationTime) ? creationTime : Date.now(),
    followersCount: 0,
    followingCount: 0,
    isPublic: true,
    stats: {
      booksCompleted: 0,
      currentlyReading: 0,
      currentStreak: 0,
      longestStreak: 0,
      totalReadingSeconds: 0,
      totalActiveSeconds: 0,
    },
    achievements: [],
    updatedAt: Date.now(),
  };

  // 4. Store consistently across all 3 locations:
  // a) users/{uid}.username
  try {
    const userRef = doc(currentDb, "users", user.uid);
    await setDoc(
      userRef,
      {
        uid: user.uid,
        username: chosenUsername,
        displayName: newProfile.displayName,
        photoURL: newProfile.photoURL,
        email: user.email || null,
        updatedAt: Date.now(),
      },
      { merge: true }
    );
  } catch (err) {
    console.warn("[Social] auto-username writing to users/{uid} notice:", err);
  }

  // b) Cache in localStorage
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(`reader_social_profile_${user.uid}`, JSON.stringify(newProfile));
    } catch {}
  }

  // c) Atomically register in usernames/{username} -> { uid } and public_profiles/{uid}
  try {
    await runTransaction(currentDb, async (transaction) => {
      const usernameRef = doc(currentDb, "usernames", chosenUsername);
      const usernameSnap = await transaction.get(usernameRef);
      if (usernameSnap.exists()) {
        const data = usernameSnap.data();
        if (data && data.uid !== user.uid) {
          throw new Error(`@${chosenUsername} is already taken.`);
        }
      }

      transaction.set(usernameRef, {
        uid: user.uid,
        createdAt: Date.now(),
      });

      const profileRef = doc(currentDb, "public_profiles", user.uid);
      transaction.set(profileRef, newProfile, { merge: true });
    });
  } catch (txErr) {
    console.warn("[Social] auto-username transaction notice:", txErr);
  }

  return newProfile;
}

/**
 * Checks if authenticated user has an existing public profile.
 * If user has no username, automatically generates a unique username and claims it.
 */
export async function ensureUserProfile(user: User): Promise<PublicUserProfile | null> {
  const currentDb = getFirebaseDb() || db;
  if (!user) return null;

  try {
    const existing = await getProfileByUid(user.uid);
    if (existing && existing.username) {
      return existing;
    }
    // If no existing profile or missing username, automatically generate & claim one
    return await autoGenerateAndClaimUsername(user);
  } catch (err) {
    console.warn("[Social] ensureUserProfile notice:", err);
    return null;
  }
}

/**
 * Updates a user's public profile fields (display name, username, bio, isPublic).
 * Handles migrating the registered username atomically if changed:
 * releases old username, claims new username, and updates users/{uid} & public_profiles/{uid}.
 */
export async function updateUserProfile(
  uid: string,
  updates: {
    username?: string;
    displayName?: string;
    bio?: string;
    photoURL?: string;
    isPublic?: boolean;
  },
  currentUsername?: string
): Promise<PublicUserProfile> {
  const currentDb = getFirebaseDb() || db;
  if (!currentDb || !uid) throw new Error("Firestore not initialized");

  const cleanNewUsername = updates.username ? sanitizeUsername(updates.username) : undefined;
  const usernameChanged = cleanNewUsername && (!currentUsername || cleanNewUsername !== currentUsername);

  if (usernameChanged && cleanNewUsername) {
    if (!isValidUsername(cleanNewUsername)) {
      throw new Error("Invalid username. Use 3-20 lowercase letters, numbers, or underscores.");
    }
    const available = await isUsernameAvailable(cleanNewUsername, uid);
    if (!available) {
      throw new Error(`@${cleanNewUsername} is already taken. Please choose another username.`);
    }
  }

  const profileRef = doc(currentDb, "public_profiles", uid);
  const userDocRef = doc(currentDb, "users", uid);
  const existing = await getProfileByUid(uid);

  const mergedData: PublicUserProfile = {
    ...(existing || {
      uid,
      username: cleanNewUsername || currentUsername || "reader",
      displayName: (updates.displayName || "Reader").replace(/^@+/, "").trim(),
      bio: updates.bio || "",
      photoURL: updates.photoURL || "",
      createdAt: Date.now(),
      followersCount: 0,
      followingCount: 0,
      isPublic: true,
      stats: {
        booksCompleted: 0,
        currentlyReading: 0,
        currentStreak: 0,
        longestStreak: 0,
        totalActiveSeconds: 0,
      },
      achievements: [],
      updatedAt: Date.now(),
    }),
    ...(updates.displayName !== undefined ? { displayName: updates.displayName.replace(/^@+/, "").trim() } : {}),
    ...(updates.bio !== undefined ? { bio: updates.bio.trim() } : {}),
    ...(updates.photoURL !== undefined ? { photoURL: updates.photoURL } : {}),
    ...(updates.isPublic !== undefined ? { isPublic: updates.isPublic } : {}),
    ...(cleanNewUsername ? { username: cleanNewUsername } : {}),
    updatedAt: Date.now(),
  };

  // Try server API first if user is authenticated (bypasses potential client rule latency)
  let apiSucceeded = false;
  if (typeof window !== "undefined") {
    try {
      const auth = getFirebaseAuth();
      if (auth?.currentUser) {
        const token = await auth.currentUser.getIdToken();
        const res = await fetch("/api/users/profile", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            username: cleanNewUsername,
            displayName: mergedData.displayName,
            bio: mergedData.bio,
            photoURL: mergedData.photoURL,
            isPublic: mergedData.isPublic,
          }),
        });
        if (res.ok) {
          apiSucceeded = true;
        }
      }
    } catch (apiErr) {
      console.warn("[Social] updateUserProfile server API notice:", apiErr);
    }
  }

  if (!apiSucceeded) {
    if (usernameChanged && cleanNewUsername) {
      // Atomically migrate username record in registry and update user & profile
      await runTransaction(currentDb, async (transaction) => {
        const newRef = doc(currentDb, "usernames", cleanNewUsername);
        const newSnap = await transaction.get(newRef);
        if (newSnap.exists()) {
          const data = newSnap.data();
          if (data && data.uid !== uid) {
            throw new Error(`@${cleanNewUsername} is already taken.`);
          }
        }

        if (currentUsername && currentUsername !== cleanNewUsername) {
          const oldRef = doc(currentDb, "usernames", currentUsername);
          transaction.delete(oldRef);
        }

        transaction.set(newRef, { uid, createdAt: Date.now() });
        transaction.set(profileRef, mergedData, { merge: true });
        transaction.set(
          userDocRef,
          {
            username: cleanNewUsername,
            displayName: mergedData.displayName,
            bio: mergedData.bio,
            updatedAt: Date.now(),
          },
          { merge: true }
        );
      });
    } else {
      await Promise.all([
        setDoc(profileRef, mergedData, { merge: true }),
        setDoc(
          userDocRef,
          {
            displayName: mergedData.displayName,
            bio: mergedData.bio,
            updatedAt: Date.now(),
          },
          { merge: true }
        ),
      ]);
    }
  }

  // Update local cache
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(`reader_social_profile_${uid}`, JSON.stringify(mergedData));
    } catch {}
  }

  return mergedData;
}

/**
 * Checks if followerUid is following targetUid.
 */
export async function checkIsFollowing(followerUid: string, targetUid: string): Promise<boolean> {
  if (!followerUid || !targetUid || followerUid === targetUid) return false;

  // 1. Try authoritative server API first (Admin SDK bypasses client latency and rule delays)
  if (typeof window !== "undefined") {
    try {
      const res = await fetch(
        `/api/users/follow?followerUid=${encodeURIComponent(followerUid)}&targetUid=${encodeURIComponent(targetUid)}`
      );
      if (res.ok) {
        const data = await res.json();
        if (typeof data.isFollowing === "boolean") {
          return data.isFollowing;
        }
      }
    } catch (apiErr) {
      console.warn("[Social] checkIsFollowing API notice:", apiErr);
    }
  }

  // 2. Fallback to client Firestore check
  const currentDb = getFirebaseDb() || db;
  if (!currentDb) return false;

  try {
    const followId = `${followerUid}_${targetUid}`;
    const followRef = doc(currentDb, "follows", followId);
    const snap = await getDoc(followRef);
    return snap.exists();
  } catch (err) {
    console.warn("[Social] checkIsFollowing failed:", err);
    return false;
  }
}

/**
 * Follows a user. Increments follower & following counts appropriately.
 * Retrieves authentic follower and following counts directly from the follows collection.
 */
export async function getFollowCounts(
  uid: string
): Promise<{ followersCount: number; followingCount: number }> {
  if (!uid) return { followersCount: 0, followingCount: 0 };

  // 1. Try server API endpoint (powered by Firebase Admin count aggregation)
  if (typeof window !== "undefined") {
    try {
      const res = await fetch(`/api/users/follow?uid=${encodeURIComponent(uid)}`);
      if (res.ok) {
        const data = await res.json();
        if (typeof data.followersCount === "number" && typeof data.followingCount === "number") {
          return {
            followersCount: data.followersCount,
            followingCount: data.followingCount,
          };
        }
      }
    } catch (apiErr) {
      console.warn("[Social] getFollowCounts API notice:", apiErr);
    }
  }

  // 2. Fallback to client Firestore count aggregation
  const currentDb = getFirebaseDb() || db;
  if (currentDb) {
    try {
      const [followersSnap, followingSnap] = await Promise.all([
        getCountFromServer(
          query(collection(currentDb, "follows"), where("followingUid", "==", uid))
        ),
        getCountFromServer(
          query(collection(currentDb, "follows"), where("followerUid", "==", uid))
        ),
      ]);
      return {
        followersCount: followersSnap.data().count || 0,
        followingCount: followingSnap.data().count || 0,
      };
    } catch {
      try {
        const [fSnap, gSnap] = await Promise.all([
          getDocs(query(collection(currentDb, "follows"), where("followingUid", "==", uid), limit(100))),
          getDocs(query(collection(currentDb, "follows"), where("followerUid", "==", uid), limit(100))),
        ]);
        return {
          followersCount: fSnap.size,
          followingCount: gSnap.size,
        };
      } catch {}
    }
  }

  return { followersCount: 0, followingCount: 0 };
}

/**
 * Follows a user. Synchronizes across client Firestore, server API, and local state.
 */
export async function followUser(followerUid: string, targetUid: string): Promise<boolean> {
  if (!followerUid || !targetUid || followerUid === targetUid) return false;

  const currentDb = getFirebaseDb() || db;
  const followId = `${followerUid}_${targetUid}`;

  // 1. Write follow relationship to client Firestore if available
  if (currentDb) {
    try {
      const followRef = doc(currentDb, "follows", followId);
      await setDoc(followRef, {
        followerUid,
        followingUid: targetUid,
        createdAt: Date.now(),
      });
    } catch (fsErr) {
      console.warn("[Social] Client follow write notice:", fsErr);
    }
  }

  // 2. Call server API to perform Admin SDK sync on both user public_profiles
  let targetFollowers: number | null = null;
  let followerFollowing: number | null = null;

  if (typeof window !== "undefined") {
    try {
      const res = await fetch("/api/users/follow", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await getAuthHeader()) },
        body: JSON.stringify({ followerUid, targetUid, action: "follow" }),
      });
      if (res.ok) {
        const data = await res.json();
        targetFollowers = data.targetFollowers;
        followerFollowing = data.followerFollowing;
      }
    } catch (apiErr) {
      console.warn("[Social] Follow API notice:", apiErr);
    }
  }

  // 3. Synchronize localStorage cache for both users
  if (typeof window !== "undefined") {
    try {
      const targetCached = localStorage.getItem(`reader_social_profile_${targetUid}`);
      if (targetCached) {
        const parsed = JSON.parse(targetCached);
        parsed.followersCount =
          targetFollowers !== null ? targetFollowers : (parsed.followersCount || 0) + 1;
        localStorage.setItem(`reader_social_profile_${targetUid}`, JSON.stringify(parsed));
      }

      const followerCached = localStorage.getItem(`reader_social_profile_${followerUid}`);
      if (followerCached) {
        const parsed = JSON.parse(followerCached);
        parsed.followingCount =
          followerFollowing !== null ? followerFollowing : (parsed.followingCount || 0) + 1;
        localStorage.setItem(`reader_social_profile_${followerUid}`, JSON.stringify(parsed));
      }

      // Dispatch global event for live UI reactivity across all mounted components
      window.dispatchEvent(
        new CustomEvent("readers_hub_follow_changed", {
          detail: {
            followerUid,
            targetUid,
            isFollowing: true,
            targetFollowers,
            followerFollowing,
          },
        })
      );
    } catch {}
  }

  return true;
}

/**
 * Unfollows a user. Synchronizes across client Firestore, server API, and local state.
 */
export async function unfollowUser(followerUid: string, targetUid: string): Promise<boolean> {
  if (!followerUid || !targetUid || followerUid === targetUid) return false;

  const currentDb = getFirebaseDb() || db;
  const followId = `${followerUid}_${targetUid}`;

  // 1. Delete follow relationship from client Firestore if available
  if (currentDb) {
    try {
      const followRef = doc(currentDb, "follows", followId);
      await deleteDoc(followRef);
    } catch (fsErr) {
      console.warn("[Social] Client unfollow write notice:", fsErr);
    }
  }

  // 2. Call server API to perform Admin SDK sync on both user public_profiles
  let targetFollowers: number | null = null;
  let followerFollowing: number | null = null;

  if (typeof window !== "undefined") {
    try {
      const res = await fetch("/api/users/follow", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await getAuthHeader()) },
        body: JSON.stringify({ followerUid, targetUid, action: "unfollow" }),
      });
      if (res.ok) {
        const data = await res.json();
        targetFollowers = data.targetFollowers;
        followerFollowing = data.followerFollowing;
      }
    } catch (apiErr) {
      console.warn("[Social] Unfollow API notice:", apiErr);
    }
  }

  // 3. Synchronize localStorage cache for both users
  if (typeof window !== "undefined") {
    try {
      const targetCached = localStorage.getItem(`reader_social_profile_${targetUid}`);
      if (targetCached) {
        const parsed = JSON.parse(targetCached);
        parsed.followersCount =
          targetFollowers !== null
            ? targetFollowers
            : Math.max(0, (parsed.followersCount || 1) - 1);
        localStorage.setItem(`reader_social_profile_${targetUid}`, JSON.stringify(parsed));
      }

      const followerCached = localStorage.getItem(`reader_social_profile_${followerUid}`);
      if (followerCached) {
        const parsed = JSON.parse(followerCached);
        parsed.followingCount =
          followerFollowing !== null
            ? followerFollowing
            : Math.max(0, (parsed.followingCount || 1) - 1);
        localStorage.setItem(`reader_social_profile_${followerUid}`, JSON.stringify(parsed));
      }

      // Dispatch global event for live UI reactivity across all mounted components
      window.dispatchEvent(
        new CustomEvent("readers_hub_follow_changed", {
          detail: {
            followerUid,
            targetUid,
            isFollowing: false,
            targetFollowers,
            followerFollowing,
          },
        })
      );
    } catch {}
  }

  return true;
}

/**
 * Fetches followers of a user.
 */
export async function getFollowers(targetUid: string): Promise<PublicUserProfile[]> {
  if (!targetUid) return [];

  // 1. Try Admin API first for robust, reliable server-side execution
  if (typeof window !== "undefined") {
    try {
      const res = await fetch(`/api/users/follow?uid=${encodeURIComponent(targetUid)}&list=true`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.followers)) {
          return data.followers;
        }
      }
    } catch {}
  }

  // 2. Fallback to client-side Firestore
  const currentDb = getFirebaseDb() || db;
  if (!currentDb) return [];

  try {
    const q = query(
      collection(currentDb, "follows"),
      where("followingUid", "==", targetUid),
      limit(50)
    );
    const snap = await getDocs(q);
    const followerUids = snap.docs.map((d) => d.data().followerUid).filter(Boolean);

    const profiles = await Promise.all(followerUids.map((uid) => getProfileByUid(uid)));
    return profiles.filter((p): p is PublicUserProfile => p !== null);
  } catch (err) {
    console.warn("[Social] getFollowers error:", err);
    return [];
  }
}

/**
 * Fetches users that targetUid is following.
 */
export async function getFollowing(targetUid: string): Promise<PublicUserProfile[]> {
  if (!targetUid) return [];

  // 1. Try Admin API first for robust, reliable server-side execution
  if (typeof window !== "undefined") {
    try {
      const res = await fetch(`/api/users/follow?uid=${encodeURIComponent(targetUid)}&list=true`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.following)) {
          return data.following;
        }
      }
    } catch {}
  }

  // 2. Fallback to client-side Firestore
  const currentDb = getFirebaseDb() || db;
  if (!currentDb) return [];

  try {
    const q = query(
      collection(currentDb, "follows"),
      where("followerUid", "==", targetUid),
      limit(50)
    );
    const snap = await getDocs(q);
    const followingUids = snap.docs.map((d) => d.data().followingUid).filter(Boolean);

    const profiles = await Promise.all(followingUids.map((uid) => getProfileByUid(uid)));
    return profiles.filter((p): p is PublicUserProfile => p !== null);
  } catch (err) {
    console.warn("[Social] getFollowing error:", err);
    return [];
  }
}

/**
 * Fast public user discovery by username or display name prefix.
 * Never searches or leaks private account emails or internal UIDs.
 */
export async function searchUsers(rawQuery: string): Promise<PublicUserProfile[]> {
  const clean = rawQuery.toLowerCase().trim().replace(/^@/, "");
  if (!clean || clean.length < 2) return [];

  // 1. Try server-side API search (powered by Firebase Admin, handles username and displayName)
  if (typeof window !== "undefined") {
    try {
      const res = await fetch(`/api/users/search?q=${encodeURIComponent(clean)}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.readers) && data.readers.length > 0) {
          return data.readers as PublicUserProfile[];
        }
      }
    } catch (apiErr) {
      console.warn("[Social] Server search API notice:", apiErr);
    }
  }

  const currentDb = getFirebaseDb() || db;
  if (!currentDb) return [];

  try {
    const results: PublicUserProfile[] = [];
    const seenUids = new Set<string>();

    // 2. Query public_profiles by username prefix
    try {
      const q = query(
        collection(currentDb, "public_profiles"),
        where("username", ">=", clean),
        where("username", "<=", clean + "\uf8ff"),
        limit(20)
      );
      const snap = await getDocs(q);
      snap.docs.forEach((d) => {
        seenUids.add(d.id);
        const p = d.data() as PublicUserProfile;
        if (p.username) {
          results.push({ ...p, uid: d.id });
        }
      });
    } catch (qErr) {
      console.warn("[Social] prefix query notice:", qErr);
    }

    // 3. Substring & Display Name matching across public_profiles
    try {
      const allQ = query(collection(currentDb, "public_profiles"), limit(50));
      const allSnap = await getDocs(allQ);
      allSnap.docs.forEach((docSnap) => {
        if (!seenUids.has(docSnap.id)) {
          const item = docSnap.data() as PublicUserProfile;
          const u = (item.username || "").toLowerCase();
          const d = (item.displayName || "").toLowerCase();
          if ((u && u.includes(clean)) || (d && d.includes(clean))) {
            seenUids.add(docSnap.id);
            results.push({ ...item, uid: docSnap.id });
          }
        }
      });
    } catch (allErr) {
      console.warn("[Social] all profiles query notice:", allErr);
    }

    // 4. Try usernames registry doc directly if exact username match
    try {
      const exactDoc = await getDoc(doc(currentDb, "usernames", clean));
      if (exactDoc.exists()) {
        const uData = exactDoc.data();
        if (uData?.uid && !seenUids.has(uData.uid)) {
          const prof = await getProfileByUid(uData.uid);
          if (prof && prof.username) {
            seenUids.add(prof.uid);
            results.push(prof);
          }
        }
      }
    } catch (uDocErr) {
      // Non-fatal
    }

    return results;
  } catch (err) {
    console.warn("[Social] searchUsers fallback error:", err);
    return [];
  }
}

/**
 * Records a public reading activity event (completed book, started book, milestone).
 */
export async function recordPublicActivity(activity: Omit<PublicActivity, "id">): Promise<void> {
  const currentDb = getFirebaseDb() || db;
  if (!currentDb || !activity.uid) return;

  try {
    const actCol = collection(currentDb, "public_activities");
    const actDoc = doc(actCol);
    await setDoc(actDoc, {
      ...activity,
      id: actDoc.id,
      timestamp: activity.timestamp || Date.now(),
    });
  } catch (err) {
    console.warn("[Social] recordPublicActivity notice:", err);
  }
}

/**
 * Fetches recent public activities for a user.
 */
export async function getUserPublicActivities(uid: string, limitCount = 20): Promise<PublicActivity[]> {
  if (!uid) return [];

  const currentDb = getFirebaseDb() || db;
  if (!currentDb) return [];

  try {
    const q = query(
      collection(currentDb, "public_activities"),
      where("uid", "==", uid),
      orderBy("timestamp", "desc"),
      limit(limitCount)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as PublicActivity);
  } catch (err) {
    // If composite index is pending, fallback query without orderBy and sort locally
    try {
      const fallbackQ = query(
        collection(currentDb, "public_activities"),
        where("uid", "==", uid),
        limit(limitCount)
      );
      const snap = await getDocs(fallbackQ);
      return snap.docs
        .map((d) => d.data() as PublicActivity)
        .sort((a, b) => b.timestamp - a.timestamp);
    } catch {
      return [];
    }
  }
}

/**
 * Calculates user achievements dynamically based on genuine Reader Hub data.
 */
export function calculateUserAchievements(
  readingHistory: { bookId: string; progress: number; page: number; totalPages: number }[] = [],
  streakData: { currentStreak?: number; longestStreak?: number } = {},
  reflections: Record<string, any> = {},
  booksCatalog: Book[] = BOOKS,
  extraActivity?: {
    totalPagesRead?: number;
    totalReadingSeconds?: number;
    totalActiveSeconds?: number;
    totalAnnotations?: number;
    favoritesCount?: number;
    collectionsCount?: number;
    offlineCount?: number;
    memories?: Record<string, any>;
    uid?: string | null;
  }
): Achievement[] {
  let completedCount = 0;
  try {
    const genuinelyCompleted = getGenuinelyCompletedBookIds(
      readingHistory as any,
      extraActivity?.memories,
      extraActivity?.uid
    );
    const completedSet = new Set(genuinelyCompleted);
    const completedBooks = readingHistory.filter(
      (h) => completedSet.has(h.bookId) || (h.totalPages > 0 && h.page >= h.totalPages)
    );
    completedCount = completedBooks.length;
  } catch {
    completedCount = readingHistory.filter(
      (h) => h.totalPages > 0 && h.page >= h.totalPages
    ).length;
  }

  const currentStreak = streakData.currentStreak || 0;
  const longestStreak = Math.max(currentStreak, streakData.longestStreak || 0);

  const reflectionCount = Object.keys(reflections || {}).length;

  // Real distinct categories/realms read
  const distinctCategories = new Set<string>();
  readingHistory.forEach((h) => {
    const b = booksCatalog.find((book) => book.id === h.bookId);
    if (b && b.category) distinctCategories.add(b.category);
  });
  const realmsCount = distinctCategories.size;

  // Pages read
  let totalPagesRead = extraActivity?.totalPagesRead || 0;
  if (!totalPagesRead && readingHistory.length > 0) {
    totalPagesRead = readingHistory.reduce((acc, cur) => acc + (cur.page || 0), 0);
  }

  const readingMinutes = Math.floor((extraActivity?.totalReadingSeconds || 0) / 60);
  const totalAnnotations = extraActivity?.totalAnnotations || 0;
  const favoritesCount = extraActivity?.favoritesCount || 0;
  const collectionsCount = extraActivity?.collectionsCount || 0;
  const offlineCount = extraActivity?.offlineCount || 0;

  return ACHIEVEMENTS_CATALOG.map((cat) => {
    let unlocked = false;
    let progress = 0;
    let currentValue = 0;
    let targetValue = 0;
    let unit = "";

    switch (cat.id) {
      // 1. Volume & Books Completed
      case "first_book":
        targetValue = 1;
        currentValue = completedCount;
        unit = "books";
        unlocked = completedCount >= 1;
        progress = Math.min(100, (completedCount / 1) * 100);
        break;
      case "five_books":
        targetValue = 5;
        currentValue = completedCount;
        unit = "books";
        unlocked = completedCount >= 5;
        progress = Math.min(100, (completedCount / 5) * 100);
        break;
      case "ten_books":
        targetValue = 10;
        currentValue = completedCount;
        unit = "books";
        unlocked = completedCount >= 10;
        progress = Math.min(100, (completedCount / 10) * 100);
        break;
      case "twenty_five_books":
        targetValue = 25;
        currentValue = completedCount;
        unit = "books";
        unlocked = completedCount >= 25;
        progress = Math.min(100, (completedCount / 25) * 100);
        break;
      case "fifty_books":
        targetValue = 50;
        currentValue = completedCount;
        unit = "books";
        unlocked = completedCount >= 50;
        progress = Math.min(100, (completedCount / 50) * 100);
        break;
      case "hundred_books":
        targetValue = 100;
        currentValue = completedCount;
        unit = "books";
        unlocked = completedCount >= 100;
        progress = Math.min(100, (completedCount / 100) * 100);
        break;
      case "page_turner_50":
        targetValue = 50;
        currentValue = totalPagesRead;
        unit = "pages";
        unlocked = totalPagesRead >= 50;
        progress = Math.min(100, (totalPagesRead / 50) * 100);
        break;
      case "page_turner_250":
        targetValue = 250;
        currentValue = totalPagesRead;
        unit = "pages";
        unlocked = totalPagesRead >= 250;
        progress = Math.min(100, (totalPagesRead / 250) * 100);
        break;
      case "page_turner_1000":
        targetValue = 1000;
        currentValue = totalPagesRead;
        unit = "pages";
        unlocked = totalPagesRead >= 1000;
        progress = Math.min(100, (totalPagesRead / 1000) * 100);
        break;
      case "page_turner_5000":
        targetValue = 5000;
        currentValue = totalPagesRead;
        unit = "pages";
        unlocked = totalPagesRead >= 5000;
        progress = Math.min(100, (totalPagesRead / 5000) * 100);
        break;

      // 2. Streaks & Diya Habits
      case "streak_3":
        targetValue = 3;
        currentValue = longestStreak;
        unit = "days";
        unlocked = longestStreak >= 3;
        progress = Math.min(100, (longestStreak / 3) * 100);
        break;
      case "streak_7":
        targetValue = 7;
        currentValue = longestStreak;
        unit = "days";
        unlocked = longestStreak >= 7;
        progress = Math.min(100, (longestStreak / 7) * 100);
        break;
      case "streak_14":
        targetValue = 14;
        currentValue = longestStreak;
        unit = "days";
        unlocked = longestStreak >= 14;
        progress = Math.min(100, (longestStreak / 14) * 100);
        break;
      case "streak_21":
        targetValue = 21;
        currentValue = longestStreak;
        unit = "days";
        unlocked = longestStreak >= 21;
        progress = Math.min(100, (longestStreak / 21) * 100);
        break;
      case "streak_30":
        targetValue = 30;
        currentValue = longestStreak;
        unit = "days";
        unlocked = longestStreak >= 30;
        progress = Math.min(100, (longestStreak / 30) * 100);
        break;
      case "streak_60":
        targetValue = 60;
        currentValue = longestStreak;
        unit = "days";
        unlocked = longestStreak >= 60;
        progress = Math.min(100, (longestStreak / 60) * 100);
        break;
      case "streak_100":
        targetValue = 100;
        currentValue = longestStreak;
        unit = "days";
        unlocked = longestStreak >= 100;
        progress = Math.min(100, (longestStreak / 100) * 100);
        break;
      case "streak_365":
        targetValue = 365;
        currentValue = longestStreak;
        unit = "days";
        unlocked = longestStreak >= 365;
        progress = Math.min(100, (longestStreak / 365) * 100);
        break;

      // 3. Genuine Study Focus Time
      case "reading_time_1h":
        targetValue = 60;
        currentValue = readingMinutes;
        unit = "mins";
        unlocked = readingMinutes >= 60;
        progress = Math.min(100, (readingMinutes / 60) * 100);
        break;
      case "reading_time_5h":
        targetValue = 300;
        currentValue = readingMinutes;
        unit = "mins";
        unlocked = readingMinutes >= 300;
        progress = Math.min(100, (readingMinutes / 300) * 100);
        break;
      case "reading_time_20h":
        targetValue = 1200;
        currentValue = readingMinutes;
        unit = "mins";
        unlocked = readingMinutes >= 1200;
        progress = Math.min(100, (readingMinutes / 1200) * 100);
        break;
      case "reading_time_50h":
        targetValue = 3000;
        currentValue = readingMinutes;
        unit = "mins";
        unlocked = readingMinutes >= 3000;
        progress = Math.min(100, (readingMinutes / 3000) * 100);
        break;
      case "reading_time_100h":
        targetValue = 6000;
        currentValue = readingMinutes;
        unit = "mins";
        unlocked = readingMinutes >= 6000;
        progress = Math.min(100, (readingMinutes / 6000) * 100);
        break;

      // 4. Literary Realms & Categories
      case "three_realms":
        targetValue = 3;
        currentValue = realmsCount;
        unit = "realms";
        unlocked = realmsCount >= 3;
        progress = Math.min(100, (realmsCount / 3) * 100);
        break;
      case "five_realms":
        targetValue = 5;
        currentValue = realmsCount;
        unit = "realms";
        unlocked = realmsCount >= 5;
        progress = Math.min(100, (realmsCount / 5) * 100);
        break;
      case "eight_realms":
        targetValue = 8;
        currentValue = realmsCount;
        unit = "realms";
        unlocked = realmsCount >= 8;
        progress = Math.min(100, (realmsCount / 8) * 100);
        break;
      case "all_realms":
        targetValue = 10;
        currentValue = realmsCount;
        unit = "realms";
        unlocked = realmsCount >= 10;
        progress = Math.min(100, (realmsCount / 10) * 100);
        break;

      // 5. Reflection, Notes & Annotations
      case "first_reflection":
        targetValue = 1;
        currentValue = reflectionCount;
        unit = "reflections";
        unlocked = reflectionCount >= 1;
        progress = Math.min(100, (reflectionCount / 1) * 100);
        break;
      case "five_reflections":
        targetValue = 5;
        currentValue = reflectionCount;
        unit = "reflections";
        unlocked = reflectionCount >= 5;
        progress = Math.min(100, (reflectionCount / 5) * 100);
        break;
      case "ten_reflections":
        targetValue = 10;
        currentValue = reflectionCount;
        unit = "reflections";
        unlocked = reflectionCount >= 10;
        progress = Math.min(100, (reflectionCount / 10) * 100);
        break;
      case "annotator_1":
        targetValue = 1;
        currentValue = totalAnnotations;
        unit = "annotations";
        unlocked = totalAnnotations >= 1;
        progress = Math.min(100, (totalAnnotations / 1) * 100);
        break;
      case "annotator_25":
        targetValue = 25;
        currentValue = totalAnnotations;
        unit = "annotations";
        unlocked = totalAnnotations >= 25;
        progress = Math.min(100, (totalAnnotations / 25) * 100);
        break;
      case "annotator_100":
        targetValue = 100;
        currentValue = totalAnnotations;
        unit = "annotations";
        unlocked = totalAnnotations >= 100;
        progress = Math.min(100, (totalAnnotations / 100) * 100);
        break;

      // 6. Curation & Shelf Mastery
      case "first_favorite":
        targetValue = 1;
        currentValue = favoritesCount;
        unit = "favorites";
        unlocked = favoritesCount >= 1;
        progress = Math.min(100, (favoritesCount / 1) * 100);
        break;
      case "first_collection":
        targetValue = 1;
        currentValue = collectionsCount;
        unit = "collections";
        unlocked = collectionsCount >= 1;
        progress = Math.min(100, (collectionsCount / 1) * 100);
        break;
      case "offline_scholar":
        targetValue = 1;
        currentValue = offlineCount;
        unit = "saved books";
        unlocked = offlineCount >= 1;
        progress = Math.min(100, (offlineCount / 1) * 100);
        break;

      default:
        unlocked = false;
        progress = 0;
    }

    const cappedCurrent = targetValue > 0 ? Math.min(currentValue, targetValue) : currentValue;
    const progressLabel = targetValue > 0 ? `${cappedCurrent} / ${targetValue} ${unit}` : undefined;

    return {
      ...cat,
      unlocked,
      progress: Math.round(progress),
      currentValue,
      targetValue,
      unit,
      progressLabel,
    };
  });
}

/**
 * Synchronizes real reading statistics and earned achievements into the user's public profile.
 * Merges existing earned achievements additively to ensure no badge is ever lost.
 */
export async function syncPublicProfileMetrics(
  uid: string,
  readingHistory: { bookId: string; progress: number; page: number; totalPages: number }[],
  streakData: { currentStreak?: number; longestStreak?: number },
  totalActiveSeconds: number,
  reflections: Record<string, any> = {},
  totalReadingSeconds: number = 0,
  memories: Record<string, any> = {},
  extraActivity?: {
    totalPagesRead?: number;
    totalAnnotations?: number;
    favoritesCount?: number;
    collectionsCount?: number;
    offlineCount?: number;
  }
): Promise<void> {
  if (!uid) return;

  // IMPORTANT: Verify that client is authenticated as this UID or admin before attempting client Firestore write.
  // firestore.rules strictly requires: (request.auth.uid == userId || isAdmin())
  const auth = getFirebaseAuth();
  const currentUser = auth?.currentUser;
  const isAuthorized = currentUser && (currentUser.uid === uid || isAdminUser(currentUser.email));
  if (!isAuthorized) {
    return;
  }

  const currentDb = getFirebaseDb() || db;
  if (!currentDb) return;

  const genuinelyCompletedIds = new Set(getGenuinelyCompletedBookIds(readingHistory as any, memories, uid));
  const completedBooksCount = genuinelyCompletedIds.size;
  const currentlyReading = readingHistory.filter(
    (h) => !genuinelyCompletedIds.has(h.bookId) && h.progress > 0 && (h.totalPages <= 0 || h.page < h.totalPages)
  );

  const achievements = calculateUserAchievements(
    readingHistory,
    streakData,
    reflections,
    BOOKS,
    {
      ...extraActivity,
      totalReadingSeconds,
      totalActiveSeconds,
      memories,
      uid,
    }
  );
  const earnedAchievementIds = achievements.filter((a) => a.unlocked).map((a) => a.id);

  try {
    const profRef = doc(currentDb, "public_profiles", uid);
    
    // Safely retrieve existing profile to preserve all previously earned achievements
    let existingEarnedIds: string[] = [];
    try {
      const profSnap = await getDoc(profRef);
      if (profSnap.exists() && Array.isArray(profSnap.data()?.achievements)) {
        existingEarnedIds = profSnap.data()?.achievements || [];
      }
    } catch {
      // Non-fatal if read is skipped
    }

    const mergedAchievements = Array.from(new Set([...existingEarnedIds, ...earnedAchievementIds]));

    const currentStreak = Math.max(0, streakData.currentStreak || 0);
    const longestStreak = Math.max(0, streakData.longestStreak || 0);
    const safeReadingSeconds = Math.max(0, totalReadingSeconds || 0);
    const safeActiveSeconds = Math.max(0, totalActiveSeconds || 0, safeReadingSeconds);

    await setDoc(
      profRef,
      {
        stats: {
          booksCompleted: completedBooksCount,
          currentlyReading: currentlyReading.length,
          currentStreak,
          longestStreak,
          totalReadingSeconds: safeReadingSeconds,
          totalActiveSeconds: safeActiveSeconds,
        },
        achievements: mergedAchievements,
        updatedAt: Date.now(),
      },
      { merge: true }
    );
  } catch (err) {
    console.warn("[Social] syncPublicProfileMetrics note:", err);
  }
}


