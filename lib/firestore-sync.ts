import { User } from "firebase/auth";
import {
  doc,
  setDoc,
  getDoc,
  collection,
  getDocs,
  serverTimestamp,
  writeBatch,
  deleteDoc,
  updateDoc,
  arrayRemove,
  query,
  where,
  Firestore,
  DocumentReference,
  WriteBatch,
} from "firebase/firestore";
import { db, getFirebaseDb } from "./firebase";
import {
  ReadingProgressItem,
  ReadingStreakData,
  DailyReadingActivity,
  WebsiteActiveTimeData,
  BookReadingMemory,
  BookAnnotations,
  BookmarkItem,
  hydrateStorageFromCloudData,
  ReadingCollection,
  BookReflection,
  ShelfDismissalsMap,
  calculateStreak,
  saveReadingActivityData,
  getReadingActivityData,
  getStoredFavorites,
  saveStoredFavorites,
  getStoredReadingHistory,
  saveStoredReadingHistory,
  getReadingCollections,
  getBookReflections,
  getShelfDismissals,
  getWebsiteActiveTimeData,
  getGenuinelyCompletedBookIds,
  getAllReadingMemories,
  migrateGuestDataToUser,
  getAllBookmarks,
  getAllBookAnnotations,
} from "./reader-storage";
import {
  annotationsAddContent,
  mergeAnnotations,
  mergeBookmarkLists,
  mergeProgressItems,
  mergeCollectionLists,
  mergeReflectionMaps,
  mergeShelfDismissalMaps,
  mergeActiveTime,
  findItemsMissingFromCloud,
} from "./reading-merge";
import { UserEntitlement, DEFAULT_FREE_ENTITLEMENT } from "./entitlements";
import { BOOKS, getBookById } from "@/data/books";

export interface CloudFullUserData {
  favorites: string[];
  readingHistory: ReadingProgressItem[];
  readingActivity: ReadingStreakData;
  activeTime: WebsiteActiveTimeData;
  readingMemories: Record<string, BookReadingMemory>;
  annotations: Record<string, BookAnnotations>;
  collections: ReadingCollection[];
  reflections: Record<string, BookReflection>;
  shelfDismissals: ShelfDismissalsMap;
  completedBookIds?: string[];
  entitlement?: UserEntitlement;
  bookmarks?: Record<string, BookmarkItem[]>;
  /** Sections whose cloud read failed. Their local copies are kept and nothing is written over them. */
  failedSections?: CloudSection[];
}

export const CLOUD_SECTIONS = [
  "favorites",
  "reading_progress",
  "activity",
  "active_time",
  "reading_memory",
  "annotations",
  "collections",
  "reflections",
  "shelf_dismissals",
  "entitlement",
  "bookmarks",
  "completed_books",
] as const;
export type CloudSection = (typeof CLOUD_SECTIONS)[number];

// In-memory debounce timers for non-blocking background writes
const progressDebounceTimers: Record<string, NodeJS.Timeout> = {};
const activityDebounceTimers: Record<string, NodeJS.Timeout> = {};
const activeTimeDebounceTimers: Record<string, NodeJS.Timeout> = {};
const memoryDebounceTimers: Record<string, NodeJS.Timeout> = {};
const collectionsDebounceTimers: Record<string, NodeJS.Timeout> = {};
const reflectionsDebounceTimers: Record<string, NodeJS.Timeout> = {};
const dismissalsDebounceTimers: Record<string, NodeJS.Timeout> = {};
const annotationsDebounceTimers: Record<string, NodeJS.Timeout> = {};
const bookmarksDebounceTimers: Record<string, NodeJS.Timeout> = {};

// The write each pending debounce timer will perform, so it can be run early (flushed) instead of dropped
const pendingWrites = new Map<string, () => Promise<void>>();

function scheduleWrite(
  timers: Record<string, NodeJS.Timeout>,
  key: string,
  delayMs: number,
  write: () => Promise<void>
): void {
  if (timers[key]) clearTimeout(timers[key]);
  const pendingKey = `${delayMs}:${key}`;
  pendingWrites.set(pendingKey, write);
  timers[key] = setTimeout(() => {
    delete timers[key];
    pendingWrites.delete(pendingKey);
    write();
  }, delayMs);
}

const ALL_DEBOUNCE_TIMERS = (): Record<string, NodeJS.Timeout>[] => [
  progressDebounceTimers,
  activityDebounceTimers,
  activeTimeDebounceTimers,
  memoryDebounceTimers,
  collectionsDebounceTimers,
  reflectionsDebounceTimers,
  dismissalsDebounceTimers,
  annotationsDebounceTimers,
  bookmarksDebounceTimers,
];

/**
 * Runs every pending debounced cloud write now and waits for them (each write handles its own errors).
 * Call before signing out and when the page is hidden, so the last few seconds of changes reach Firestore.
 */
export async function flushAllPendingSyncs(): Promise<void> {
  const writes = Array.from(pendingWrites.values());
  pendingWrites.clear();
  for (const timers of ALL_DEBOUNCE_TIMERS()) {
    for (const k of Object.keys(timers)) {
      clearTimeout(timers[k]);
      delete timers[k];
    }
  }
  await Promise.allSettled(writes.map((w) => w()));
}

// Firestore rejects batches larger than 500 writes
const MAX_BATCH_WRITES = 450;

async function commitInChunks(
  firestore: Firestore,
  refs: DocumentReference[],
  apply: (batch: WriteBatch, ref: DocumentReference) => void
): Promise<void> {
  for (let i = 0; i < refs.length; i += MAX_BATCH_WRITES) {
    const batch = writeBatch(firestore);
    refs.slice(i, i + MAX_BATCH_WRITES).forEach((ref) => apply(batch, ref));
    await batch.commit();
  }
}

/**
 * Cancel and clear all pending debounced background synchronization timers.
 * Prevents stale write triggers when switching or logging out accounts.
 */
export function cancelAllPendingSyncTimers(): void {
  pendingWrites.clear();
  Object.values(progressDebounceTimers).forEach(clearTimeout);
  Object.values(activityDebounceTimers).forEach(clearTimeout);
  Object.values(activeTimeDebounceTimers).forEach(clearTimeout);
  Object.values(memoryDebounceTimers).forEach(clearTimeout);
  Object.values(collectionsDebounceTimers).forEach(clearTimeout);
  Object.values(reflectionsDebounceTimers).forEach(clearTimeout);
  Object.values(dismissalsDebounceTimers).forEach(clearTimeout);
  Object.values(annotationsDebounceTimers).forEach(clearTimeout);
  Object.values(bookmarksDebounceTimers).forEach(clearTimeout);

  for (const k of Object.keys(progressDebounceTimers)) delete progressDebounceTimers[k];
  for (const k of Object.keys(activityDebounceTimers)) delete activityDebounceTimers[k];
  for (const k of Object.keys(activeTimeDebounceTimers)) delete activeTimeDebounceTimers[k];
  for (const k of Object.keys(memoryDebounceTimers)) delete memoryDebounceTimers[k];
  for (const k of Object.keys(collectionsDebounceTimers)) delete collectionsDebounceTimers[k];
  for (const k of Object.keys(reflectionsDebounceTimers)) delete reflectionsDebounceTimers[k];
  for (const k of Object.keys(dismissalsDebounceTimers)) delete dismissalsDebounceTimers[k];
  for (const k of Object.keys(annotationsDebounceTimers)) delete annotationsDebounceTimers[k];
  for (const k of Object.keys(bookmarksDebounceTimers)) delete bookmarksDebounceTimers[k];
}

