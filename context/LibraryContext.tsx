"use client";

import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback, useMemo, useRef } from "react";
import { usePathname } from "next/navigation";
import type { User } from "firebase/auth";
import { Book, BOOKS } from "@/data/books";
import {
  BookmarkItem,
  getBookmarks as getStoredBookmarks,
  saveBookmark as storeBookmark,
  deleteBookmark as deleteStoredBookmark,
  isPageBookmarked as checkIsBookmarked,
  calculateReadingStats,
  exportAllUserData,
  importUserData,
  getReadingActivityData,
  setActiveUserUid,
  addActiveReadingTime,
  getWebsiteActiveTimeData,
  WebsiteActiveTimeData,
  addWebsiteActiveSeconds,
  addBookReadingSeconds,
  getLocalDateKey,
  DAILY_READING_GOAL_SECONDS,
  ReadingStats,
  ReadingStreakData,
  BookReadingMemory,
  BookAnnotations,
  ReadingTimelineEvent,
  getBookReadingMemory,
  getAllReadingMemories,
  recordReadingMemorySession,
  isBookOffline as checkIsBookOffline,
  cacheBookOffline as storeBookOffline,
  removeBookOffline as deleteBookOffline,
  clearReadingHistory as purgeReadingHistory,
  clearAllAnnotations as purgeAllAnnotations,
  clearStreakData as purgeStreakData,
  clearAllOfflineBooks as purgeAllOfflineBooks,
  factoryResetAllData as purgeFactoryResetAll,
  ShelfSectionKey,
  ShelfDismissalsMap,
  getShelfDismissals,
  dismissBookFromShelf,
  restoreBookToShelf,
  isBookDismissedFromShelf,
  clearShelfDismissals,
  ReadingCollection,
  BookReflection,
  getReadingCollections,
  createReadingCollection as createCollStorage,
  updateReadingCollection as updateCollStorage,
  deleteReadingCollection as deleteCollStorage,
  addBookToCollection as addCollStorage,
  removeBookFromCollection as removeCollStorage,
  getCollectionsForBook as getCollsForBookStorage,
  clearAllCollections,
  getBookReflections,
  getBookReflection,
  saveBookReflection,
  removeBookReflection,
  clearAllReflections,
  clearAllUserDataOnLogout,
  getStoredFavorites,
  saveStoredFavorites,
  getStoredReadingHistory,
  saveStoredReadingHistory,
  removeStoredReadingProgressItem,
  clearStoredReadingHistory,
  clearStoredFavorites,
  clearAllUserDataForUid,
  migrateGuestDataToUser,
  getGenuinelyCompletedBookIds,
} from "@/lib/reader-storage";
import { useAuth } from "@/context/AuthContext";
import {
  syncUserProfile,
  reconcileAndSyncAllUserData,
  syncReadingProgressToCloud,
  deleteCloudBookProgress,
  syncReadingActivityToCloud,
  syncActiveTimeToCloud,
  syncReadingMemoryToCloud,
  syncAnnotationsToCloud,
  syncBookmarksToCloud,
  syncFavoriteToCloud,
  syncCollectionsToCloud,
  syncReflectionsToCloud,
  syncShelfDismissalsToCloud,
  syncCompletedBooksToCloud,
  cancelAllPendingSyncTimers,
  flushPendingActivitySyncs,
  deleteCloudReadingProgress,
  deleteCloudReadingActivity,
  deleteCloudAnnotations,
  deleteCloudFavorites,
  permanentFactoryResetCloudData,
  syncCertificateToCloud,
  backfillCertificatesToCloud,
  flushAllPendingSyncs,
  getLastCloudVerification,
  verifyCloudCopy,
} from "@/lib/firestore-sync";
import {
  recordPublicActivity,
  sanitizeUsername,
  calculateUserAchievements,
  syncPublicProfileMetrics,
  Achievement,
} from "@/lib/social";
import {
  BookCompletionCertificate,
  createCertificateData,
  saveCertificate,
  getStoredCertificates,
  getCertificateForBook as getStoredBookCertificate,
} from "@/lib/certificate";
import CompletionCertificateModal from "@/components/certificate/CompletionCertificateModal";
import { touchUserLastActive } from "@/lib/active-tracker";
import { computeReadingProgress } from "@/lib/reading-merge";

export interface ReadingProgressItem {
  bookId: string;
  page: number;
  totalPages: number;
  progress: number; // 0 - 100%
  lastReadAt: number;
}

export interface RecentBook extends Book {
  progress: number;
  lastPage: number;
}

export interface ActiveReadingSession {
  isActive: boolean;
  bookId: string;
  startPage: number;
  targetMinutes: number;
  elapsedSeconds: number;
  startedAt: number;
}

