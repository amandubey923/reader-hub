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
}

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
  };

  const currentDb = getFirebaseDb() || db;
  if (!currentDb || !uid) return defaultResult;

  try {
    // 1. Fetch Cloud Favorites
    const favsRef = collection(currentDb, "users", uid, "favorites");
    const favsSnap = await getDocs(favsRef);
    favsSnap.forEach((d) => {
      if (d.id) defaultResult.favorites.push(d.id);
    });

    // 2. Fetch Cloud Reading Progress
    const progRef = collection(currentDb, "users", uid, "reading_progress");
    const progSnap = await getDocs(progRef);
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

    // 3. Fetch Cloud Reading Activity & Streaks
    const activityDocRef = doc(currentDb, "users", uid, "data", "activity");
    const activityDocSnap = await getDoc(activityDocRef);
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

    // 4. Fetch Cloud Website Active Time
    const activeTimeDocRef = doc(currentDb, "users", uid, "data", "active_time");
    const activeTimeDocSnap = await getDoc(activeTimeDocRef);
    if (activeTimeDocSnap.exists()) {
      const atData = activeTimeDocSnap.data();
      if (atData) {
        defaultResult.activeTime = {
          totalActiveSeconds: atData.totalActiveSeconds || 0,
          daily: atData.daily || {},
          lastUpdated: atData.lastUpdated || Date.now(),
        };
      }
    }

    // 5. Fetch Cloud Reading Memories
    const memoryDocRef = doc(currentDb, "users", uid, "data", "reading_memory");
    const memoryDocSnap = await getDoc(memoryDocRef);
    if (memoryDocSnap.exists()) {
      const memData = memoryDocSnap.data();
      if (memData && memData.memories) {
        defaultResult.readingMemories = memData.memories;
      }
    }

    // 6. Fetch Cloud Annotations
    const annDocRef = doc(currentDb, "users", uid, "data", "annotations");
    const annDocSnap = await getDoc(annDocRef);
    if (annDocSnap.exists()) {
      const annData = annDocSnap.data();
      if (annData && annData.annotations) {
        defaultResult.annotations = annData.annotations;
      }
    }

    // 7. Fetch Cloud Collections
    const colDocRef = doc(currentDb, "users", uid, "data", "collections");
    const colDocSnap = await getDoc(colDocRef);
    if (colDocSnap.exists()) {
      const colData = colDocSnap.data();
      if (colData && Array.isArray(colData.collections)) {
        defaultResult.collections = colData.collections;
      }
    }

    // 8. Fetch Cloud Reflections
    const refDocRef = doc(currentDb, "users", uid, "data", "reflections");
    const refDocSnap = await getDoc(refDocRef);
    if (refDocSnap.exists()) {
      const refData = refDocSnap.data();
      if (refData && refData.reflections) {
        defaultResult.reflections = refData.reflections;
      }
    }

    // 9. Fetch Cloud Shelf Dismissals
    const dismDocRef = doc(currentDb, "users", uid, "data", "shelf_dismissals");
    const dismDocSnap = await getDoc(dismDocRef);
    if (dismDocSnap.exists()) {
      const dismData = dismDocSnap.data();
      if (dismData && dismData.dismissals) {
        defaultResult.shelfDismissals = dismData.dismissals;
      }
    }

    // 10. Fetch Cloud Entitlement
    const entitlementDocRef = doc(currentDb, "users", uid, "data", "entitlement");
    const entitlementDocSnap = await getDoc(entitlementDocRef);
    if (entitlementDocSnap.exists()) {
      const entData = entitlementDocSnap.data();
      if (entData) {
        defaultResult.entitlement = entData as UserEntitlement;
      }
    }
    // 10b. Fetch Cloud Bookmarks ({ bookmarks: { [bookId]: BookmarkItem[] } })
    const bookmarksDocSnap = await getDoc(doc(currentDb, "users", uid, "data", "bookmarks"));
    if (bookmarksDocSnap.exists()) {
      const bmData = bookmarksDocSnap.data();
      if (bmData && bmData.bookmarks && typeof bmData.bookmarks === "object") {
        defaultResult.bookmarks = bmData.bookmarks;
      }
    }

    // 11. Fetch Cloud Completed Books
    const completedDocRef = doc(currentDb, "users", uid, "data", "completed_books");
    const completedDocSnap = await getDoc(completedDocRef);
    if (completedDocSnap.exists()) {
      const compData = completedDocSnap.data();
      if (compData && Array.isArray(compData.completedIds)) {
        defaultResult.completedBookIds = compData.completedIds;
      }
    }
  } catch (err) {
    console.warn("[Firestore] Error fetching full cloud user data:", err);
  }

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
    syncReadingActivityToCloud(user.uid, finalReadingActivity);

    // 3. Two-way safe union merge for favorites
    const localFavs = getStoredFavorites(user.uid);
    const cloudFavs = Array.isArray(cloudData.favorites) ? cloudData.favorites : [];
    const mergedFavs = Array.from(new Set([...localFavs, ...cloudFavs]));
    cloudData.favorites = mergedFavs;
    saveStoredFavorites(mergedFavs, user.uid);
    const cloudFavsSet = new Set(cloudFavs);
    localFavs.forEach((favId) => {
      if (!cloudFavsSet.has(favId)) {
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
        syncReadingProgressToCloud(user.uid, localItem.bookId, localItem.page, localItem.totalPages);
      } else {
        const merged = mergeProgressItems(existing, localItem);
        historyMap.set(localItem.bookId, merged);
        if (merged.page > (existing.page || 0) || merged.totalPages !== existing.totalPages) {
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
    if (hasLocalMemoriesToUpload && Object.keys(mergedMemories).length > 0) {
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
        syncReadingProgressToCloud(user.uid, bId, total, total);
      }
    });
    cloudData.readingHistory = Array.from(historyMap.values()).sort((a, b) => (b.lastReadAt || 0) - (a.lastReadAt || 0));
    saveStoredReadingHistory(cloudData.readingHistory, user.uid);

    if (mergedCompletedIds.length > cloudCompletedIds.length) {
      syncCompletedBooksToCloud(user.uid, mergedCompletedIds);
    }

    // 7. Two-way safe union merge for collections & reflections
    const localCollections = getReadingCollections(user.uid);
    const cloudCollections = Array.isArray(cloudData.collections) ? cloudData.collections : [];
    const colMap = new Map<string, ReadingCollection>();
    cloudCollections.forEach((c) => {
      if (c?.id) colMap.set(c.id, { ...c });
    });
    localCollections.forEach((c) => {
      if (!c?.id) return;
      if (!colMap.has(c.id)) {
        colMap.set(c.id, { ...c });
      } else {
        const existing = colMap.get(c.id)!;
        existing.bookIds = Array.from(new Set([...(existing.bookIds || []), ...(c.bookIds || [])]));
      }
    });
    cloudData.collections = Array.from(colMap.values());
    if (localCollections.length > cloudCollections.length) {
      syncCollectionsToCloud(user.uid, cloudData.collections);
    }

    const localReflections = getBookReflections(user.uid);
    cloudData.reflections = { ...localReflections, ...(cloudData.reflections || {}) };

    const localDismissals = getShelfDismissals(user.uid);
    const cloudDismissals = cloudData.shelfDismissals || {};
    const mergedDismissals: ShelfDismissalsMap = { ...cloudDismissals };
    Object.entries(localDismissals).forEach(([sec, bMap]) => {
      mergedDismissals[sec] = { ...(mergedDismissals[sec] || {}), ...bMap };
    });
    cloudData.shelfDismissals = mergedDismissals;

    // 8. Two-way merge for active website time
    const localActive = getWebsiteActiveTimeData(user.uid);
    const cloudActive = cloudData.activeTime || { totalActiveSeconds: 0, daily: {}, lastUpdated: Date.now() };
    const mergedDailyActive: Record<string, number> = { ...(cloudActive.daily || {}) };
    Object.entries(localActive.daily || {}).forEach(([k, secs]) => {
      mergedDailyActive[k] = Math.max(mergedDailyActive[k] || 0, secs || 0);
    });
    cloudData.activeTime = {
      totalActiveSeconds: Math.max(localActive.totalActiveSeconds || 0, cloudActive.totalActiveSeconds || 0),
      daily: mergedDailyActive,
      lastUpdated: Math.max(localActive.lastUpdated || 0, cloudActive.lastUpdated || 0),
    };

    // 8b. Two-way merge for bookmarks: upload anything local that the cloud is missing
    const localBookmarks = getAllBookmarks(user.uid);
    const cloudBookmarks = cloudData.bookmarks || {};
    const mergedBookmarks: Record<string, BookmarkItem[]> = {};
    new Set([...Object.keys(localBookmarks), ...Object.keys(cloudBookmarks)]).forEach((bookId) => {
      const cloudList = Array.isArray(cloudBookmarks[bookId]) ? cloudBookmarks[bookId] : [];
      const merged = mergeBookmarkLists(cloudList, localBookmarks[bookId] || []);
      mergedBookmarks[bookId] = merged;
      if (merged.length > cloudList.length) {
        syncBookmarksToCloud(user.uid, bookId, merged);
      }
    });
    cloudData.bookmarks = mergedBookmarks;

    // 8c. Upload local-only annotations (e.g. made as a guest before signing in) that the cloud lacks
    const localAnnotations = getAllBookAnnotations(user.uid);
    Object.entries(localAnnotations).forEach(([bookId, localAnn]) => {
      const cloudAnn = cloudData.annotations?.[bookId];
      if (annotationsAddContent(cloudAnn, localAnn)) {
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

  progressDebounceTimers[key] = setTimeout(async () => {
    delete progressDebounceTimers[key];
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
  }, 2000); // 2-second debounce
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

  annotationsDebounceTimers[key] = setTimeout(async () => {
    delete annotationsDebounceTimers[key];
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
  }, 2000);
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

  bookmarksDebounceTimers[key] = setTimeout(async () => {
    delete bookmarksDebounceTimers[key];
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
  }, 2000);
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

  activityDebounceTimers[key] = setTimeout(async () => {
    delete activityDebounceTimers[key];
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
  }, 3000); // 3-second debounce
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

  activeTimeDebounceTimers[key] = setTimeout(async () => {
    delete activeTimeDebounceTimers[key];
    try {
      const activeDb = getFirebaseDb() || db;
      if (!activeDb) return;
      const atRef = doc(activeDb, "users", uid, "data", "active_time");
      await setDoc(atRef, activeTimeData, { merge: true });
    } catch (err) {
      console.warn("[Firestore] Failed to sync active time:", err);
    }
  }, 4000); // 4-second debounce
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

  memoryDebounceTimers[key] = setTimeout(async () => {
    delete memoryDebounceTimers[key];
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
  }, 3000); // 3-second debounce
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

  collectionsDebounceTimers[key] = setTimeout(async () => {
    delete collectionsDebounceTimers[key];
    try {
      const activeDb = getFirebaseDb() || db;
      if (!activeDb) return;
      const docRef = doc(activeDb, "users", uid, "data", "collections");
      await setDoc(docRef, { collections }, { merge: true });
    } catch (err) {
      console.warn("[Firestore] Failed to sync collections to cloud:", err);
    }
  }, 1000);
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

  reflectionsDebounceTimers[key] = setTimeout(async () => {
    delete reflectionsDebounceTimers[key];
    try {
      const activeDb = getFirebaseDb() || db;
      if (!activeDb) return;
      const docRef = doc(activeDb, "users", uid, "data", "reflections");
      await setDoc(docRef, { reflections }, { merge: true });
    } catch (err) {
      console.warn("[Firestore] Failed to sync reflections to cloud:", err);
    }
  }, 1000);
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

  dismissalsDebounceTimers[key] = setTimeout(async () => {
    delete dismissalsDebounceTimers[key];
    try {
      const activeDb = getFirebaseDb() || db;
      if (!activeDb) return;
      const docRef = doc(activeDb, "users", uid, "data", "shelf_dismissals");
      await setDoc(docRef, { dismissals }, { merge: true });
    } catch (err) {
      console.warn("[Firestore] Failed to sync shelf dismissals to cloud:", err);
    }
  }, 1000);
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