/**
 * Immediately flush pending reading-activity and active-time writes to Firestore,
 * bypassing the debounce delay. Call this on pagehide / beforeunload so data is
 * not lost when the user closes the tab or switches to another browser.
 */
export async function flushPendingActivitySyncs(
  uid: string,
  activityData: ReadingStreakData,
  activeTimeData: WebsiteActiveTimeData
): Promise<void> {
  const activeDb = getFirebaseDb() || db;
  if (!activeDb || !uid) return;

  // Cancel any in-flight debounce timers for these keys so they don't double-write
  const actKey = `${uid}_activity`;
  const atKey = `${uid}_activetime`;
  pendingWrites.delete(`3000:${actKey}`);
  pendingWrites.delete(`4000:${atKey}`);
  if (activityDebounceTimers[actKey]) {
    clearTimeout(activityDebounceTimers[actKey]);
    delete activityDebounceTimers[actKey];
  }
  if (activeTimeDebounceTimers[atKey]) {
    clearTimeout(activeTimeDebounceTimers[atKey]);
    delete activeTimeDebounceTimers[atKey];
  }

  try {
    const actRef = doc(activeDb, "users", uid, "data", "activity");
    const atRef = doc(activeDb, "users", uid, "data", "active_time");
    // Fire both writes in parallel — do not await individually to minimise latency during unload
    await Promise.all([
      setDoc(actRef, activityData, { merge: true }),
      setDoc(atRef, activeTimeData, { merge: true }),
    ]);
  } catch (err) {
    console.warn("[Firestore] flushPendingActivitySyncs failed:", err);
  }
}

/**
 * Synchronize user profile info to Firestore (/users/{uid})
 */
export async function syncUserProfile(user: User): Promise<void> {
  const currentDb = getFirebaseDb() || db;
  if (!currentDb || !user) return;
  try {
    const userRef = doc(currentDb, "users", user.uid);
    await setDoc(
      userRef,
      {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
        lastLoginAt: serverTimestamp(),
        lastActiveAt: Date.now(),
      },
      { merge: true }
    );

    // Asynchronously ensure new users have an auto-generated unique username across all 3 collections
    import("@/lib/social").then(({ ensureUserProfile }) => {
      ensureUserProfile(user).catch((err) => {
        console.warn("[FirestoreSync] ensureUserProfile background error:", err);
      });
    });
  } catch (err) {
    console.warn("[Firestore] Failed to sync user profile:", err);
  }
}

/**
 * Fetch all cloud data for a user across all subcollections and telemetry documents
 */
export async function fetchFullCloudUserData(uid: string): Promise<CloudFullUserData> {
  const defaultResult: CloudFullUserData = {
    favorites: [],
    readingHistory: [],
    readingActivity: { daily: {}, currentStreak: 0, longestStreak: 0, lastQualifiedDate: null },
    activeTime: { totalActiveSeconds: 0, daily: {}, lastUpdated: Date.now() },
    readingMemories: {},
    annotations: {},
    collections: [],
    reflections: {},
    shelfDismissals: {},
    completedBookIds: [],
    failedSections: [],
  };

  const currentDb = getFirebaseDb() || db;
  if (!currentDb || !uid) {
    defaultResult.failedSections = [...CLOUD_SECTIONS];
    return defaultResult;
  }

  // Each section is read independently: one failed read (offline, permission, quota) must not make the
  // others look empty, and the caller is told exactly which sections could not be read.
  const readSection = async (name: CloudSection, read: () => Promise<void>) => {
    try {
      await read();
    } catch (err) {
      defaultResult.failedSections!.push(name);
      console.warn(`[Firestore] Could not read ${name}; it will not be overwritten this session:`, err);
    }
  };
  const getDataDoc = (name: string) => getDoc(doc(currentDb, "users", uid, "data", name));

  await Promise.all([
    readSection("favorites", async () => {
      const favsSnap = await getDocs(collection(currentDb, "users", uid, "favorites"));
      favsSnap.forEach((d) => {
        if (d.id) defaultResult.favorites.push(d.id);
      });
    }),

    readSection("reading_progress", async () => {
      const progSnap = await getDocs(collection(currentDb, "users", uid, "reading_progress"));
      progSnap.forEach((d) => {
        const data = d.data();
        if (data && typeof data.page === "number") {
          defaultResult.readingHistory.push({
            bookId: d.id,
            page: data.page,
            totalPages: data.totalPages || 100,
            progress: data.progress || Math.round((data.page / (data.totalPages || 100)) * 100),
            lastReadAt: data.lastReadAt?.toMillis
              ? data.lastReadAt.toMillis()
              : typeof data.lastReadAt === "number"
              ? data.lastReadAt
              : Date.now(),
          });
        }
      });
    }),

    readSection("activity", async () => {
      const activityDocSnap = await getDataDoc("activity");
      if (activityDocSnap.exists()) {
        const actData = activityDocSnap.data();
        if (actData && actData.daily) {
          const calculated = calculateStreak(actData.daily);
          defaultResult.readingActivity = {
            daily: actData.daily,
            currentStreak: calculated.currentStreak || actData.currentStreak || 0,
            longestStreak: Math.max(calculated.longestStreak, actData.longestStreak || 0),
            lastQualifiedDate: calculated.lastQualifiedDate || actData.lastQualifiedDate || null,
          };
        }
      }
    }),

    readSection("active_time", async () => {
      const activeTimeDocSnap = await getDataDoc("active_time");
      if (activeTimeDocSnap.exists()) {
        const atData = activeTimeDocSnap.data();
        if (atData) {
          defaultResult.activeTime = {
            totalActiveSeconds: atData.totalActiveSeconds || 0,
            daily: atData.daily || {},
            explorationDaily: atData.explorationDaily || {},
            totalExplorationSeconds: atData.totalExplorationSeconds || 0,
            lastUpdated: atData.lastUpdated || Date.now(),
          };
        }
      }
    }),

    readSection("reading_memory", async () => {
      const memoryDocSnap = await getDataDoc("reading_memory");
      if (memoryDocSnap.exists()) {
        const memData = memoryDocSnap.data();
        if (memData && memData.memories) defaultResult.readingMemories = memData.memories;
      }
    }),

    readSection("annotations", async () => {
      const annDocSnap = await getDataDoc("annotations");
      if (annDocSnap.exists()) {
        const annData = annDocSnap.data();
        if (annData && annData.annotations) defaultResult.annotations = annData.annotations;
      }
    }),

    readSection("collections", async () => {
      const colDocSnap = await getDataDoc("collections");
      if (colDocSnap.exists()) {
        const colData = colDocSnap.data();
        if (colData && Array.isArray(colData.collections)) defaultResult.collections = colData.collections;
      }
    }),

    readSection("reflections", async () => {
      const refDocSnap = await getDataDoc("reflections");
      if (refDocSnap.exists()) {
        const refData = refDocSnap.data();
        if (refData && refData.reflections) defaultResult.reflections = refData.reflections;
      }
    }),

    readSection("shelf_dismissals", async () => {
      const dismDocSnap = await getDataDoc("shelf_dismissals");
      if (dismDocSnap.exists()) {
        const dismData = dismDocSnap.data();
        if (dismData && dismData.dismissals) defaultResult.shelfDismissals = dismData.dismissals;
      }
    }),

    readSection("entitlement", async () => {
      const entitlementDocSnap = await getDataDoc("entitlement");
      if (entitlementDocSnap.exists()) {
        const entData = entitlementDocSnap.data();
        if (entData) defaultResult.entitlement = entData as UserEntitlement;
      }
    }),

    // { bookmarks: { [bookId]: BookmarkItem[] } }
    readSection("bookmarks", async () => {
      const bookmarksDocSnap = await getDataDoc("bookmarks");
      if (bookmarksDocSnap.exists()) {
        const bmData = bookmarksDocSnap.data();
        if (bmData && bmData.bookmarks && typeof bmData.bookmarks === "object") defaultResult.bookmarks = bmData.bookmarks;
      }
    }),

    readSection("completed_books", async () => {
      const completedDocSnap = await getDataDoc("completed_books");
      if (completedDocSnap.exists()) {
        const compData = completedDocSnap.data();
        if (compData && Array.isArray(compData.completedIds)) defaultResult.completedBookIds = compData.completedIds;
      }
    }),
  ]);

  return defaultResult;
}