interface LibraryContextType {
  user: User | null;
  favorites: string[];
  isFavorite: (bookId: string) => boolean;
  toggleFavorite: (bookId: string) => void;
  removeFavorite: (bookId: string) => void;
  favoriteBooks: Book[];
  readingHistory: ReadingProgressItem[];
  recentBooks: RecentBook[];
  recordReading: (bookId: string, page?: number, totalPages?: number) => void;
  updateReadingProgress: (bookId: string, page: number, totalPages?: number) => void;
  getReadingProgress: (bookId: string) => ReadingProgressItem | undefined;
  removeHistoryItem: (bookId: string) => void;
  clearHistory: () => void;
  toastMessage: string | null;
  showToast: (msg: string) => void;
  // Shelf Section Dismissals
  shelfDismissals: ShelfDismissalsMap;
  dismissFromShelf: (section: ShelfSectionKey, bookId: string) => void;
  restoreToShelf: (section: ShelfSectionKey, bookId: string) => void;
  isDismissedFromShelf: (section: ShelfSectionKey, bookId: string) => boolean;
  // Smart Reading Collections (Isolated: readershub:collections:v1)
  collections: ReadingCollection[];
  createCollection: (name: string, description?: string, color?: string) => ReadingCollection;
  updateCollection: (id: string, updates: Partial<Pick<ReadingCollection, "name" | "description" | "color">>) => void;
  deleteCollection: (id: string) => void;
  addBookToCollection: (collectionId: string, bookId: string) => void;
  removeBookFromCollection: (collectionId: string, bookId: string) => void;
  getCollectionsForBook: (bookId: string) => ReadingCollection[];
  // Post-Completion Reflections (Isolated: readershub:reflections:v1)
  reflections: Record<string, BookReflection>;
  getReflection: (bookId: string) => BookReflection | null;
  saveReflection: (bookId: string, reflection: string, rating?: number) => void;
  removeReflection: (bookId: string) => void;
  // Bookmarks & Stats Extensions
  getBookmarks: (bookId: string) => BookmarkItem[];
  addBookmark: (bookId: string, page: number, label?: string) => BookmarkItem;
  removeBookmark: (bookId: string, bookmarkId: string) => void;
  isBookmarked: (bookId: string, page: number) => boolean;
  stats: ReadingStats;
  refreshStats: () => void;
  exportData: () => string;
  importData: (jsonStr: string) => { success: boolean; message: string };
  // Active Time vs Reading Time Distinction
  globalActiveSeconds: number;
  todayActiveSeconds: number;
  globalReadingSeconds: number;
  activeTimeData: WebsiteActiveTimeData;
  recordWebsiteActiveTime: (seconds: number) => { totalActiveSeconds: number; todayActiveSeconds: number };
  addBookReadingTime: (bookId: string, seconds: number) => BookReadingMemory;
  // Streak & Active Reading Extensions (Diwali Diya)
  streakData: ReadingStreakData;
  todayReadingSeconds: number;
  isTodayQualified: boolean;
  recordActiveReading: (seconds: number) => {
    todaySeconds: number;
    qualified: boolean;
    justQualified: boolean;
    currentStreak: number;
  };
  // Reading Memory & Structured Sessions
  readingMemories: Record<string, BookReadingMemory>;
  annotations: Record<string, BookAnnotations>;
  getReadingMemory: (bookId: string) => BookReadingMemory;
  recordSessionEvent: (event: Omit<ReadingTimelineEvent, "id">) => void;
  activeSession: ActiveReadingSession | null;
  startReadingSession: (bookId: string, startPage: number, targetMinutes: number) => void;
  endReadingSession: () => void;
  // Offline Caching
  checkOfflineStatus: (bookId: string, pdfUrl: string) => Promise<boolean>;
  saveBookOffline: (bookId: string, pdfUrl: string) => Promise<boolean>;
  removeBookOffline: (bookId: string, pdfUrl: string) => Promise<boolean>;

  // Granular Reset & Recovery
  clearAllProgress: () => Promise<void>;
  clearAnnotations: () => Promise<void>;
  clearStreak: () => Promise<void>;
  clearOfflineStorage: () => Promise<void>;
  clearLocalDeviceCache: () => Promise<void>;
  factoryReset: (mode?: "local_cache" | "permanent_cloud") => Promise<void>;

  // Certificate & Immediate Recognition
  activeCertificate: BookCompletionCertificate | null;
  openCertificateModal: (certificate: BookCompletionCertificate) => void;
  closeCertificateModal: () => void;
  getCertificateForBook: (bookId: string) => BookCompletionCertificate | null;
}

const LibraryContext = createContext<LibraryContextType | undefined>(undefined);

const BOOKS_BY_ID = new Map(BOOKS.map((b) => [b.id, b]));

const FAVORITES_KEY = "readers_hub_favorites_v2";
const HISTORY_KEY = "readers_hub_reading_progress_v2";