/**
 * Persist completed books array to Firestore under /users/{uid}/data/completed_books
 */
export async function syncCompletedBooksToCloud(
  uid: string,
  completedIds: string[]
): Promise<void> {
  const currentDb = getFirebaseDb() || db;
  if (!currentDb || !uid || !Array.isArray(completedIds)) return;
  try {
    const compRef = doc(currentDb, "users", uid, "data", "completed_books");
    await setDoc(compRef, { completedIds, lastUpdated: Date.now() }, { merge: true });
  } catch (err) {
    console.warn("[Firestore] Failed to sync completed books to cloud:", err);
  }
}

/**
 * Bulk persist all reading memories to Firestore under /users/{uid}/data/reading_memory
 */
export async function syncAllReadingMemoriesToCloud(
  uid: string,
  memories: Record<string, BookReadingMemory>
): Promise<void> {
  const currentDb = getFirebaseDb() || db;
  if (!currentDb || !uid || !memories || Object.keys(memories).length === 0) return;
  try {
    const memRef = doc(currentDb, "users", uid, "data", "reading_memory");
    await setDoc(memRef, { memories }, { merge: true });
  } catch (err) {
    console.warn("[Firestore] Failed to sync all reading memories to cloud:", err);
  }
}

/**
 * Load Authoritative Cloud User Data directly from Firestore (/users/{uid}/*)
 * Guarantees that the authenticated user receives 100% pure cloud data from Firestore,
 * preventing any pollution from browser-local or previous account storage.
 */
export async function reconcileAndSyncAllUserData(user: User): Promise<CloudFullUserData> {
  const currentDb = getFirebaseDb() || db;
  const defaultEmpty: CloudFullUserData = {
    favorites: [],
    readingHistory: [],
    readingActivity: { daily: {}, currentStreak: 0, longestStreak: 0, lastQualifiedDate: null },
    activeTime: { totalActiveSeconds: 0, daily: {}, lastUpdated: Date.now() },
    readingMemories: {},
    annotations: {},
    collections: [],
    reflections: {},
    shelfDismissals: {},
    entitlement: DEFAULT_FREE_ENTITLEMENT,
  };

  if (!currentDb || !user) {
    return defaultEmpty;
  }

  try {
    // 0. Non-destructively attach any pre-login guest data on this device to this user account
    migrateGuestDataToUser(user.uid);

    // 1. Sync User Profile metadata document
    await syncUserProfile(user);

    // 2. Fetch Authoritative Cloud Data for this UID
    const cloudData = await fetchFullCloudUserData(user.uid);
    // A section whose cloud read failed is never written this session: its "empty" value is unknown, not empty,
    // so uploading this device's copy could replace newer data from another device. Local copies are always kept.
    const failed = new Set(cloudData.failedSections || []);
    const canWrite = (section: CloudSection) => !failed.has(section);

    // Safeguard reading activity and streak data:
    // Read local reading activity strictly for this user.uid
    const localActivity = getReadingActivityData(user.uid);
    const cloudDaily = cloudData.readingActivity?.daily || {};
    const localDaily = localActivity?.daily || {};

    // Merge strictly this user's local and cloud activity
    const mergedDaily: Record<string, DailyReadingActivity> = { ...cloudDaily };
    Object.entries(localDaily).forEach(([dateKey, localEntry]) => {
      if (mergedDaily[dateKey]) {
        const secs = Math.max(mergedDaily[dateKey].seconds || 0, localEntry.seconds || 0);
        mergedDaily[dateKey] = {
          seconds: secs,
          qualified: Boolean(mergedDaily[dateKey].qualified || localEntry.qualified || secs >= 900),
          lastUpdated: Math.max(mergedDaily[dateKey].lastUpdated || 0, localEntry.lastUpdated || 0),
        };
      } else {
        mergedDaily[dateKey] = localEntry;
      }
    });

    // Calculate streak purely mathematically from merged daily reading activity
    const { currentStreak, longestStreak, lastQualifiedDate } = calculateStreak(mergedDaily);
    const finalReadingActivity: ReadingStreakData = {
      daily: mergedDaily,
      currentStreak,
      longestStreak: Math.max(
        longestStreak,
        localActivity?.longestStreak || 0,
        cloudData.readingActivity?.longestStreak || 0
      ),
      lastQualifiedDate:
        lastQualifiedDate ||
        cloudData.readingActivity?.lastQualifiedDate ||
        localActivity?.lastQualifiedDate ||
        null,
    };

    cloudData.readingActivity = finalReadingActivity;
    saveReadingActivityData(finalReadingActivity, user.uid);
    if (canWrite("activity")) syncReadingActivityToCloud(user.uid, finalReadingActivity);

    // 3. Two-way safe union merge for favorites
    const localFavs = getStoredFavorites(user.uid);
    const cloudFavs = Array.isArray(cloudData.favorites) ? cloudData.favorites : [];
    const mergedFavs = Array.from(new Set([...localFavs, ...cloudFavs]));
    cloudData.favorites = mergedFavs;
    saveStoredFavorites(mergedFavs, user.uid);
    const cloudFavsSet = new Set(cloudFavs);
    localFavs.forEach((favId) => {
      if (canWrite("favorites") && !cloudFavsSet.has(favId)) {
        syncFavoriteToCloud(user.uid, favId, true);
      }
    });

    // 4. Two-way safe union merge for reading history
    const localHistory = getStoredReadingHistory(user.uid);
    const cloudHistory = Array.isArray(cloudData.readingHistory) ? cloudData.readingHistory : [];
    const historyMap = new Map<string, ReadingProgressItem>();
    cloudHistory.forEach((item) => {
      if (item?.bookId) historyMap.set(item.bookId, item);
    });
    localHistory.forEach((localItem) => {
      if (!localItem?.bookId) return;
      const existing = historyMap.get(localItem.bookId);
      if (!existing) {
        historyMap.set(localItem.bookId, localItem);
        if (canWrite("reading_progress")) syncReadingProgressToCloud(user.uid, localItem.bookId, localItem.page, localItem.totalPages);
      } else {
        const merged = mergeProgressItems(existing, localItem);
        historyMap.set(localItem.bookId, merged);
        if (canWrite("reading_progress") && (merged.page > (existing.page || 0) || merged.totalPages !== existing.totalPages)) {
          syncReadingProgressToCloud(user.uid, localItem.bookId, merged.page, merged.totalPages);
        }
      }
    });
    cloudData.readingHistory = Array.from(historyMap.values()).sort((a, b) => (b.lastReadAt || 0) - (a.lastReadAt || 0));
    saveStoredReadingHistory(cloudData.readingHistory, user.uid);

    // 5. Two-way safe union merge for reading memories
    const localMemories = getAllReadingMemories(user.uid);
    const cloudMemories = cloudData.readingMemories || {};
    const mergedMemories: Record<string, BookReadingMemory> = { ...cloudMemories };
    let hasLocalMemoriesToUpload = false;

    for (const [bookId, localMem] of Object.entries(localMemories)) {
      if (!bookId || !localMem) continue;
      const cloudMem = mergedMemories[bookId];
      if (!cloudMem) {
        mergedMemories[bookId] = localMem;
        hasLocalMemoriesToUpload = true;
      } else {
        const mergedTotal = Math.max(localMem.totalSeconds || 0, cloudMem.totalSeconds || 0);
        const mergedSessions = Math.max(localMem.sessionsCount || 0, cloudMem.sessionsCount || 0);
        const mergedTimeline = (localMem.timeline?.length || 0) >= (cloudMem.timeline?.length || 0)
          ? localMem.timeline
          : cloudMem.timeline;
        mergedMemories[bookId] = {
          bookId,
          totalSeconds: mergedTotal,
          sessionsCount: mergedSessions,
          firstReadAt: Math.min(localMem.firstReadAt || Date.now(), cloudMem.firstReadAt || Date.now()),
          lastReadAt: Math.max(localMem.lastReadAt || 0, cloudMem.lastReadAt || 0),
          timeline: mergedTimeline,
        };
        if (localMem.totalSeconds > (cloudMem.totalSeconds || 0)) {
          hasLocalMemoriesToUpload = true;
        }
      }
    }
    cloudData.readingMemories = mergedMemories;
    if (canWrite("reading_memory") && hasLocalMemoriesToUpload && Object.keys(mergedMemories).length > 0) {
      syncAllReadingMemoriesToCloud(user.uid, mergedMemories);
    }

    // 6. Two-way safe union merge for completed books
    const localCompletedIds = getGenuinelyCompletedBookIds(localHistory, mergedMemories, user.uid);
    const cloudCompletedIds = Array.isArray(cloudData.completedBookIds) ? cloudData.completedBookIds : [];
    const mergedCompletedIds = Array.from(new Set([...localCompletedIds, ...cloudCompletedIds]));
    cloudData.completedBookIds = mergedCompletedIds;

    mergedCompletedIds.forEach((bId) => {
      const existing = historyMap.get(bId);
      const catalogBook = getBookById(bId) || BOOKS.find((b) => b.id === bId || b.id.toLowerCase() === bId.toLowerCase());
      const total = Number(catalogBook?.pages) || existing?.totalPages || 100;
      if (!existing || existing.progress < 100) {
        historyMap.set(bId, {
          bookId: bId,
          page: total,
          totalPages: total,
          progress: 100,
          lastReadAt: existing?.lastReadAt || Date.now(),
        });
        if (canWrite("reading_progress")) syncReadingProgressToCloud(user.uid, bId, total, total);
      }
    });
    cloudData.readingHistory = Array.from(historyMap.values()).sort((a, b) => (b.lastReadAt || 0) - (a.lastReadAt || 0));
    saveStoredReadingHistory(cloudData.readingHistory, user.uid);

    if (canWrite("completed_books") && mergedCompletedIds.length > cloudCompletedIds.length) {
      syncCompletedBooksToCloud(user.uid, mergedCompletedIds);
    }

    // 7. Two-way safe union merge for collections & reflections
    // Uploaded whenever this device holds something the cloud lacks (previously only when the local list was longer)
    const collectionsMerge = mergeCollectionLists(cloudData.collections, getReadingCollections(user.uid));
    cloudData.collections = collectionsMerge.merged;
    if (canWrite("collections") && collectionsMerge.cloudNeedsUpdate) {
      syncCollectionsToCloud(user.uid, cloudData.collections);
    }

    // Reflections and shelf dismissals made while offline were previously never backfilled to the cloud
    const reflectionsMerge = mergeReflectionMaps(cloudData.reflections, getBookReflections(user.uid));
    cloudData.reflections = reflectionsMerge.merged;
    if (canWrite("reflections") && reflectionsMerge.cloudNeedsUpdate) {
      syncReflectionsToCloud(user.uid, cloudData.reflections);
    }

    const dismissalsMerge = mergeShelfDismissalMaps(cloudData.shelfDismissals, getShelfDismissals(user.uid));
    cloudData.shelfDismissals = dismissalsMerge.merged;
    if (canWrite("shelf_dismissals") && dismissalsMerge.cloudNeedsUpdate) {
      syncShelfDismissalsToCloud(user.uid, cloudData.shelfDismissals);
    }

    // 8. Two-way merge for active website time (per-day maxima, so it can never double count)
    const activeMerge = mergeActiveTime(cloudData.activeTime, getWebsiteActiveTimeData(user.uid));
    cloudData.activeTime = activeMerge.merged;
    if (canWrite("active_time") && activeMerge.cloudNeedsUpdate) {
      syncActiveTimeToCloud(user.uid, cloudData.activeTime);
    }

    // 8b. Two-way merge for bookmarks: upload anything local that the cloud is missing
    const localBookmarks = getAllBookmarks(user.uid);
    const cloudBookmarks = cloudData.bookmarks || {};
    const mergedBookmarks: Record<string, BookmarkItem[]> = {};
    new Set([...Object.keys(localBookmarks), ...Object.keys(cloudBookmarks)]).forEach((bookId) => {
      const cloudList = Array.isArray(cloudBookmarks[bookId]) ? cloudBookmarks[bookId] : [];
      const merged = mergeBookmarkLists(cloudList, localBookmarks[bookId] || []);
      mergedBookmarks[bookId] = merged;
      if (canWrite("bookmarks") && merged.length > cloudList.length) {
        syncBookmarksToCloud(user.uid, bookId, merged);
      }
    });
    cloudData.bookmarks = mergedBookmarks;

    // 8c. Upload local-only annotations (e.g. made as a guest before signing in) that the cloud lacks
    const localAnnotations = getAllBookAnnotations(user.uid);
    Object.entries(localAnnotations).forEach(([bookId, localAnn]) => {
      const cloudAnn = cloudData.annotations?.[bookId];
      if (canWrite("annotations") && annotationsAddContent(cloudAnn, localAnn)) {
        const { bookmarks: _bm, ...merged } = mergeAnnotations(cloudAnn, localAnn);
        syncAnnotationsToCloud(user.uid, bookId, merged as BookAnnotations);
      }
    });

    // 9. Hydrate local in-memory storage caches with authoritative merged cloud state
    hydrateStorageFromCloudData(cloudData, user.uid);

    return cloudData;
  } catch (err) {
    console.warn("[Firestore] Error in cloud user sync, safely falling back to local UID cache:", err);
    // CRITICAL: On network failure, NEVER return blank empty state if the user has local UID data!
    const fallbackHistory = getStoredReadingHistory(user.uid);
    const fallbackMemories = getAllReadingMemories(user.uid);
    return {
      favorites: getStoredFavorites(user.uid),
      readingHistory: fallbackHistory,
      readingActivity: getReadingActivityData(user.uid),
      activeTime: getWebsiteActiveTimeData(user.uid),
      readingMemories: fallbackMemories,
      annotations: {},
      collections: getReadingCollections(user.uid),
      reflections: getBookReflections(user.uid),
      shelfDismissals: getShelfDismissals(user.uid),
      completedBookIds: getGenuinelyCompletedBookIds(fallbackHistory, fallbackMemories, user.uid),
      entitlement: DEFAULT_FREE_ENTITLEMENT,
    };
  }
}