export function LibraryProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  const [favorites, setFavorites] = useState<string[]>(() => {
    if (typeof window !== "undefined") {
      try {
        return getStoredFavorites();
      } catch {}
    }
    return [];
  });
  const [readingHistory, setReadingHistory] = useState<ReadingProgressItem[]>(() => {
    if (typeof window !== "undefined") {
      try {
        return getStoredReadingHistory();
      } catch {}
    }
    return [];
  });
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [shelfDismissals, setShelfDismissals] = useState<ShelfDismissalsMap>({});
  const [collections, setCollections] = useState<ReadingCollection[]>([]);
  const [reflections, setReflections] = useState<Record<string, BookReflection>>({});
  const [readingMemories, setReadingMemories] = useState<Record<string, BookReadingMemory>>({});
  const [annotations, setAnnotationsState] = useState<Record<string, BookAnnotations>>({});
  const [activeSession, setActiveSession] = useState<ActiveReadingSession | null>(null);
  const [activeCertificate, setActiveCertificate] = useState<BookCompletionCertificate | null>(null);
  const [isNewCertificate, setIsNewCertificate] = useState<boolean>(false);
  const [activeTimeState, setActiveTimeState] = useState<{
    totalActiveSeconds: number;
    todayActiveSeconds: number;
  }>({ totalActiveSeconds: 0, todayActiveSeconds: 0 });
  const [activeTimeData, setActiveTimeData] = useState<WebsiteActiveTimeData>(() => ({
    totalActiveSeconds: 0,
    daily: {},
    explorationDaily: {},
    totalExplorationSeconds: 0,
    lastUpdated: Date.now(),
  }));
  const [streakData, setStreakData] = useState<ReadingStreakData>({
    daily: {},
    currentStreak: 0,
    longestStreak: 0,
    lastQualifiedDate: null,
  });
  const [stats, setStats] = useState<ReadingStats>({
    booksStarted: 0,
    booksCompleted: 0,
    pagesRead: 0,
    totalFavorites: 0,
    totalBookmarks: 0,
    totalNotes: 0,
    totalHighlights: 0,
    totalDrawings: 0,
    readingStreakDays: 0,
    todayReadingSeconds: 0,
    isTodayQualified: false,
    totalReadingSeconds: 0,
    totalActiveSeconds: 0,
    todayActiveSeconds: 0,
  });
  const [mounted, setMounted] = useState(false);

  const favoritesRef = useRef(favorites);
  favoritesRef.current = favorites;
  const readingHistoryRef = useRef(readingHistory);
  readingHistoryRef.current = readingHistory;
  const streakDataRef = useRef(streakData);
  streakDataRef.current = streakData;
  const activeTimeDataRef = useRef<WebsiteActiveTimeData>({
    totalActiveSeconds: 0,
    daily: {},
    lastUpdated: Date.now(),
  });

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 3200);
  }, []);

  useEffect(() => {
    setShelfDismissals(getShelfDismissals());
    setCollections(getReadingCollections());
    setReflections(getBookReflections());
    try {
      const storedFavs = getStoredFavorites();
      if (storedFavs && storedFavs.length > 0) setFavorites(storedFavs);
      const storedHist = getStoredReadingHistory();
      if (storedHist && storedHist.length > 0) setReadingHistory(storedHist);
      const storedMem = getAllReadingMemories();
      if (storedMem && Object.keys(storedMem).length > 0) setReadingMemories(storedMem);
    } catch (e) {
      console.warn("[LibraryContext] Failed to load local favorites/history/memories:", e);
    }
  }, []);

  const dismissFromShelf = useCallback((section: ShelfSectionKey, bookId: string) => {
    dismissBookFromShelf(section, bookId);
    const updated = getShelfDismissals();
    setShelfDismissals(updated);
    if (user) {
      syncShelfDismissalsToCloud(user.uid, updated);
    }
    const book = BOOKS.find((b) => b.id === bookId);
    const title = book ? book.title : "Book";
    showToast(`Removed "${title}" from shelf view`);
  }, [showToast, user]);

  const restoreToShelf = useCallback((section: ShelfSectionKey, bookId: string) => {
    restoreBookToShelf(section, bookId);
    const updated = getShelfDismissals();
    setShelfDismissals(updated);
    if (user) {
      syncShelfDismissalsToCloud(user.uid, updated);
    }
  }, [user]);


  const createCollection = useCallback((name: string, description?: string, color?: string) => {
    const newCol = createCollStorage(name, description, color);
    const updated = getReadingCollections();
    setCollections(updated);
    if (user) {
      syncCollectionsToCloud(user.uid, updated);
    }
    showToast(`Created collection "${newCol.name}"`);
    return newCol;
  }, [showToast, user]);

  const updateCollection = useCallback((id: string, updates: Partial<Pick<ReadingCollection, "name" | "description" | "color">>) => {
    updateCollStorage(id, updates);
    const updated = getReadingCollections();
    setCollections(updated);
    if (user) {
      syncCollectionsToCloud(user.uid, updated);
    }
  }, [user]);

  const deleteCollection = useCallback((id: string) => {
    deleteCollStorage(id);
    const updated = getReadingCollections();
    setCollections(updated);
    if (user) {
      syncCollectionsToCloud(user.uid, updated);
    }
    showToast("Collection removed");
  }, [showToast, user]);

  const addBookToCollection = useCallback((collectionId: string, bookId: string) => {
    addCollStorage(collectionId, bookId);
    const updated = getReadingCollections();
    setCollections(updated);
    if (user) {
      syncCollectionsToCloud(user.uid, updated);
    }
    const book = BOOKS.find((b) => b.id === bookId);
    const col = updated.find((c) => c.id === collectionId);
    showToast(`Added ${book ? `"${book.title}"` : "book"} to ${col ? col.name : "collection"}`);
  }, [showToast, user]);

  const removeBookFromCollection = useCallback((collectionId: string, bookId: string) => {
    removeCollStorage(collectionId, bookId);
    const updated = getReadingCollections();
    setCollections(updated);
    if (user) {
      syncCollectionsToCloud(user.uid, updated);
    }
    showToast("Removed from collection");
  }, [showToast, user]);

  const getCollectionsForBookHandler = useCallback((bookId: string) => {
    return getCollsForBookStorage(bookId);
  }, []);

  const getReflection = useCallback((bookId: string) => {
    return getBookReflection(bookId);
  }, []);

  const saveReflection = useCallback((bookId: string, reflection: string, rating?: number) => {
    saveBookReflection(bookId, reflection, rating);
    const updated = getBookReflections();
    setReflections(updated);
    if (user) {
      syncReflectionsToCloud(user.uid, updated);
    }
    showToast("Reading reflection saved! 📝");
  }, [showToast, user]);

  const removeReflection = useCallback((bookId: string) => {
    removeBookReflection(bookId);
    const updated = getBookReflections();
    setReflections(updated);
    if (user) {
      syncReflectionsToCloud(user.uid, updated);
    }
  }, [user]);

  const isDismissedFromShelf = useCallback((section: ShelfSectionKey, bookId: string) => {
    return Boolean(shelfDismissals[section]?.[bookId]);
  }, [shelfDismissals]);

  const refreshStats = useCallback(
    (
      explicitHist?: ReadingProgressItem[],
      explicitFavs?: string[],
      explicitStreak?: ReadingStreakData,
      explicitActiveTime?: WebsiteActiveTimeData
    ) => {
      const targetUid = user?.uid;
      const calculated = calculateReadingStats(
        targetUid,
        explicitHist !== undefined ? explicitHist : readingHistoryRef.current,
        explicitFavs !== undefined ? explicitFavs : favoritesRef.current,
        explicitStreak !== undefined ? explicitStreak : streakDataRef.current,
        explicitActiveTime !== undefined ? explicitActiveTime : activeTimeDataRef.current
      );
      const act = explicitStreak || getReadingActivityData(targetUid);
      const actTime = explicitActiveTime || getWebsiteActiveTimeData(targetUid);
      activeTimeDataRef.current = actTime;
      const todayKey = getLocalDateKey();
      setStats(calculated);
      setStreakData(act);
      setActiveTimeState({
        totalActiveSeconds: actTime.totalActiveSeconds || 0,
        todayActiveSeconds: actTime.daily[todayKey] || 0,
      });
    },
    [user]
  );

  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  // Global Website Engagement & Active Time Tracker (Meaningful Site Interaction outside PDF Reader)
  useEffect(() => {
    if (typeof window === "undefined") return;

    const SITE_IDLE_TIMEOUT_MS = 60 * 1000; // 60 seconds inactivity threshold
    let lastSiteActivity = Date.now();
    let accumulatedSiteSecs = 0;

    const registerSiteActivity = () => {
      lastSiteActivity = Date.now();
    };

    const events = ["pointerdown", "keydown", "scroll", "touchstart", "wheel"];
    events.forEach((ev) => window.removeEventListener(ev, registerSiteActivity));
    events.forEach((ev) => window.addEventListener(ev, registerSiteActivity, { passive: true }));

    const flushSiteActiveTime = () => {
      if (accumulatedSiteSecs > 0) {
        const res = addWebsiteActiveSeconds(accumulatedSiteSecs, user?.uid);
        accumulatedSiteSecs = 0;
        setActiveTimeState(res);
        if (user) {
          const actTime = getWebsiteActiveTimeData(user.uid);
          activeTimeDataRef.current = actTime;
          syncActiveTimeToCloud(user.uid, actTime);
        }
      }
    };

    const interval = setInterval(() => {
      const isReadingPdf = pathnameRef.current?.startsWith("/book/");
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "visible" &&
        !isReadingPdf &&
        Date.now() - lastSiteActivity < SITE_IDLE_TIMEOUT_MS
      ) {
        accumulatedSiteSecs += 1;
        if (accumulatedSiteSecs >= 5) {
          const res = addWebsiteActiveSeconds(accumulatedSiteSecs, user?.uid);
          accumulatedSiteSecs = 0;
          setActiveTimeState(res);
          if (user) {
            const actTime = getWebsiteActiveTimeData(user.uid);
            activeTimeDataRef.current = actTime;
            syncActiveTimeToCloud(user.uid, actTime);
          }
        }
      }
    }, 1000);

    const handleVisibility = () => {
      if (document.visibilityState !== "visible") {
        flushSiteActiveTime();
      } else {
        lastSiteActivity = Date.now();
      }
    };

    // Immediately flush all pending debounced writes to Firestore on tab close / browser switch.
    // pagehide is more reliable than beforeunload across browsers (including mobile).
    const handlePageHide = () => {
      flushSiteActiveTime();
      if (user) {
        const act = getReadingActivityData(user.uid);
        const actTime = getWebsiteActiveTimeData(user.uid);
        // flushPendingActivitySyncs cancels existing debounce timers and writes immediately.
        flushPendingActivitySyncs(user.uid, act, actTime);
        // Also send any other pending debounced writes (progress, highlights, bookmarks, collections...)
        flushAllPendingSyncs();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("beforeunload", flushSiteActiveTime);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      clearInterval(interval);
      flushSiteActiveTime();
      events.forEach((ev) => window.removeEventListener(ev, registerSiteActivity));
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("beforeunload", flushSiteActiveTime);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [user]);

  useEffect(() => {
    setMounted(true);
  }, []);

  const prevUserRef = useRef<string | null>(null);

  // Synchronize with Firebase Firestore on authentication state changes (Authoritative Cloud State)
  useEffect(() => {
    if (!user) {
      setActiveUserUid(null);
      if (prevUserRef.current !== null) {
        // User logged out: abort in-flight debounce timers, clear session caches and reset state to pristine guest defaults
        cancelAllPendingSyncTimers();
        clearAllUserDataOnLogout();
        setFavorites([]);
        setReadingHistory([]);
        setCollections([]);
        setReflections({});
        setShelfDismissals({});
        setReadingMemories({});
        setAnnotationsState({});
        setStreakData({
          daily: {},
          currentStreak: 0,
          longestStreak: 0,
          lastQualifiedDate: null,
        });
        setActiveTimeState({ totalActiveSeconds: 0, todayActiveSeconds: 0 });
        setActiveTimeData({
          totalActiveSeconds: 0,
          daily: {},
          explorationDaily: {},
          totalExplorationSeconds: 0,
          lastUpdated: Date.now(),
        });
        setStats(calculateReadingStats());
        setActiveSession(null);
      }
      prevUserRef.current = null;
      return;
    }

    prevUserRef.current = user.uid;
    setActiveUserUid(user.uid);
    // Non-destructively attach any pre-login guest data on this device to this user account
    migrateGuestDataToUser(user.uid);

    // Immediately prime local state with this user's isolated local activity before cloud sync arrives
    const localUserStreak = getReadingActivityData(user.uid);
    setStreakData(localUserStreak);
    const localActiveTime = getWebsiteActiveTimeData(user.uid);
    setActiveTimeData(localActiveTime);

    // Immediately prime local favorites and reading history before cloud sync arrives
    const localFavs = getStoredFavorites(user.uid);
    if (localFavs && localFavs.length > 0) {
      setFavorites(localFavs);
    }
    const localHist = getStoredReadingHistory(user.uid);
    if (localHist && localHist.length > 0) {
      setReadingHistory(localHist);
    }
    const localMems = getAllReadingMemories(user.uid);
    if (localMems && Object.keys(localMems).length > 0) {
      setReadingMemories(localMems);
    }
    const localCols = getReadingCollections(user.uid);
    if (localCols && localCols.length > 0) {
      setCollections(localCols);
    }
    const localRefs = getBookReflections(user.uid);
    if (localRefs && Object.keys(localRefs).length > 0) {
      setReflections(localRefs);
    }
    const localDism = getShelfDismissals(user.uid);
    if (localDism && Object.keys(localDism).length > 0) {
      setShelfDismissals(localDism);
    }

    let isCancelled = false;

    const performSync = async () => {
      // 1. Fetch Authoritative Cloud State from Firestore
      const cloudData = await reconcileAndSyncAllUserData(user);

      if (isCancelled) return;

      // 2. Update React state strictly from the authenticated cloud state
      setFavorites(cloudData.favorites);
      setReadingHistory(cloudData.readingHistory);
      setStreakData(cloudData.readingActivity);
      setCollections(cloudData.collections || []);
      setReflections(cloudData.reflections || {});
      setShelfDismissals(cloudData.shelfDismissals || {});
      setReadingMemories(cloudData.readingMemories || {});
      setAnnotationsState(cloudData.annotations || {});

      activeTimeDataRef.current = cloudData.activeTime;
      setActiveTimeData(cloudData.activeTime);
      const todayKey = getLocalDateKey();
      setActiveTimeState({
        totalActiveSeconds: cloudData.activeTime.totalActiveSeconds || 0,
        todayActiveSeconds: cloudData.activeTime.daily[todayKey] || 0,
      });
      const calculated = calculateReadingStats(
        user.uid,
        cloudData.readingHistory,
        cloudData.favorites,
        cloudData.readingActivity,
        cloudData.activeTime
      );
      setStats(calculated);

      // Synchronize public profile metrics and achievements safely & additively to Firestore
      syncPublicProfileMetrics(
        user.uid,
        cloudData.readingHistory,
        cloudData.readingActivity,
        cloudData.activeTime.totalActiveSeconds || 0,
        cloudData.reflections || {},
        calculated.totalReadingSeconds,
        cloudData.readingMemories || {},
        {
          totalPagesRead: calculated.pagesRead,
          totalAnnotations: calculated.totalHighlights + calculated.totalNotes + calculated.totalDrawings,
          favoritesCount: cloudData.favorites.length,
          collectionsCount: (cloudData.collections || []).length,
          offlineCount: 0,
        }
      ).catch(() => {});

      // Upload certificates that exist only on this device, then cache the cloud copy for offline display
      backfillCertificatesToCloud(user.uid, getStoredCertificates(user.uid))
        .then((cloudCerts) => {
          if (cloudCerts && typeof cloudCerts === "object") {
            Object.values(cloudCerts).forEach((c: any) => {
              if (c && c.bookId) saveCertificate(c, user.uid);
            });
          }
        })
        .catch(() => {})
        .finally(() => {
          // Read the account back to confirm the cloud holds everything this device has (at most daily, or
          // sooner if the last check found gaps). Read-only for local data; gaps are retried by the next sync.
          const last = getLastCloudVerification(user.uid);
          const due = !last || !last.complete || Date.now() - last.verifiedAt > 24 * 60 * 60 * 1000;
          if (due && !isCancelled) {
            setTimeout(() => {
              if (!isCancelled) verifyCloudCopy(user.uid, getStoredCertificates(user.uid)).catch(() => {});
            }, 8000);
          }
        });
    };

    performSync();
    if (user) {
      touchUserLastActive(user.uid);
    }

    return () => {
      isCancelled = true;
    };
  }, [user]);

  // Automatic reconnect sync: when device regains network, sync offline changes to Firestore
  useEffect(() => {
    if (typeof window === "undefined" || !user) return;
    const handleOnline = () => {
      reconcileAndSyncAllUserData(user)
        .then((cloudData) => {
          setFavorites(cloudData.favorites);
          setReadingHistory(cloudData.readingHistory);
          setStreakData(cloudData.readingActivity);
          setReadingMemories(cloudData.readingMemories || {});
          refreshStats(
            cloudData.readingHistory,
            cloudData.favorites,
            cloudData.readingActivity,
            cloudData.activeTime
          );
        })
        .catch((err) => {
          console.warn("[LibraryContext] Reconnect sync note:", err);
        });
    };
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("online", handleOnline);
    };
  }, [user, refreshStats]);

  // Tab visibility change activity trigger (throttled to 3 minutes)
  useEffect(() => {
    if (!user) return;
    const handleVisibility = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        touchUserLastActive(user.uid);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [user]);

  const toggleFavorite = useCallback((bookId: string) => {
    let wasAdded = false;
    let bookTitle = "Book";
    setFavorites((prev) => {
      const book = BOOKS.find((b) => b.id === bookId);
      if (book) bookTitle = book.title;

      let updated: string[];
      if (prev.includes(bookId)) {
        updated = prev.filter((id) => id !== bookId);
      } else {
        wasAdded = true;
        updated = [...prev, bookId];
      }
      saveStoredFavorites(updated, user?.uid);
      return updated;
    });

    if (user) {
      syncFavoriteToCloud(user.uid, bookId, wasAdded);
    }

    if (wasAdded) {
      showToast(`Saved "${bookTitle}" to favorites ❤️`);
    } else {
      showToast(`Removed "${bookTitle}" from shelf`);
    }
    refreshStats();
  }, [refreshStats, showToast, user]);

  const removeFavorite = useCallback((bookId: string) => {
    setFavorites((prev) => {
      const updated = prev.filter((id) => id !== bookId);
      saveStoredFavorites(updated, user?.uid);
      return updated;
    });
    if (user) {
      syncFavoriteToCloud(user.uid, bookId, false);
    }
    refreshStats();
  }, [refreshStats, user]);

  const isFavorite = useCallback((bookId: string) => favorites.includes(bookId), [favorites]);

  const recordReading = useCallback((bookId: string, page?: number, totalPages?: number) => {
    if (!bookId) return;

    // Computed synchronously from the latest committed history (no side effects inside setState updaters)
    const prevHistory = readingHistoryRef.current;
    const existing = prevHistory.find((item) => item.bookId === bookId);
    const catalogPages = Number(BOOKS.find((b) => b.id === bookId)?.pages) || 0;
    const { item, changed, isNewCompletion: reachedEnd } = computeReadingProgress(
      existing,
      bookId,
      page,
      totalPages,
      catalogPages
    );
    const finalPage = item.page;
    const finalTotal = item.totalPages;

    let updatedHistoryList: ReadingProgressItem[] = prevHistory;
    if (changed) {
      updatedHistoryList = [item, ...prevHistory.filter((h) => h.bookId !== bookId)];
      readingHistoryRef.current = updatedHistoryList;
      saveStoredReadingHistory(updatedHistoryList, user?.uid);
      setReadingHistory(updatedHistoryList);
    }

    // Opening a book brings it back to shelf sections the reader had dismissed it from
    if (isBookDismissedFromShelf("reading", bookId, user?.uid) || isBookDismissedFromShelf("spotlight", bookId, user?.uid)) {
      restoreBookToShelf("reading", bookId, user?.uid);
      restoreBookToShelf("spotlight", bookId, user?.uid);
      setShelfDismissals(getShelfDismissals(user?.uid));
    }

    // A book earns one completion (certificate + public activity), even if it is finished again later
    const isNewCompletion = reachedEnd && !getStoredBookCertificate(bookId, user?.uid);

    if (user && changed) {
      syncReadingProgressToCloud(user.uid, bookId, finalPage, finalTotal);
    }

    if (user && isNewCompletion) {
      const targetBook = BOOKS.find((b) => b.id === bookId);
      recordPublicActivity({
        uid: user.uid,
        username: user.displayName ? sanitizeUsername(user.displayName) : "reader",
        displayName: user.displayName || "Reader",
        photoURL: user.photoURL || undefined,
        type: "completed_book",
        bookId,
        bookTitle: targetBook?.title || "Book",
        bookCover: targetBook?.cover,
        timestamp: Date.now(),
      });
    }

    // Verified Book Completion: Concur Certificate & Recalculate Achievements Immediately
    if (isNewCompletion && bookId) {
      const targetBook = BOOKS.find((b) => b.id === bookId);
      const mem = getBookReadingMemory(bookId, user?.uid);
      const cert = createCertificateData({
        bookId,
        bookTitle: targetBook?.title || "Literary Masterwork",
        bookAuthor: targetBook?.author || "Honored Author",
        bookCover: targetBook?.cover || "",
        bookCategory: targetBook?.category,
        totalPages: finalTotal,
        readingSeconds: mem?.totalSeconds || 0,
        recipientName: user?.displayName || "Distinguished Scholar",
        recipientUsername: user?.displayName ? sanitizeUsername(user.displayName) : undefined,
        recipientPhoto: user?.photoURL || undefined,
        uid: user?.uid,
      });

      saveCertificate(cert, user?.uid);
      if (user?.uid) {
        syncCertificateToCloud(user.uid, cert);
        const curCompleted = getGenuinelyCompletedBookIds(updatedHistoryList, readingMemories, user.uid);
        syncCompletedBooksToCloud(user.uid, curCompleted);
      }
      setIsNewCertificate(true);
      setActiveCertificate(cert);
      showToast("🎓 Book Completed! Official Certificate of Completion conferred! ✨");

      // Instantly evaluate & unlock eligible achievements
      try {
        const streak = getReadingActivityData(user?.uid);
        const refl = getBookReflections(user?.uid);
        const historyForAch = updatedHistoryList.length > 0 ? updatedHistoryList : readingHistoryRef.current;
        const statsData = calculateReadingStats(user?.uid, historyForAch);

        const curUnlockedIds = new Set(
          calculateUserAchievements(readingHistoryRef.current, streak, refl, BOOKS).filter((a) => a.unlocked).map((a) => a.id)
        );

        const newAchievements = calculateUserAchievements(historyForAch, streak, refl, BOOKS, {
          totalPagesRead: statsData.pagesRead,
          totalReadingSeconds: statsData.totalReadingSeconds,
          totalAnnotations: statsData.totalHighlights + statsData.totalNotes + statsData.totalDrawings,
          favoritesCount: favoritesRef.current.length,
          collectionsCount: collections.length,
          offlineCount: 0,
          uid: user?.uid,
        });

        const newlyUnlocked = newAchievements.filter((a) => a.unlocked && !curUnlockedIds.has(a.id));
        if (newlyUnlocked.length > 0) {
          setTimeout(() => {
            showToast(`🏆 Milestone Unlocked: ${newlyUnlocked[0].title}! ✨`);
          }, 1800);
        }

        if (user?.uid) {
          syncPublicProfileMetrics(
            user.uid,
            historyForAch,
            streak,
            activeTimeDataRef.current.totalActiveSeconds,
            refl,
            statsData.totalReadingSeconds,
            undefined,
            {
              totalPagesRead: statsData.pagesRead,
              totalAnnotations: statsData.totalHighlights + statsData.totalNotes + statsData.totalDrawings,
              favoritesCount: favoritesRef.current.length,
              collectionsCount: collections.length,
              offlineCount: 0,
            }
          );
        }
      } catch (achErr) {
        console.warn("[LibraryContext] Immediate achievement calculation note:", achErr);
      }
    }

    if (changed) {
      refreshStats();
    }
  }, [collections.length, refreshStats, user]);

  const updateReadingProgress = useCallback((bookId: string, page: number, totalPages?: number) => {
    recordReading(bookId, page, totalPages);
  }, [recordReading]);

  const getReadingProgress = useCallback((bookId: string) => {
    return readingHistory.find((item) => item.bookId === bookId);
  }, [readingHistory]);

  const removeHistoryItem = useCallback((bookId: string) => {
    setReadingHistory((prev) => {
      const updated = prev.filter((item) => item.bookId !== bookId);
      saveStoredReadingHistory(updated, user?.uid);
      return updated;
    });
    removeStoredReadingProgressItem(bookId, user?.uid);
    if (user?.uid) {
      deleteCloudBookProgress(user.uid, bookId).catch((err) => {
        console.warn("[LibraryContext] Failed to delete cloud book progress:", err);
      });
    }
    refreshStats();
  }, [refreshStats, user]);

  const clearHistory = useCallback(() => {
    setReadingHistory([]);
    clearStoredReadingHistory(user?.uid);
    if (user?.uid) {
      deleteCloudReadingProgress(user.uid).catch((err) => {
        console.warn("[LibraryContext] Failed to clear cloud reading progress:", err);
      });
    }
    refreshStats();
    showToast("Reading history cleared");
  }, [refreshStats, showToast, user]);

  // Bookmarks Wrapper
  const getBookmarks = useCallback((bookId: string) => getStoredBookmarks(bookId, user?.uid), [user]);

  const addBookmark = useCallback((bookId: string, page: number, label?: string) => {
    const item = storeBookmark(bookId, page, label, user?.uid);
    if (user?.uid) {
      const allBookmarks = getStoredBookmarks(bookId, user.uid);
      syncBookmarksToCloud(user.uid, bookId, allBookmarks);
    }
    showToast(`Bookmarked Page ${page} 🔖`);
    refreshStats();
    return item;
  }, [refreshStats, showToast, user]);

  const removeBookmark = useCallback((bookId: string, bookmarkId: string) => {
    deleteStoredBookmark(bookId, bookmarkId, user?.uid);
    if (user?.uid) {
      const allBookmarks = getStoredBookmarks(bookId, user.uid);
      syncBookmarksToCloud(user.uid, bookId, allBookmarks);
    }
    showToast(`Bookmark removed 🔖`);
    refreshStats();
  }, [refreshStats, showToast, user]);

  const isBookmarked = useCallback((bookId: string, page: number) => checkIsBookmarked(bookId, page, user?.uid), [user]);

  // Active Reading Time Tracker (Diwali Diya)
  const recordActiveReading = useCallback((seconds: number) => {
    const targetUid = user?.uid;
    const res = addActiveReadingTime(seconds, targetUid);
    const act = getReadingActivityData(targetUid);
    const actTime = getWebsiteActiveTimeData(targetUid);
    activeTimeDataRef.current = actTime;
    setActiveTimeData(actTime);
    const todayKey = getLocalDateKey();
    const calculatedStats = calculateReadingStats(targetUid);

    setStreakData(act);
    setActiveTimeState({
      totalActiveSeconds: Math.max(actTime.totalActiveSeconds || 0, calculatedStats.totalReadingSeconds),
      todayActiveSeconds: Math.max(actTime.daily[todayKey] || 0, res.todaySeconds),
    });
    setStats(calculatedStats);

    // Update active session if running
    setActiveSession((prev) => {
      if (!prev || !prev.isActive) return prev;
      return {
        ...prev,
        elapsedSeconds: prev.elapsedSeconds + seconds,
      };
    });

    if (user) {
      syncReadingActivityToCloud(user.uid, act);
    }

    return res;
  }, [user]);

  // Reading Memory & Sessions
  const getReadingMemory = useCallback((bookId: string) => getBookReadingMemory(bookId, user?.uid), [user]);

  const recordSessionEvent = useCallback((event: Omit<ReadingTimelineEvent, "id">) => {
    const targetUid = user?.uid;
    recordReadingMemorySession(event, targetUid);
    if (user) {
      const memory = getBookReadingMemory(event.bookId, targetUid);
      if (memory) {
        syncReadingMemoryToCloud(user.uid, event.bookId, memory);
      }
    }
  }, [user]);

  const startReadingSession = useCallback((bookId: string, startPage: number, targetMinutes: number) => {
    setActiveSession({
      isActive: true,
      bookId,
      startPage,
      targetMinutes,
      elapsedSeconds: 0,
      startedAt: Date.now(),
    });
    showToast(`Started ${targetMinutes}-min Reading Session ⏱️`);
  }, [showToast]);

  const endReadingSession = useCallback(() => {
    setActiveSession(null);
  }, []);

  // Offline Caching
  const checkOfflineStatus = useCallback((bookId: string, pdfUrl: string) => checkIsBookOffline(bookId, pdfUrl), []);

  const saveBookOffline = useCallback(async (bookId: string, pdfUrl: string) => {
    const success = await storeBookOffline(bookId, pdfUrl);
    if (success) {
      showToast("Book saved for offline reading! 📦");
    } else {
      showToast("Could not cache book offline");
    }
    return success;
  }, [showToast]);

  const removeBookOffline = useCallback(async (bookId: string, pdfUrl: string) => {
    const success = await deleteBookOffline(bookId, pdfUrl);
    if (success) {
      showToast("Offline copy removed");
    }
    return success;
  }, [showToast]);

  // Backup & Export Helpers
  const exportData = useCallback(() => exportAllUserData(user?.uid ?? null), [user]);

  const handleImportData = useCallback((jsonStr: string) => {
    // Restore into the signed-in reader's namespace (or guest), merging with existing data
    const res = importUserData(jsonStr, user?.uid ?? null);
    if (res.success) {
      const favs = getStoredFavorites(user?.uid ?? null);
      setFavorites(favs);
      const hist = getStoredReadingHistory(user?.uid ?? null);
      setReadingHistory(hist);
      setCollections(getReadingCollections(user?.uid ?? null));
      setReadingMemories(getAllReadingMemories(user?.uid ?? null));
      refreshStats(hist, favs);

      // Push restored data to the reader's cloud account through the normal merge
      if (user) {
        reconcileAndSyncAllUserData(user)
          .then((cloudData) => {
            setFavorites(cloudData.favorites);
            setReadingHistory(cloudData.readingHistory);
            setStreakData(cloudData.readingActivity);
            setReadingMemories(cloudData.readingMemories || {});
            refreshStats(cloudData.readingHistory, cloudData.favorites, cloudData.readingActivity, cloudData.activeTime);
          })
          .catch((err) => console.warn("[LibraryContext] Post-import sync note:", err));
      }
    }
    showToast(res.message);
    return res;
  }, [refreshStats, showToast, user]);

  // Granular Reset Actions
  const clearAllProgress = useCallback(async () => {
    cancelAllPendingSyncTimers();
    if (user?.uid) {
      try {
        await deleteCloudReadingProgress(user.uid);
      } catch (err) {
        showToast("Failed to reset cloud reading progress. Please try again.");
        return;
      }
    }
    clearStoredReadingHistory(user?.uid);
    setReadingHistory([]);
    refreshStats([]);
    showToast(user ? "Cloud & local reading progress permanently cleared 🧹" : "Reading progress cleared 🧹");
  }, [user, refreshStats, showToast]);

  const clearAnnotations = useCallback(async () => {
    cancelAllPendingSyncTimers();
    if (user?.uid) {
      try {
        await deleteCloudAnnotations(user.uid);
      } catch (err) {
        showToast("Failed to reset cloud annotations. Please try again.");
        return;
      }
    }
    purgeAllAnnotations();
    setAnnotationsState({});
    refreshStats();
    showToast(user ? "Cloud & local annotations permanently cleared 🧹" : "All annotations cleared 🧹");
  }, [user, refreshStats, showToast]);

  const clearStreak = useCallback(async () => {
    cancelAllPendingSyncTimers();
    if (user?.uid) {
      try {
        await deleteCloudReadingActivity(user.uid);
      } catch (err) {
        showToast("Failed to reset cloud reading streak. Please try again.");
        return;
      }
    }
    purgeStreakData(user?.uid);
    const emptyStreak: ReadingStreakData = {
      daily: {},
      currentStreak: 0,
      longestStreak: 0,
      lastQualifiedDate: null,
    };
    setStreakData(emptyStreak);
    refreshStats(undefined, undefined, emptyStreak);
    showToast(user ? "Cloud & local reading streak reset 🪔" : "Reading streak reset 🪔");
  }, [user, refreshStats, showToast]);

  const clearOfflineStorage = useCallback(async () => {
    await purgeAllOfflineBooks();
    showToast("Offline book cache cleared 📦");
  }, [showToast]);

  const clearLocalDeviceCache = useCallback(async () => {
    await purgeFactoryResetAll();
    showToast("Local device cache cleared. Cloud data will restore on reload 📱");
  }, [showToast]);

  const factoryReset = useCallback(
    async (mode: "local_cache" | "permanent_cloud" = "permanent_cloud") => {
      if (mode === "local_cache") {
        await purgeFactoryResetAll();
        showToast("Local device cache cleared. Cloud data will restore on reload 📱");
        return;
      }

      cancelAllPendingSyncTimers();

      if (user?.uid) {
        try {
          await permanentFactoryResetCloudData(user.uid);
        } catch (err) {
          showToast("Failed to reset cloud account data. Please check your connection.");
          return;
        }
        clearAllUserDataForUid(user.uid);
        try {
          localStorage.removeItem(`reader_social_profile_${user.uid}`);
        } catch {}
      } else {
        await purgeFactoryResetAll();
      }

      clearShelfDismissals(user?.uid);
      clearAllCollections(user?.uid);
      clearAllReflections(user?.uid);
      clearStoredReadingHistory(user?.uid);
      clearStoredFavorites(user?.uid);
      purgeStreakData(user?.uid);

      setCollections([]);
      setReflections({});
      setShelfDismissals({});
      setFavorites([]);
      setReadingHistory([]);
      setReadingMemories({});
      setAnnotationsState({});
      const emptyStreak: ReadingStreakData = {
        daily: {},
        currentStreak: 0,
        longestStreak: 0,
        lastQualifiedDate: null,
      };
      setStreakData(emptyStreak);
      setActiveTimeState({ totalActiveSeconds: 0, todayActiveSeconds: 0 });
      setActiveTimeData({
        totalActiveSeconds: 0,
        daily: {},
        explorationDaily: {},
        totalExplorationSeconds: 0,
        lastUpdated: Date.now(),
      });
      refreshStats([], [], emptyStreak, { totalActiveSeconds: 0, daily: {}, lastUpdated: Date.now() });
      showToast(
        user ? "All cloud & local reading data permanently reset ✨" : "All local data reset to defaults ✨"
      );
    },
    [user, refreshStats, showToast]
  );

  const recordWebsiteActiveTime = useCallback((seconds: number) => {
    const targetUid = user?.uid;
    const res = addWebsiteActiveSeconds(seconds, targetUid);
    setActiveTimeState(res);
    const actTime = getWebsiteActiveTimeData(targetUid);
    activeTimeDataRef.current = actTime;
    setActiveTimeData(actTime);
    if (user) {
      syncActiveTimeToCloud(user.uid, actTime);
    }
    return res;
  }, [user]);

  const addBookReadingTime = useCallback((bookId: string, seconds: number) => {
    const targetUid = user?.uid;
    const mem = addBookReadingSeconds(bookId, seconds, undefined, undefined, targetUid);
    if (user && mem) {
      syncReadingMemoryToCloud(user.uid, bookId, mem);
    }
    return mem;
  }, [user]);

  // Derive actual book objects (memoized so the context value stays stable between unrelated renders)
  const favoriteBooks = useMemo(
    () =>
      mounted
        ? favorites
            .map((id) => BOOKS_BY_ID.get(id))
            .filter((b): b is Book => Boolean(b))
        : [],
    [mounted, favorites]
  );

  const recentBooks: RecentBook[] = useMemo(
    () =>
      mounted
        ? (readingHistory
            .map((item) => {
              const book = BOOKS_BY_ID.get(item.bookId);
              if (!book) return null;
              return {
                ...book,
                progress: item.progress,
                lastPage: item.page,
              };
            })
            .filter(Boolean) as RecentBook[])
        : [],
    [mounted, readingHistory]
  );

  const todayKey = getLocalDateKey();
  const todaySeconds = streakData.daily[todayKey]?.seconds || 0;
  const isTodayQualified = Boolean(streakData.daily[todayKey]?.qualified || todaySeconds >= DAILY_READING_GOAL_SECONDS);

  const globalReadingSeconds = useMemo(() => {
    let total = 0;
    Object.values(streakData.daily || {}).forEach((d) => {
      total += d.seconds || 0;
    });
    return total;
  }, [streakData]);

  const openCertificateModal = useCallback((cert: BookCompletionCertificate) => {
    setIsNewCertificate(false);
    setActiveCertificate(cert);
  }, []);

  const closeCertificateModal = useCallback(() => {
    setActiveCertificate(null);
  }, []);

  const getCertificateForBookHandler = useCallback((bookId: string) => {
    return getStoredBookCertificate(bookId, user?.uid);
  }, [user?.uid]);

  const contextValue = useMemo<LibraryContextType>(
    () => ({
      user,
      favorites,
      isFavorite,
      toggleFavorite,
      removeFavorite,
      favoriteBooks,
      readingHistory,
      recentBooks,
      recordReading,
      updateReadingProgress,
      getReadingProgress,
      removeHistoryItem,
      clearHistory,
      toastMessage,
      showToast,
      shelfDismissals,
      dismissFromShelf,
      restoreToShelf,
      isDismissedFromShelf,
      collections,
      createCollection,
      updateCollection,
      deleteCollection,
      addBookToCollection,
      removeBookFromCollection,
      getCollectionsForBook: getCollectionsForBookHandler,
      reflections,
      getReflection,
      saveReflection,
      removeReflection,
      getBookmarks,
      addBookmark,
      removeBookmark,
      isBookmarked,
      stats,
      refreshStats,
      exportData,
      importData: handleImportData,
      globalActiveSeconds: activeTimeState.totalActiveSeconds,
      todayActiveSeconds: activeTimeState.todayActiveSeconds,
      globalReadingSeconds,
      activeTimeData,
      recordWebsiteActiveTime,
      addBookReadingTime,
      streakData,
      todayReadingSeconds: todaySeconds,
      isTodayQualified,
      recordActiveReading,
      getReadingMemory,
      readingMemories,
      annotations,
      recordSessionEvent,
      activeSession,
      startReadingSession,
      endReadingSession,
      checkOfflineStatus,
      saveBookOffline,
      removeBookOffline,
      clearAllProgress,
      clearAnnotations,
      clearStreak,
      clearOfflineStorage,
      clearLocalDeviceCache,
      factoryReset,
      activeCertificate,
      openCertificateModal,
      closeCertificateModal,
      getCertificateForBook: getCertificateForBookHandler,
    }),
    [
      user,
      favorites,
      isFavorite,
      toggleFavorite,
      removeFavorite,
      favoriteBooks,
      readingHistory,
      recentBooks,
      recordReading,
      updateReadingProgress,
      getReadingProgress,
      removeHistoryItem,
      clearHistory,
      toastMessage,
      showToast,
      shelfDismissals,
      dismissFromShelf,
      restoreToShelf,
      isDismissedFromShelf,
      collections,
      createCollection,
      updateCollection,
      deleteCollection,
      addBookToCollection,
      removeBookFromCollection,
      getCollectionsForBookHandler,
      reflections,
      getReflection,
      saveReflection,
      removeReflection,
      getBookmarks,
      addBookmark,
      removeBookmark,
      isBookmarked,
      stats,
      refreshStats,
      exportData,
      handleImportData,
      activeTimeState.totalActiveSeconds,
      activeTimeState.todayActiveSeconds,
      globalReadingSeconds,
      activeTimeData,
      recordWebsiteActiveTime,
      addBookReadingTime,
      streakData,
      todaySeconds,
      isTodayQualified,
      recordActiveReading,
      getReadingMemory,
      readingMemories,
      annotations,
      recordSessionEvent,
      activeSession,
      startReadingSession,
      endReadingSession,
      checkOfflineStatus,
      saveBookOffline,
      removeBookOffline,
      clearAllProgress,
      clearAnnotations,
      clearStreak,
      clearOfflineStorage,
      clearLocalDeviceCache,
      factoryReset,
      activeCertificate,
      openCertificateModal,
      closeCertificateModal,
      getCertificateForBookHandler,
    ]
  );

  return (
    <LibraryContext.Provider value={contextValue}>
      {children}
      <CompletionCertificateModal
        certificate={activeCertificate}
        isOpen={Boolean(activeCertificate)}
        onClose={closeCertificateModal}
        isNewUnlock={isNewCertificate}
      />
    </LibraryContext.Provider>
  );
}

export function useLibrary() {
  const context = useContext(LibraryContext);
  if (!context) {
    throw new Error("useLibrary must be used within a LibraryProvider");
  }
  return context;
}