/**
 * Debounced sync for reading progress to /users/{uid}/reading_progress/{bookId}
 */
export function syncReadingProgressToCloud(
  uid: string,
  bookId: string,
  page: number,
  totalPages?: number
): void {
  const currentDb = getFirebaseDb() || db;
  if (!currentDb || !uid || !bookId) return;

  const key = `${uid}_${bookId}`;
  if (progressDebounceTimers[key]) {
    clearTimeout(progressDebounceTimers[key]);
  }

  scheduleWrite(progressDebounceTimers, key, 2000, async () => {
    try {
      const activeDb = getFirebaseDb() || db;
      if (!activeDb) return;
      const progressRef = doc(activeDb, "users", uid, "reading_progress", bookId);
      await setDoc(
        progressRef,
        {
          bookId,
          page,
          totalPages: totalPages || 1,
          progress: totalPages ? Math.min(100, Math.round((page / totalPages) * 100)) : 0,
          lastReadAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (err) {
      console.warn(`[Firestore] Failed to sync progress for ${bookId}:`, err);
    }
  }); // 2-second debounce
}

/**
 * Permanently delete a single book's reading progress document from /users/{uid}/reading_progress/{bookId}
 */
export async function deleteCloudBookProgress(uid: string, bookId: string): Promise<boolean> {
  const currentDb = getFirebaseDb() || db;
  if (!currentDb || !uid || !bookId) return false;
  try {
    const key = `${uid}_${bookId}`;
    if (progressDebounceTimers[key]) {
      clearTimeout(progressDebounceTimers[key]);
      delete progressDebounceTimers[key];
    }
    const progDocRef = doc(currentDb, "users", uid, "reading_progress", bookId);
    await deleteDoc(progDocRef);

    // Without this the completed-books union merge re-creates the deleted progress at 100% on next sync
    await updateDoc(doc(currentDb, "users", uid, "data", "completed_books"), {
      completedIds: arrayRemove(bookId),
      lastUpdated: Date.now(),
    }).catch(() => {});

    // Keep public_profiles stats in immediate sync
    try {
      const progRef = collection(currentDb, "users", uid, "reading_progress");
      const snap = await getDocs(progRef);
      const remainingDocs = snap.docs.filter((d) => d.id !== bookId);
      const curReading = remainingDocs.filter((d) => {
        const p = d.data();
        const isComp = Number(p.progress) >= 95 || (p.totalPages > 0 && Number(p.page) >= Number(p.totalPages));
        const hasStart = Number(p.progress) > 0 || Number(p.page) > 1;
        return !isComp && hasStart;
      }).length;
      const compBooks = remainingDocs.filter((d) => {
        const p = d.data();
        return Number(p.progress) >= 95 || (p.totalPages > 0 && Number(p.page) >= Number(p.totalPages));
      }).length;

      const pubRef = doc(currentDb, "public_profiles", uid);
      await updateDoc(pubRef, {
        "stats.currentlyReading": curReading,
        "stats.booksCompleted": compBooks,
      }).catch(() => {});
    } catch {}

    return true;
  } catch (err) {
    console.error(`[Firestore] Failed to delete cloud book progress for ${bookId}:`, err);
    return false;
  }
}

/**
 * Debounced sync for book annotations to /users/{uid}/data/annotations
 */
export function syncAnnotationsToCloud(
  uid: string,
  bookId: string,
  annotations: BookAnnotations
): void {
  const currentDb = getFirebaseDb() || db;
  if (!currentDb || !uid || !bookId || !annotations) return;

  const key = `${uid}_ann_${bookId}`;
  if (annotationsDebounceTimers[key]) {
    clearTimeout(annotationsDebounceTimers[key]);
  }

  scheduleWrite(annotationsDebounceTimers, key, 2000, async () => {
    try {
      const activeDb = getFirebaseDb() || db;
      if (!activeDb) return;
      const annRef = doc(activeDb, "users", uid, "data", "annotations");
      await setDoc(
        annRef,
        {
          annotations: {
            [bookId]: annotations,
          },
        },
        { merge: true }
      );
    } catch (err) {
      console.warn(`[Firestore] Failed to sync annotations for ${bookId}:`, err);
    }
  });
}

/**
 * Debounced sync for book bookmarks to /users/{uid}/data/bookmarks
 */
export function syncBookmarksToCloud(
  uid: string,
  bookId: string,
  bookmarks: BookmarkItem[]
): void {
  const currentDb = getFirebaseDb() || db;
  if (!currentDb || !uid || !bookId || !bookmarks) return;

  const key = `${uid}_bm_${bookId}`;
  if (bookmarksDebounceTimers[key]) {
    clearTimeout(bookmarksDebounceTimers[key]);
  }

  scheduleWrite(bookmarksDebounceTimers, key, 2000, async () => {
    try {
      const activeDb = getFirebaseDb() || db;
      if (!activeDb) return;
      const bmRef = doc(activeDb, "users", uid, "data", "bookmarks");
      await setDoc(
        bmRef,
        {
          bookmarks: {
            [bookId]: bookmarks,
          },
        },
        { merge: true }
      );
    } catch (err) {
      console.warn(`[Firestore] Failed to sync bookmarks for ${bookId}:`, err);
    }
  });
}

/**
 * Debounced sync for daily reading activity & streaks to /users/{uid}/data/activity
 */
export function syncReadingActivityToCloud(
  uid: string,
  activityData: ReadingStreakData
): void {
  const currentDb = getFirebaseDb() || db;
  if (!currentDb || !uid || !activityData) return;

  const key = `${uid}_activity`;
  if (activityDebounceTimers[key]) {
    clearTimeout(activityDebounceTimers[key]);
  }

  scheduleWrite(activityDebounceTimers, key, 3000, async () => {
    try {
      const activeDb = getFirebaseDb() || db;
      if (!activeDb) return;

      // Critical Safeguard: NEVER overwrite existing cloud activity with empty data!
      if (!activityData || Object.keys(activityData.daily || {}).length === 0) {
        return;
      }

      const actRef = doc(activeDb, "users", uid, "data", "activity");
      await setDoc(actRef, activityData, { merge: true });

      // Automated Cloud Backup Snapshot in users/{uid}/backups/latest
      const backupRef = doc(activeDb, "users", uid, "backups", "latest");
      await setDoc(
        backupRef,
        {
          readingActivity: activityData,
          backupTimestamp: Date.now(),
        },
        { merge: true }
      ).catch(() => {});
    } catch (err) {
      console.warn("[Firestore] Failed to sync reading activity:", err);
    }
  }); // 3-second debounce
}

/**
 * Debounced sync for website active engagement time to /users/{uid}/data/active_time
 */
export function syncActiveTimeToCloud(
  uid: string,
  activeTimeData: WebsiteActiveTimeData
): void {
  const currentDb = getFirebaseDb() || db;
  if (!currentDb || !uid || !activeTimeData) return;

  const key = `${uid}_activetime`;
  if (activeTimeDebounceTimers[key]) {
    clearTimeout(activeTimeDebounceTimers[key]);
  }

  scheduleWrite(activeTimeDebounceTimers, key, 4000, async () => {
    try {
      const activeDb = getFirebaseDb() || db;
      if (!activeDb) return;
      const atRef = doc(activeDb, "users", uid, "data", "active_time");
      await setDoc(atRef, activeTimeData, { merge: true });
    } catch (err) {
      console.warn("[Firestore] Failed to sync active time:", err);
    }
  }); // 4-second debounce
}

/**
 * Debounced sync for book reading memory to /users/{uid}/data/reading_memory
 */
export function syncReadingMemoryToCloud(
  uid: string,
  bookId: string,
  memory: BookReadingMemory
): void {
  const currentDb = getFirebaseDb() || db;
  if (!currentDb || !uid || !bookId || !memory) return;

  const key = `${uid}_mem_${bookId}`;
  if (memoryDebounceTimers[key]) {
    clearTimeout(memoryDebounceTimers[key]);
  }

  scheduleWrite(memoryDebounceTimers, key, 3000, async () => {
    try {
      const activeDb = getFirebaseDb() || db;
      if (!activeDb) return;
      const memRef = doc(activeDb, "users", uid, "data", "reading_memory");
      await setDoc(
        memRef,
        {
          memories: {
            [bookId]: memory,
          },
        },
        { merge: true }
      );
    } catch (err) {
      console.warn(`[Firestore] Failed to sync memory for ${bookId}:`, err);
    }
  }); // 3-second debounce
}

/**
 * Immediately sync a favorite book toggle to /users/{uid}/favorites/{bookId}
 */
export async function syncFavoriteToCloud(
  uid: string,
  bookId: string,
  isFavorite: boolean
): Promise<void> {
  const currentDb = getFirebaseDb() || db;
  if (!currentDb || !uid || !bookId) return;
  try {
    const favRef = doc(currentDb, "users", uid, "favorites", bookId);
    if (isFavorite) {
      await setDoc(
        favRef,
        {
          bookId,
          favoritedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } else {
      const { deleteDoc } = await import("firebase/firestore");
      await deleteDoc(favRef);
    }
  } catch (err) {
    console.warn(`[Firestore] Failed to sync favorite for ${bookId}:`, err);
  }
}

/**
 * Debounced sync for reading collections to /users/{uid}/data/collections
 */
export function syncCollectionsToCloud(
  uid: string,
  collections: ReadingCollection[]
): void {
  const currentDb = getFirebaseDb() || db;
  if (!currentDb || !uid || !collections) return;

  const key = `${uid}_collections`;
  if (collectionsDebounceTimers[key]) {
    clearTimeout(collectionsDebounceTimers[key]);
  }

  scheduleWrite(collectionsDebounceTimers, key, 1000, async () => {
    try {
      const activeDb = getFirebaseDb() || db;
      if (!activeDb) return;
      const docRef = doc(activeDb, "users", uid, "data", "collections");
      await setDoc(docRef, { collections }, { merge: true });
    } catch (err) {
      console.warn("[Firestore] Failed to sync collections to cloud:", err);
    }
  });
}

/**
 * Debounced sync for book reflections to /users/{uid}/data/reflections
 */
export function syncReflectionsToCloud(
  uid: string,
  reflections: Record<string, BookReflection>
): void {
  const currentDb = getFirebaseDb() || db;
  if (!currentDb || !uid || !reflections) return;

  const key = `${uid}_reflections`;
  if (reflectionsDebounceTimers[key]) {
    clearTimeout(reflectionsDebounceTimers[key]);
  }

  scheduleWrite(reflectionsDebounceTimers, key, 1000, async () => {
    try {
      const activeDb = getFirebaseDb() || db;
      if (!activeDb) return;
      const docRef = doc(activeDb, "users", uid, "data", "reflections");
      await setDoc(docRef, { reflections }, { merge: true });
    } catch (err) {
      console.warn("[Firestore] Failed to sync reflections to cloud:", err);
    }
  });
}

/**
 * Debounced sync for shelf dismissals to /users/{uid}/data/shelf_dismissals
 */
export function syncShelfDismissalsToCloud(
  uid: string,
  dismissals: ShelfDismissalsMap
): void {
  const currentDb = getFirebaseDb() || db;
  if (!currentDb || !uid || !dismissals) return;

  const key = `${uid}_dismissals`;
  if (dismissalsDebounceTimers[key]) {
    clearTimeout(dismissalsDebounceTimers[key]);
  }

  scheduleWrite(dismissalsDebounceTimers, key, 1000, async () => {
    try {
      const activeDb = getFirebaseDb() || db;
      if (!activeDb) return;
      const docRef = doc(activeDb, "users", uid, "data", "shelf_dismissals");
      await setDoc(docRef, { dismissals }, { merge: true });
    } catch (err) {
      console.warn("[Firestore] Failed to sync shelf dismissals to cloud:", err);
    }
  });
}

/**
 * Permanently delete all reading progress documents from /users/{uid}/reading_progress
 */
export async function deleteCloudReadingProgress(uid: string): Promise<boolean> {
  const currentDb = getFirebaseDb() || db;
  if (!currentDb || !uid) return false;
  try {
    cancelAllPendingSyncTimers();
    const progRef = collection(currentDb, "users", uid, "reading_progress");
    const snap = await getDocs(progRef);
    await commitInChunks(currentDb, snap.docs.map((d) => d.ref), (batch, ref) => batch.delete(ref));
    // Completed-book IDs are derived from progress; clear them too so they are not resurrected
    await setDoc(doc(currentDb, "users", uid, "data", "completed_books"), { completedIds: [], lastUpdated: Date.now() });
    const pubRef = doc(currentDb, "public_profiles", uid);
    await updateDoc(pubRef, {
      "stats.booksCompleted": 0,
      "stats.currentlyReading": 0,
      "stats.booksStarted": 0,
    }).catch(() => {});
    return true;
  } catch (err) {
    console.error("[Firestore] Failed to delete cloud reading progress:", err);
    throw err;
  }
}

/**
 * Permanently reset daily reading activity and streak in /users/{uid}/data/activity
 */
export async function deleteCloudReadingActivity(uid: string): Promise<boolean> {
  const currentDb = getFirebaseDb() || db;
  if (!currentDb || !uid) return false;
  try {
    cancelAllPendingSyncTimers();
    const actRef = doc(currentDb, "users", uid, "data", "activity");
    const emptyActivity: ReadingStreakData = {
      daily: {},
      currentStreak: 0,
      longestStreak: 0,
      lastQualifiedDate: null,
    };
    await setDoc(actRef, emptyActivity);

    const pubRef = doc(currentDb, "public_profiles", uid);
    await updateDoc(pubRef, {
      "stats.currentStreak": 0,
      "stats.longestStreak": 0,
      "stats.totalReadingSeconds": 0,
    }).catch(() => {});
    return true;
  } catch (err) {
    console.error("[Firestore] Failed to delete cloud reading activity:", err);
    throw err;
  }
}

/**
 * Permanently reset annotations in /users/{uid}/data/annotations
 */
export async function deleteCloudAnnotations(uid: string): Promise<boolean> {
  const currentDb = getFirebaseDb() || db;
  if (!currentDb || !uid) return false;
  try {
    cancelAllPendingSyncTimers();
    const annRef = doc(currentDb, "users", uid, "data", "annotations");
    await setDoc(annRef, { annotations: {} });
    return true;
  } catch (err) {
    console.error("[Firestore] Failed to delete cloud annotations:", err);
    throw err;
  }
}

/**
 * Permanently delete all favorite documents from /users/{uid}/favorites
 */
export async function deleteCloudFavorites(uid: string): Promise<boolean> {
  const currentDb = getFirebaseDb() || db;
  if (!currentDb || !uid) return false;
  try {
    cancelAllPendingSyncTimers();
    const favsRef = collection(currentDb, "users", uid, "favorites");
    const snap = await getDocs(favsRef);
    if (!snap.empty) {
      const batch = writeBatch(currentDb);
      snap.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
    return true;
  } catch (err) {
    console.error("[Firestore] Failed to delete cloud favorites:", err);
    throw err;
  }
}

/**
 * Permanently reset all user reading data from Firestore (/users/{uid}/*)
 * Strictly preserves identity profile (email, createdAt, username) and username registration.
 */
export async function permanentFactoryResetCloudData(uid: string): Promise<boolean> {
  const currentDb = getFirebaseDb() || db;
  if (!currentDb || !uid) return false;
  try {
    cancelAllPendingSyncTimers();

    // 1. Delete all favorites
    const favsRef = collection(currentDb, "users", uid, "favorites");
    const favsSnap = await getDocs(favsRef);

    // 2. Delete all reading progress
    const progRef = collection(currentDb, "users", uid, "reading_progress");
    const progSnap = await getDocs(progRef);

    await commitInChunks(
      currentDb,
      [...favsSnap.docs, ...progSnap.docs].map((d) => d.ref),
      (batch, ref) => batch.delete(ref)
    );

    // 3. Reset all user data subdocuments in users/{uid}/data/* (the entitlement doc is intentionally kept)
    const dataDoc = (name: string) => doc(currentDb, "users", uid, "data", name);
    const batch = writeBatch(currentDb);
    batch.set(dataDoc("activity"), { daily: {}, currentStreak: 0, longestStreak: 0, lastQualifiedDate: null });
    batch.set(dataDoc("active_time"), { totalActiveSeconds: 0, daily: {}, explorationDaily: {}, totalExplorationSeconds: 0, lastUpdated: Date.now() });
    batch.set(dataDoc("reading_memory"), { memories: {} });
    batch.set(dataDoc("annotations"), { annotations: {} });
    batch.set(dataDoc("bookmarks"), { bookmarks: {} });
    batch.set(dataDoc("collections"), { collections: [] });
    batch.set(dataDoc("reflections"), { reflections: {} });
    batch.set(dataDoc("shelf_dismissals"), { dismissals: {} });
    // Without these, the union merge on next sign-in resurrects completed books and certificates
    batch.set(dataDoc("completed_books"), { completedIds: [], lastUpdated: Date.now() });
    batch.set(dataDoc("certificates"), {});
    batch.set(doc(currentDb, "users", uid, "backups", "latest"), { readingActivity: { daily: {}, currentStreak: 0, longestStreak: 0, lastQualifiedDate: null }, backupTimestamp: Date.now() });

    await batch.commit();

    // 3.5 Delete this user's public activity events (stored in the top-level public_activities collection)
    try {
      const actFeedSnap = await getDocs(query(collection(currentDb, "public_activities"), where("uid", "==", uid)));
      await commitInChunks(currentDb, actFeedSnap.docs.map((d) => d.ref), (b, ref) => b.delete(ref));
    } catch (actErr) {
      console.warn("[Firestore] Notice deleting public activities on reset:", actErr);
    }

    // 4. Update Public Profile Stats & reset achievements
    const pubRef = doc(currentDb, "public_profiles", uid);
    await setDoc(
      pubRef,
      {
        stats: {
          booksCompleted: 0,
          currentlyReading: 0,
          currentStreak: 0,
          longestStreak: 0,
          totalReadingSeconds: 0,
          totalActiveSeconds: 0,
          booksStarted: 0,
        },
        achievements: [],
        updatedAt: Date.now(),
      },
      { merge: true }
    ).catch(() => {});

    return true;
  } catch (err) {
    console.error("[Firestore] Permanent factory reset failed:", err);
    throw err;
  }
}

/**
 * Synchronize user settings/preferences to Firestore (/users/{uid}/data/settings)
 */
export async function syncUserSettingsToCloud(
  uid: string,
  settings: { customGoalMinutes?: number }
): Promise<void> {
  const currentDb = getFirebaseDb() || db;
  if (!currentDb || !uid || !settings) return;
  try {
    const docRef = doc(currentDb, "users", uid, "data", "settings");
    await setDoc(docRef, settings, { merge: true });
  } catch (err) {
    console.warn("[Firestore] Failed to sync user settings to cloud:", err);
  }
}

/**
 * Fetch user settings/preferences from Firestore (/users/{uid}/data/settings)
 */
export async function fetchUserSettingsFromCloud(
  uid: string
): Promise<{ customGoalMinutes?: number } | null> {
  const currentDb = getFirebaseDb() || db;
  if (!currentDb || !uid) return null;
  try {
    const docRef = doc(currentDb, "users", uid, "data", "settings");
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return snap.data() as { customGoalMinutes?: number };
    }
  } catch (err) {
    console.warn("[Firestore] Failed to fetch user settings from cloud:", err);
  }
  return null;
}

/**
 * Synchronize a book completion certificate to Firestore (/users/{uid}/data/certificates)
 */
export async function syncCertificateToCloud(
  uid: string,
  certificate: any
): Promise<void> {
  const currentDb = getFirebaseDb() || db;
  if (!currentDb || !uid || !certificate?.bookId) return;
  try {
    const docRef = doc(currentDb, "users", uid, "data", "certificates");
    await setDoc(docRef, { [certificate.bookId]: certificate }, { merge: true });
  } catch (err) {
    console.warn("[Firestore] Failed to sync certificate to cloud:", err);
  }
}

/**
 * Fetch all certificates for a user from Firestore (/users/{uid}/data/certificates)
 */
export async function fetchCertificatesFromCloud(
  uid: string
): Promise<Record<string, any>> {
  const currentDb = getFirebaseDb() || db;
  if (!currentDb || !uid) return {};
  try {
    const docRef = doc(currentDb, "users", uid, "data", "certificates");
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return snap.data() || {};
    }
  } catch (err) {
    console.warn("[Firestore] Failed to fetch certificates from cloud:", err);
  }
  return {};
}

/**
 * Uploads certificates that exist only on this device (e.g. issued while offline) and returns the cloud copy.
 * A certificate already in the cloud is never replaced, so its ID and verification link stay stable.
 * Returns null when the cloud cannot be read; nothing is written in that case.
 */
export async function backfillCertificatesToCloud(
  uid: string,
  localCertificates: Record<string, { bookId?: string }>
): Promise<Record<string, any> | null> {
  const currentDb = getFirebaseDb() || db;
  if (!currentDb || !uid) return null;
  const docRef = doc(currentDb, "users", uid, "data", "certificates");
  let cloud: Record<string, any>;
  try {
    const snap = await getDoc(docRef);
    cloud = snap.exists() ? snap.data() || {} : {};
  } catch (err) {
    console.warn("[Firestore] Could not read certificates; local certificates kept and not uploaded:", err);
    return null;
  }
  const missing: Record<string, unknown> = {};
  for (const [bookId, cert] of Object.entries(localCertificates || {})) {
    if (cert?.bookId && !cloud[bookId]) missing[bookId] = cert;
  }
  if (Object.keys(missing).length > 0) {
    try {
      await setDoc(docRef, missing, { merge: true });
      Object.assign(cloud, missing);
    } catch (err) {
      console.warn("[Firestore] Could not upload local certificates (kept on this device):", err);
    }
  }
  return cloud;
}

export interface CloudVerification {
  uid: string;
  verifiedAt: number;
  /** True when every record on this device was found in the cloud. */
  complete: boolean;
  /** Records still only on this device, e.g. "highlight:1984:h_123". They stay local and are retried on the next sync. */
  missing: string[];
  /** Sections that could not be read back, so they are unverified. */
  unreadable: string[];
}

const VERIFICATION_KEY = (uid: string) => `readershub:cloud-verification:v1:${uid}`;

export function getLastCloudVerification(uid: string): CloudVerification | null {
  if (typeof window === "undefined" || !uid) return null;
  try {
    const raw = localStorage.getItem(VERIFICATION_KEY(uid));
    return raw ? (JSON.parse(raw) as CloudVerification) : null;
  } catch {
    return null;
  }
}

/**
 * Verifies the backfill: flushes pending writes, reads the account back from Firestore and checks that every
 * important record held on this device is present there. Never deletes or changes local data; the result is
 * kept on this device so an incomplete copy is retried. Returns null if verification could not run.
 */
export async function verifyCloudCopy(
  uid: string,
  localCertificates: Record<string, unknown> = {}
): Promise<CloudVerification | null> {
  const currentDb = getFirebaseDb() || db;
  if (!currentDb || !uid || typeof window === "undefined") return null;

  await flushAllPendingSyncs();
  const cloud = await fetchFullCloudUserData(uid);
  const unreadable: string[] = [...(cloud.failedSections || [])];
  let cloudCertificates: Record<string, unknown> | undefined;
  try {
    const snap = await getDoc(doc(currentDb, "users", uid, "data", "certificates"));
    cloudCertificates = snap.exists() ? snap.data() || {} : {};
  } catch {
    unreadable.push("certificates");
  }
  if (CLOUD_SECTIONS.every((sec) => unreadable.includes(sec))) return null; // offline: nothing to compare against

  const readable = (s: string) => !unreadable.includes(s);
  const localHistory = getStoredReadingHistory(uid);
  const localMemories = getAllReadingMemories(uid);
  const missing = findItemsMissingFromCloud(
    {
      favorites: readable("favorites") ? getStoredFavorites(uid) : [],
      readingHistory: readable("reading_progress") ? localHistory : [],
      completedBookIds: readable("completed_books") ? getGenuinelyCompletedBookIds(localHistory, localMemories, uid) : [],
      collections: readable("collections") ? getReadingCollections(uid) : [],
      reflections: readable("reflections") ? getBookReflections(uid) : {},
      bookmarks: readable("bookmarks") ? getAllBookmarks(uid) : {},
      annotations: readable("annotations") ? getAllBookAnnotations(uid) : {},
      readingMemories: readable("reading_memory") ? localMemories : {},
      certificates: readable("certificates") ? localCertificates : {},
    },
    {
      favorites: cloud.favorites,
      readingHistory: cloud.readingHistory,
      completedBookIds: cloud.completedBookIds,
      collections: cloud.collections,
      reflections: cloud.reflections,
      bookmarks: cloud.bookmarks,
      annotations: cloud.annotations,
      readingMemories: cloud.readingMemories,
      certificates: cloudCertificates,
    }
  );

  const result: CloudVerification = {
    uid,
    verifiedAt: Date.now(),
    complete: missing.length === 0 && unreadable.length === 0,
    missing: missing.slice(0, 200),
    unreadable,
  };
  try {
    localStorage.setItem(VERIFICATION_KEY(uid), JSON.stringify(result));
  } catch {}
  if (missing.length) console.warn(`[Firestore] ${missing.length} record(s) are still only on this device; they will be retried.`, missing.slice(0, 10));
  return result;
}
