/**
 * Reader's HUB — Centralized Reader Storage Utility (Optimized & In-Memory Cached)
 * Namespaced browser-local persistence for Reading Progress, Bookmarks, Highlights, Notes, Study Annotations, Daily Reading Streak (Diwali Diya), Reading Memory, and Offline Cache.
 */

import { BOOKS, getBookById } from "@/data/books";
import { getVerifiedPageCount } from "./book-pages";
import {
  isSafeBookId,
  mergeAnnotations,
  mergeBookmarkLists,
  mergeProgressItems,
  normalizeProgressItem,
  mergeReadingMemory,
} from "./reading-merge";

export interface BookmarkItem {
  id: string;
  bookId: string;
  page: number;
  label?: string;
  createdAt: number;
}

export interface HighlightItem {
  id: string;
  bookId: string;
  page: number;
  text: string;
  color: "amber" | "mint" | "cyan" | "purple";
  rects?: { x: number; y: number; width: number; height: number }[];
  createdAt: number;
}

export interface NoteItem {
  id: string;
  bookId: string;
  page: number;
  selectedText?: string;
  note: string;
  color?: string;
  createdAt: number;
  updatedAt: number;
}

export interface DrawingPoint {
  x: number; // Normalized 0-1 coordinate
  y: number; // Normalized 0-1 coordinate
}

export type AnnotationToolType =
  | "pen"
  | "highlighter"
  | "line"
  | "arrow"
  | "circle"
  | "rectangle"
  | "square"
  | "diamond"
  | "text";

export interface DrawingStroke {
  id: string;
  type?: AnnotationToolType;
  points: DrawingPoint[];
  color: string;
  width: number;
  opacity?: number;
  fill?: boolean;
  text?: string;
  fontSize?: number;
}

export interface BookAnnotations {
  highlights: HighlightItem[];
  notes: NoteItem[];
  drawings: Record<number, DrawingStroke[]>; // pageNumber -> strokes/shapes
  bookmarks?: BookmarkItem[];
}

export interface ReadingProgressData {
  bookId: string;
  page: number;
  totalPages: number;
  progress: number;
  lastReadAt: number;
}

export interface DailyReadingActivity {
  seconds: number; // Accumulated active reading time in seconds
  qualified: boolean; // true if >= 15 * 60 seconds (900 seconds)
  lastUpdated: number;
}

export interface ReadingStreakData {
  daily: Record<string, DailyReadingActivity>; // "YYYY-MM-DD" -> activity
  currentStreak: number;
  longestStreak: number;
  lastQualifiedDate: string | null;
}

export interface ReadingTimelineEvent {
  id: string;
  bookId: string;
  timestamp: number;
  startPage: number;
  endPage: number;
  durationSeconds: number;
  highlightsAdded: number;
  notesAdded: number;
  bookmarksAdded: number;
}

export interface BookReadingMemory {
  bookId: string;
  totalSeconds: number;
  sessionsCount: number;
  firstReadAt: number;
  lastReadAt: number;
  timeline: ReadingTimelineEvent[];
}

export interface WebsiteActiveTimeData {
  totalActiveSeconds: number; // Global cumulative active website usage (Reading + Exploration)
  daily: Record<string, number>; // "YYYY-MM-DD" -> total active seconds on that day
  explorationDaily?: Record<string, number>; // "YYYY-MM-DD" -> exploration / browsing seconds
  totalExplorationSeconds?: number;
  lastUpdated: number;
}

export interface ReadingStats {
  booksStarted: number;
  booksCompleted: number;
  pagesRead: number;
  totalFavorites: number;
  totalBookmarks: number;
  totalNotes: number;
  totalHighlights: number;
  totalDrawings: number;
  readingStreakDays: number;
  todayReadingSeconds: number;
  isTodayQualified: boolean;
  totalReadingSeconds: number; // Genuine reading time across all books
  totalActiveSeconds: number;  // Meaningful website engagement time
  todayActiveSeconds: number;  // Today's website engagement time
  completedBookIds?: string[]; // Authoritative list of genuinely completed book IDs
}

export interface ReaderHubExportData {
  version: string;
  exportedAt: number;
  favorites: string[];
  readingHistory: ReadingProgressItem[];
  annotations: Record<string, BookAnnotations>;
  bookmarks: Record<string, BookmarkItem[]>;
  readingActivity?: ReadingStreakData;
  readingMemories?: Record<string, BookReadingMemory>;
  activeTime?: WebsiteActiveTimeData;
  preferences?: any;
}

export interface ReadingProgressItem {
  bookId: string;
  page: number;
  totalPages: number;
  progress: number;
  lastReadAt: number;
}

const PROGRESS_KEY_PREFIX = "readershub:progress:v1";
const ANNOTATIONS_KEY_PREFIX = "readershub:annotations:v1";
const BOOKMARKS_KEY_PREFIX = "readershub:bookmarks:v1";
const MEMORY_KEY_PREFIX = "readershub:memory:v1";
const ACTIVITY_KEY = "readershub:reading-activity:v1";
const ACTIVE_TIME_KEY = "readershub:active-time:v1";

let activeUserUid: string | null = null;

export function setActiveUserUid(uid: string | null): void {
  activeUserUid = uid ? uid.trim() : null;
}

export function getActiveUserUid(): string | null {
  return activeUserUid;
}

export function getActivityStorageKey(uid?: string | null): string {
  const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
  return targetUid ? `readershub:reading-activity:v1:${targetUid}` : "readershub:reading-activity:v1:guest";
}

export function getActiveTimeStorageKey(uid?: string | null): string {
  const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
  return targetUid ? `readershub:active-time:v1:${targetUid}` : "readershub:active-time:v1:guest";
}
export const FAVORITES_KEY = "readers_hub_favorites_v2";
export const HISTORY_KEY = "readers_hub_reading_progress_v2";
const OFFLINE_CACHE_NAME = "readershub-offline-books-v1";
export const SHELF_DISMISSALS_KEY = "readershub:shelf-dismissals:v1";

export function getShelfDismissalsStorageKey(uid?: string | null): string {
  const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
  return targetUid ? `readershub:shelf-dismissals:v1:${targetUid}` : "readershub:shelf-dismissals:v1:guest";
}

export function getFavoritesStorageKey(uid?: string | null): string {
  const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
  return targetUid ? `readershub:favorites:v1:${targetUid}` : FAVORITES_KEY;
}

export function getHistoryStorageKey(uid?: string | null): string {
  const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
  return targetUid ? `readershub:history:v1:${targetUid}` : HISTORY_KEY;
}

export function getProgressStorageKey(bookId: string, uid?: string | null): string {
  const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
  return targetUid ? `readershub:progress:v1:${targetUid}:${bookId}` : `readershub:progress:v1:guest:${bookId}`;
}

export function getAnnotationsStorageKey(bookId: string, uid?: string | null): string {
  const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
  return targetUid ? `readershub:annotations:v1:${targetUid}:${bookId}` : `readershub:annotations:v1:guest:${bookId}`;
}

export function getBookmarksStorageKey(bookId: string, uid?: string | null): string {
  const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
  return targetUid ? `readershub:bookmarks:v1:${targetUid}:${bookId}` : `readershub:bookmarks:v1:guest:${bookId}`;
}

export function getStoredFavorites(uid?: string | null): string[] {
  if (typeof window === "undefined") return [];
  try {
    const key = getFavoritesStorageKey(uid);
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
    // Signed-in readers never inherit guest data implicitly; migrateGuestDataToUser() handles that at login
    const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
    if (targetUid) return [];
    const legacy = localStorage.getItem("readershub:favorites:v1:guest");
    if (legacy) {
      const parsed = JSON.parse(legacy);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
    return [];
  } catch {
    return [];
  }
}

export function saveStoredFavorites(favs: string[], uid?: string | null): void {
  if (typeof window === "undefined") return;
  try {
    const key = getFavoritesStorageKey(uid);
    localStorage.setItem(key, JSON.stringify(favs));
    const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
    if (!targetUid) {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs));
    }
  } catch (e) {
    console.warn("[ReaderStorage] Failed to save favorites:", e);
  }
}

// Saved records are read through the verified page count of each PDF (old records may carry a wrong
// denominator such as a 100-page default). Read-only: the corrected value is saved on the next progress write.
const normalizeHistory = (list: unknown[]): ReadingProgressItem[] =>
  list.filter((h): h is ReadingProgressItem => Boolean(h && typeof h === "object" && (h as ReadingProgressItem).bookId)).map((h) => normalizeProgressItem(h).item);

export function getStoredReadingHistory(uid?: string | null): ReadingProgressItem[] {
  if (typeof window === "undefined") return [];
  try {
    const key = getHistoryStorageKey(uid);
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return normalizeHistory(parsed);
    }
    // Signed-in readers never inherit guest data implicitly; migrateGuestDataToUser() handles that at login
    const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
    if (targetUid) return [];
    const legacy = localStorage.getItem("readershub:history:v1:guest");
    if (legacy) {
      const parsed = JSON.parse(legacy);
      if (Array.isArray(parsed) && parsed.length > 0) return normalizeHistory(parsed);
    }
    return [];
  } catch {
    return [];
  }
}

export function saveStoredReadingHistory(history: ReadingProgressItem[], uid?: string | null): void {
  if (typeof window === "undefined") return;
  try {
    const key = getHistoryStorageKey(uid);
    localStorage.setItem(key, JSON.stringify(history));
    const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
    if (!targetUid) {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    }
  } catch (e) {
    console.warn("[ReaderStorage] Failed to save reading history:", e);
  }
}

export type ShelfSectionKey = "reading" | "completed" | "offline" | "memory" | "favorites" | "spotlight";
export type ShelfDismissalsMap = Record<string, Record<string, boolean>>;

// High-speed in-memory caches to reduce redundant JSON parsing & LocalStorage overhead
const progressCache = new Map<string, ReadingProgressData>();
const annotationsCache = new Map<string, BookAnnotations>();
const bookmarksCache = new Map<string, BookmarkItem[]>();
const memoryCache = new Map<string, BookReadingMemory>();
let activeTimeCache: WebsiteActiveTimeData | null = null;
const shelfDismissalsCache = new Map<string, ShelfDismissalsMap>();

export function getShelfDismissals(uid?: string | null): ShelfDismissalsMap {
  if (typeof window === "undefined") return {};
  const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
  const cacheKey = targetUid || "guest";
  if (shelfDismissalsCache.has(cacheKey)) return shelfDismissalsCache.get(cacheKey)!;
  try {
    const key = getShelfDismissalsStorageKey(targetUid);
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      shelfDismissalsCache.set(cacheKey, parsed || {});
      return parsed || {};
    }
    if (!targetUid) {
      const legacy = localStorage.getItem(SHELF_DISMISSALS_KEY);
      if (legacy) {
        const parsed = JSON.parse(legacy);
        shelfDismissalsCache.set(cacheKey, parsed || {});
        return parsed || {};
      }
    }
    shelfDismissalsCache.set(cacheKey, {});
    return {};
  } catch {
    return {};
  }
}

export function dismissBookFromShelf(section: ShelfSectionKey, bookId: string, uid?: string | null): void {
  if (typeof window === "undefined" || !bookId) return;
  try {
    const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
    const cacheKey = targetUid || "guest";
    const current = { ...getShelfDismissals(targetUid) };
    if (!current[section]) {
      current[section] = {};
    } else {
      current[section] = { ...current[section] };
    }
    current[section][bookId] = true;
    shelfDismissalsCache.set(cacheKey, current);
    const key = getShelfDismissalsStorageKey(targetUid);
    localStorage.setItem(key, JSON.stringify(current));
    if (!targetUid) {
      localStorage.setItem(SHELF_DISMISSALS_KEY, JSON.stringify(current));
    }
  } catch (e) {
    console.warn("[ReaderStorage] Failed to dismiss book from shelf:", e);
  }
}

export function restoreBookToShelf(section: ShelfSectionKey, bookId: string, uid?: string | null): void {
  if (typeof window === "undefined" || !bookId) return;
  try {
    const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
    const cacheKey = targetUid || "guest";
    const current = { ...getShelfDismissals(targetUid) };
    if (current[section] && current[section][bookId]) {
      current[section] = { ...current[section] };
      delete current[section][bookId];
      shelfDismissalsCache.set(cacheKey, current);
      const key = getShelfDismissalsStorageKey(targetUid);
      localStorage.setItem(key, JSON.stringify(current));
      if (!targetUid) {
        localStorage.setItem(SHELF_DISMISSALS_KEY, JSON.stringify(current));
      }
    }
  } catch (e) {
    console.warn("[ReaderStorage] Failed to restore book to shelf:", e);
  }
}

export function isBookDismissedFromShelf(section: ShelfSectionKey, bookId: string, uid?: string | null): boolean {
  if (typeof window === "undefined" || !bookId) return false;
  const dismissals = getShelfDismissals(uid);
  return Boolean(dismissals[section]?.[bookId]);
}

export function clearShelfDismissals(uid?: string | null): void {
  if (typeof window === "undefined") return;
  const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
  const cacheKey = targetUid || "guest";
  shelfDismissalsCache.delete(cacheKey);
  try {
    const key = getShelfDismissalsStorageKey(targetUid);
    localStorage.removeItem(key);
    if (!targetUid) {
      localStorage.removeItem(SHELF_DISMISSALS_KEY);
    }
  } catch {}
}

// ---------------------------------------------------------------------------
// 2.7 Smart Reading Collections (Isolated Namespace: readershub:collections:v1)
// ---------------------------------------------------------------------------
export const COLLECTIONS_KEY = "readershub:collections:v1";

export function getCollectionsStorageKey(uid?: string | null): string {
  const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
  return targetUid ? `readershub:collections:v1:${targetUid}` : "readershub:collections:v1:guest";
}

export interface ReadingCollection {
  id: string;
  name: string;
  description?: string;
  color?: string;
  bookIds: string[];
  createdAt: number;
  updatedAt: number;
}

const collectionsCache = new Map<string, ReadingCollection[]>();

export function getReadingCollections(uid?: string | null): ReadingCollection[] {
  if (typeof window === "undefined") return [];
  const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
  const cacheKey = targetUid || "guest";
  if (collectionsCache.has(cacheKey)) return collectionsCache.get(cacheKey)!;
  try {
    const key = getCollectionsStorageKey(targetUid);
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      const res = Array.isArray(parsed) ? parsed : [];
      collectionsCache.set(cacheKey, res);
      return res;
    }
    if (!targetUid) {
      const legacy = localStorage.getItem(COLLECTIONS_KEY);
      if (legacy) {
        const parsed = JSON.parse(legacy);
        const res = Array.isArray(parsed) ? parsed : [];
        collectionsCache.set(cacheKey, res);
        return res;
      }
    }
    collectionsCache.set(cacheKey, []);
    return [];
  } catch {
    return [];
  }
}

export function saveReadingCollections(collections: ReadingCollection[], uid?: string | null): void {
  if (typeof window === "undefined") return;
  const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
  const cacheKey = targetUid || "guest";
  collectionsCache.set(cacheKey, collections);
  try {
    const key = getCollectionsStorageKey(targetUid);
    localStorage.setItem(key, JSON.stringify(collections));
    if (!targetUid) {
      localStorage.setItem(COLLECTIONS_KEY, JSON.stringify(collections));
    }
  } catch (e) {
    console.warn("[ReaderStorage] Failed to save collections:", e);
  }
}

export function createReadingCollection(
  name: string,
  description?: string,
  color?: string,
  uid?: string | null
): ReadingCollection {
  const collections = [...getReadingCollections(uid)];
  const id = `col-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const newCol: ReadingCollection = {
    id,
    name: name.trim() || "Untitled Collection",
    description: description?.trim() || "",
    color: color || "emerald",
    bookIds: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  collections.unshift(newCol);
  saveReadingCollections(collections, uid);
  return newCol;
}

export function updateReadingCollection(
  id: string,
  updates: Partial<Pick<ReadingCollection, "name" | "description" | "color">>,
  uid?: string | null
): ReadingCollection | null {
  const collections = [...getReadingCollections(uid)];
  const idx = collections.findIndex((c) => c.id === id);
  if (idx === -1) return null;
  const updated: ReadingCollection = {
    ...collections[idx],
    ...updates,
    updatedAt: Date.now(),
  };
  collections[idx] = updated;
  saveReadingCollections(collections, uid);
  return updated;
}

export function deleteReadingCollection(id: string, uid?: string | null): void {
  const collections = getReadingCollections(uid).filter((c) => c.id !== id);
  saveReadingCollections(collections, uid);
}

export function addBookToCollection(collectionId: string, bookId: string, uid?: string | null): void {
  if (!bookId) return;
  const collections = [...getReadingCollections(uid)];
  const col = collections.find((c) => c.id === collectionId);
  if (!col) return;
  if (!col.bookIds.includes(bookId)) {
    col.bookIds = [...col.bookIds, bookId];
    col.updatedAt = Date.now();
    saveReadingCollections(collections, uid);
  }
}

export function removeBookFromCollection(collectionId: string, bookId: string, uid?: string | null): void {
  if (!bookId) return;
  const collections = [...getReadingCollections(uid)];
  const col = collections.find((c) => c.id === collectionId);
  if (!col) return;
  if (col.bookIds.includes(bookId)) {
    col.bookIds = col.bookIds.filter((id) => id !== bookId);
    col.updatedAt = Date.now();
    saveReadingCollections(collections, uid);
  }
}

export function getCollectionsForBook(bookId: string, uid?: string | null): ReadingCollection[] {
  if (!bookId) return [];
  return getReadingCollections(uid).filter((c) => c.bookIds.includes(bookId));
}

export function clearAllCollections(uid?: string | null): void {
  if (typeof window === "undefined") return;
  const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
  const cacheKey = targetUid || "guest";
  collectionsCache.delete(cacheKey);
  try {
    const key = getCollectionsStorageKey(targetUid);
    localStorage.removeItem(key);
    if (!targetUid) {
      localStorage.removeItem(COLLECTIONS_KEY);
    }
  } catch {}
}

// ---------------------------------------------------------------------------
// 2.8 Post-Completion Reflections (Isolated Namespace: readershub:reflections:v1)
// ---------------------------------------------------------------------------
export const REFLECTIONS_KEY = "readershub:reflections:v1";

export function getReflectionsStorageKey(uid?: string | null): string {
  const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
  return targetUid ? `readershub:reflections:v1:${targetUid}` : "readershub:reflections:v1:guest";
}

export interface BookReflection {
  bookId: string;
  reflection: string;
  completedAt: number;
  rating?: number;
}

const reflectionsCache = new Map<string, Record<string, BookReflection>>();

export function getBookReflections(uid?: string | null): Record<string, BookReflection> {
  if (typeof window === "undefined") return {};
  const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
  const cacheKey = targetUid || "guest";
  if (reflectionsCache.has(cacheKey)) return reflectionsCache.get(cacheKey)!;
  try {
    const key = getReflectionsStorageKey(targetUid);
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      const res = parsed || {};
      reflectionsCache.set(cacheKey, res);
      return res;
    }
    if (!targetUid) {
      const legacy = localStorage.getItem(REFLECTIONS_KEY);
      if (legacy) {
        const parsed = JSON.parse(legacy);
        const res = parsed || {};
        reflectionsCache.set(cacheKey, res);
        return res;
      }
    }
    reflectionsCache.set(cacheKey, {});
    return {};
  } catch {
    return {};
  }
}

export function getBookReflection(bookId: string, uid?: string | null): BookReflection | null {
  if (!bookId) return null;
  const all = getBookReflections(uid);
  return all[bookId] || null;
}

export function saveBookReflection(
  bookId: string,
  reflection: string,
  rating?: number,
  uid?: string | null
): void {
  if (typeof window === "undefined" || !bookId) return;
  try {
    const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
    const cacheKey = targetUid || "guest";
    const current = { ...getBookReflections(targetUid) };
    current[bookId] = {
      bookId,
      reflection: reflection.trim(),
      completedAt: Date.now(),
      rating,
    };
    reflectionsCache.set(cacheKey, current);
    const key = getReflectionsStorageKey(targetUid);
    localStorage.setItem(key, JSON.stringify(current));
    if (!targetUid) {
      localStorage.setItem(REFLECTIONS_KEY, JSON.stringify(current));
    }
  } catch (e) {
    console.warn("[ReaderStorage] Failed to save reflection:", e);
  }
}

export function removeBookReflection(bookId: string, uid?: string | null): void {
  if (typeof window === "undefined" || !bookId) return;
  try {
    const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
    const cacheKey = targetUid || "guest";
    const current = { ...getBookReflections(targetUid) };
    if (current[bookId]) {
      delete current[bookId];
      reflectionsCache.set(cacheKey, current);
      const key = getReflectionsStorageKey(targetUid);
      localStorage.setItem(key, JSON.stringify(current));
      if (!targetUid) {
        localStorage.setItem(REFLECTIONS_KEY, JSON.stringify(current));
      }
    }
  } catch (e) {
    console.warn("[ReaderStorage] Failed to remove reflection:", e);
  }
}

export function clearAllReflections(uid?: string | null): void {
  if (typeof window === "undefined") return;
  const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
  const cacheKey = targetUid || "guest";
  reflectionsCache.delete(cacheKey);
  try {
    const key = getReflectionsStorageKey(targetUid);
    localStorage.removeItem(key);
    if (!targetUid) {
      localStorage.removeItem(REFLECTIONS_KEY);
    }
  } catch {}
}

export const DAILY_READING_GOAL_SECONDS = 15 * 60; // 15 minutes = 900 seconds

// -------------------------------------------------------------
// Date Utility (Local Calendar Date)
// -------------------------------------------------------------

export function getLocalDateKey(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getPreviousDateKey(dateKey: string): string {
  const parts = dateKey.split("-").map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  d.setDate(d.getDate() - 1);
  return getLocalDateKey(d);
}

// -------------------------------------------------------------
// Daily Reading Streak Logic (Diwali Diya)
// -------------------------------------------------------------

export function calculateStreak(dailyMap: Record<string, DailyReadingActivity>): {
  currentStreak: number;
  longestStreak: number;
  lastQualifiedDate: string | null;
} {
  const todayKey = getLocalDateKey();
  const yesterdayKey = getPreviousDateKey(todayKey);

  const isTodayQualified = Boolean(dailyMap[todayKey]?.qualified || (dailyMap[todayKey]?.seconds || 0) >= DAILY_READING_GOAL_SECONDS);
  const isYesterdayQualified = Boolean(dailyMap[yesterdayKey]?.qualified || (dailyMap[yesterdayKey]?.seconds || 0) >= DAILY_READING_GOAL_SECONDS);

  let currentStreak = 0;
  let lastQualifiedDate: string | null = null;

  if (isTodayQualified) {
    currentStreak = 1;
    lastQualifiedDate = todayKey;
    let checkKey = yesterdayKey;
    while (dailyMap[checkKey]?.qualified || (dailyMap[checkKey]?.seconds || 0) >= DAILY_READING_GOAL_SECONDS) {
      currentStreak += 1;
      checkKey = getPreviousDateKey(checkKey);
    }
  } else if (isYesterdayQualified) {
    currentStreak = 1;
    lastQualifiedDate = yesterdayKey;
    let checkKey = getPreviousDateKey(yesterdayKey);
    while (dailyMap[checkKey]?.qualified || (dailyMap[checkKey]?.seconds || 0) >= DAILY_READING_GOAL_SECONDS) {
      currentStreak += 1;
      checkKey = getPreviousDateKey(checkKey);
    }
  }

  // Calculate longest streak across all recorded history
  const sortedDates = Object.keys(dailyMap)
    .filter((k) => dailyMap[k]?.qualified || (dailyMap[k]?.seconds || 0) >= DAILY_READING_GOAL_SECONDS)
    .sort();

  let longestStreak = currentStreak;
  let tempStreak = 0;
  let prevDate: string | null = null;

  for (const dateKey of sortedDates) {
    if (!prevDate) {
      tempStreak = 1;
    } else {
      const expectedPrev = getPreviousDateKey(dateKey);
      if (prevDate === expectedPrev) {
        tempStreak += 1;
      } else {
        tempStreak = 1;
      }
    }
    prevDate = dateKey;
    if (tempStreak > longestStreak) {
      longestStreak = tempStreak;
    }
  }

  return { currentStreak, longestStreak, lastQualifiedDate };
}

export function getReadingActivityData(uid?: string | null): ReadingStreakData {
  const defaultData: ReadingStreakData = {
    daily: {},
    currentStreak: 0,
    longestStreak: 0,
    lastQualifiedDate: null,
  };

  if (typeof window === "undefined") return defaultData;

  const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
  const userKey = getActivityStorageKey(targetUid);

  try {
    let raw = localStorage.getItem(userKey);

    if (!raw && !targetUid) {
      raw = localStorage.getItem(ACTIVITY_KEY);
    }

    if (raw) {
      const parsed = JSON.parse(raw);
      const daily = parsed.daily && typeof parsed.daily === "object" ? parsed.daily : {};
      const { currentStreak, longestStreak, lastQualifiedDate } = calculateStreak(daily);
      return {
        daily,
        currentStreak,
        longestStreak: Math.max(longestStreak, parsed.longestStreak || 0),
        lastQualifiedDate,
      };
    }
  } catch (e) {
    console.warn("[ReaderStorage] Error reading reading activity:", e);
  }

  return defaultData;
}

export function saveReadingActivityData(data: ReadingStreakData, uid?: string | null): void {
  if (typeof window === "undefined") return;
  try {
    const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
    const userKey = getActivityStorageKey(targetUid);
    localStorage.setItem(userKey, JSON.stringify(data));
  } catch (e) {
    console.warn("[ReaderStorage] Error saving reading activity:", e);
  }
}

export function addActiveReadingTime(secondsToAdd: number, uid?: string | null): {
  todaySeconds: number;
  qualified: boolean;
  justQualified: boolean;
  currentStreak: number;
} {
  if (typeof window === "undefined" || secondsToAdd <= 0) {
    return { todaySeconds: 0, qualified: false, justQualified: false, currentStreak: 0 };
  }

  const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
  const currentData = getReadingActivityData(targetUid);
  const todayKey = getLocalDateKey();
  const todayEntry = currentData.daily[todayKey] || {
    seconds: 0,
    qualified: false,
    lastUpdated: Date.now(),
  };

  const prevSeconds = todayEntry.seconds;
  const wasQualified = todayEntry.qualified || prevSeconds >= DAILY_READING_GOAL_SECONDS;

  const newSeconds = prevSeconds + secondsToAdd;
  const isQualified = newSeconds >= DAILY_READING_GOAL_SECONDS;
  const justQualified = !wasQualified && isQualified;

  todayEntry.seconds = newSeconds;
  todayEntry.qualified = isQualified;
  todayEntry.lastUpdated = Date.now();

  currentData.daily[todayKey] = todayEntry;

  const { currentStreak, longestStreak, lastQualifiedDate } = calculateStreak(currentData.daily);
  currentData.currentStreak = currentStreak;
  currentData.longestStreak = Math.max(longestStreak, currentData.longestStreak || 0);
  currentData.lastQualifiedDate = lastQualifiedDate;

  saveReadingActivityData(currentData, targetUid);

  // Invalidate activeTimeCache so next getWebsiteActiveTimeData() reflects the updated reading seconds
  activeTimeCache = null;

  return {
    todaySeconds: newSeconds,
    qualified: isQualified,
    justQualified,
    currentStreak,
  };
}

// -------------------------------------------------------------
// Website-Wide Active Time Tracking (Meaningful Site Engagement)
// -------------------------------------------------------------

export function getWebsiteActiveTimeData(uid?: string | null): WebsiteActiveTimeData {
  const defaultData: WebsiteActiveTimeData = {
    totalActiveSeconds: 0,
    daily: {},
    explorationDaily: {},
    totalExplorationSeconds: 0,
    lastUpdated: Date.now(),
  };

  if (typeof window === "undefined") return defaultData;

  const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
  const userKey = getActiveTimeStorageKey(targetUid);

  let explorationDaily: Record<string, number> = {};
  let totalExplorationSeconds = 0;
  let lastUpdated = Date.now();

  try {
    let raw = localStorage.getItem(userKey);

    if (!raw && !targetUid) {
      const legacy = localStorage.getItem(ACTIVE_TIME_KEY);
      if (legacy) {
        try {
          const parsedLegacy = JSON.parse(legacy);
          if (parsedLegacy?.totalActiveSeconds > 0) {
            raw = legacy;
            localStorage.setItem(userKey, legacy);
          }
        } catch {}
      }
    }

    if (raw) {
      const parsed = JSON.parse(raw);
      lastUpdated = Number(parsed.lastUpdated) || Date.now();
      if (parsed.explorationDaily && typeof parsed.explorationDaily === "object") {
        explorationDaily = { ...parsed.explorationDaily };
        totalExplorationSeconds = Number(parsed.totalExplorationSeconds) || 0;
      } else if (parsed.daily && typeof parsed.daily === "object") {
        // Legacy storage conversion: derive exploration seconds from stored active minus reading
        const streakData = getReadingActivityData(targetUid);
        Object.entries(parsed.daily).forEach(([dKey, activeSecs]) => {
          const readSecs = streakData.daily[dKey]?.seconds || 0;
          const expl = Math.max(0, Number(activeSecs) - readSecs);
          if (expl > 0) explorationDaily[dKey] = expl;
        });
        totalExplorationSeconds = Object.values(explorationDaily).reduce((a, b) => a + b, 0);
      }
    }
  } catch (e) {
    console.warn("[ReaderStorage] Error reading website active time:", e);
  }

  // Calculate Total & Daily Active Time dynamically:
  // ACTIVE TIME = READING TIME + WEBSITE EXPLORATION TIME
  const streakData = getReadingActivityData(targetUid);
  let totalReadingSecs = 0;
  const activeDaily: Record<string, number> = {};

  // Include all days with reading
  Object.entries(streakData.daily || {}).forEach(([dKey, dVal]) => {
    const rSecs = dVal?.seconds || 0;
    totalReadingSecs += rSecs;
    const explSecs = explorationDaily[dKey] || 0;
    activeDaily[dKey] = rSecs + explSecs;
  });

  // Include days with exploration but no reading
  Object.entries(explorationDaily).forEach(([dKey, explSecs]) => {
    if (activeDaily[dKey] === undefined) {
      activeDaily[dKey] = explSecs;
    }
  });

  const totalActiveSecs = totalReadingSecs + totalExplorationSeconds;

  const data: WebsiteActiveTimeData = {
    totalActiveSeconds: totalActiveSecs,
    daily: activeDaily,
    explorationDaily,
    totalExplorationSeconds,
    lastUpdated,
  };

  return data;
}

export function saveWebsiteActiveTimeData(data: WebsiteActiveTimeData, uid?: string | null): void {
  if (typeof window === "undefined") return;
  try {
    const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
    const userKey = getActiveTimeStorageKey(targetUid);
    localStorage.setItem(userKey, JSON.stringify(data));
    if (!targetUid) {
      localStorage.setItem(ACTIVE_TIME_KEY, JSON.stringify(data));
    }
  } catch (e) {
    console.warn("[ReaderStorage] Error saving website active time:", e);
  }
}

export function addWebsiteActiveSeconds(secondsToAdd: number, uid?: string | null): {
  totalActiveSeconds: number;
  todayActiveSeconds: number;
} {
  const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
  const todayKey = getLocalDateKey();

  if (typeof window === "undefined" || secondsToAdd <= 0) {
    const current = getWebsiteActiveTimeData(targetUid);
    return {
      totalActiveSeconds: current.totalActiveSeconds,
      todayActiveSeconds: current.daily[todayKey] || 0,
    };
  }

  const current = getWebsiteActiveTimeData(targetUid);
  const explorationDaily = { ...(current.explorationDaily || {}) };
  const currentTodayExpl = explorationDaily[todayKey] || 0;
  const newTodayExpl = currentTodayExpl + secondsToAdd;
  explorationDaily[todayKey] = newTodayExpl;

  const newTotalExpl = (current.totalExplorationSeconds || 0) + secondsToAdd;

  const streakData = getReadingActivityData(targetUid);
  const todayReading = streakData.daily[todayKey]?.seconds || 0;
  let totalReading = 0;
  Object.values(streakData.daily || {}).forEach((d) => {
    totalReading += d.seconds || 0;
  });

  const newTodayActive = todayReading + newTodayExpl;
  const newTotalActive = totalReading + newTotalExpl;

  const activeDaily = { ...(current.daily || {}) };
  activeDaily[todayKey] = newTodayActive;

  const updatedData: WebsiteActiveTimeData = {
    totalActiveSeconds: newTotalActive,
    daily: activeDaily,
    explorationDaily,
    totalExplorationSeconds: newTotalExpl,
    lastUpdated: Date.now(),
  };

  saveWebsiteActiveTimeData(updatedData, targetUid);

  return {
    totalActiveSeconds: newTotalActive,
    todayActiveSeconds: newTodayActive,
  };
}

// -------------------------------------------------------------
// My Reading Memory Storage & Timeline
export function getMemoryStorageKey(bookId: string, uid?: string | null): string {
  const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
  return targetUid ? `readershub:memory:v1:${targetUid}:${bookId}` : `${MEMORY_KEY_PREFIX}:${bookId}`;
}

export function getBookReadingMemory(bookId: string, uid?: string | null): BookReadingMemory {
  const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
  const cacheKey = `${targetUid || "guest"}:${bookId}`;
  if (memoryCache.has(cacheKey)) {
    return memoryCache.get(cacheKey)!;
  }

  const defaultMemory: BookReadingMemory = {
    bookId,
    totalSeconds: 0,
    sessionsCount: 0,
    firstReadAt: Date.now(),
    lastReadAt: Date.now(),
    timeline: [],
  };

  if (typeof window === "undefined" || !bookId) return defaultMemory;

  try {
    const userKey = getMemoryStorageKey(bookId, targetUid);
    let raw = localStorage.getItem(userKey);

    if (!raw && !targetUid) {
      raw = localStorage.getItem(`readershub:memory:v1:guest:${bookId}`);
    }

    if (raw) {
      const parsed = JSON.parse(raw);
      const timeline = Array.isArray(parsed.timeline) ? parsed.timeline : [];
      const timelineSum = timeline.reduce((acc: number, ev: any) => acc + (Number(ev.durationSeconds) || 0), 0);
      const mem: BookReadingMemory = {
        bookId,
        totalSeconds: Math.max(parsed.totalSeconds || 0, timelineSum),
        sessionsCount: parsed.sessionsCount || timeline.length,
        firstReadAt: parsed.firstReadAt || Date.now(),
        lastReadAt: parsed.lastReadAt || Date.now(),
        timeline,
      };
      memoryCache.set(cacheKey, mem);
      return mem;
    }
  } catch (e) {
    console.warn(`[ReaderStorage] Failed to read memory for ${bookId}:`, e);
  }

  memoryCache.set(cacheKey, defaultMemory);
  return defaultMemory;
}

export function addBookReadingSeconds(
  bookId: string,
  secondsToAdd: number,
  startPage?: number,
  endPage?: number,
  uid?: string | null
): BookReadingMemory {
  const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
  const mem = getBookReadingMemory(bookId, targetUid);
  if (typeof window === "undefined" || !bookId || secondsToAdd <= 0) return mem;

  try {
    mem.totalSeconds += secondsToAdd;
    mem.lastReadAt = Date.now();
    if (!mem.firstReadAt) {
      mem.firstReadAt = Date.now();
    }

    const cacheKey = `${targetUid || "guest"}:${bookId}`;
    memoryCache.set(cacheKey, mem);
    const userKey = getMemoryStorageKey(bookId, targetUid);
    localStorage.setItem(userKey, JSON.stringify(mem));
    if (!targetUid) {
      localStorage.setItem(`${MEMORY_KEY_PREFIX}:${bookId}`, JSON.stringify(mem));
    }
  } catch (e) {
    console.warn(`[ReaderStorage] Failed to add reading seconds for ${bookId}:`, e);
  }

  return mem;
}

export function recordReadingMemorySession(
  event: Omit<ReadingTimelineEvent, "id">,
  uid?: string | null
): void {
  if (typeof window === "undefined" || !event.bookId) return;

  try {
    const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
    const mem = getBookReadingMemory(event.bookId, targetUid);
    const newEvent: ReadingTimelineEvent = {
      ...event,
      id: `mem_ev_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    };

    // Notice: While reading, addBookReadingSeconds already added seconds incrementally.
    // Ensure totalSeconds is at least the sum of all session durations in timeline, without double-counting!
    const updatedTimeline = [newEvent, ...(mem.timeline || [])].slice(0, 50);
    const timelineSum = updatedTimeline.reduce((acc, ev) => acc + (Number(ev.durationSeconds) || 0), 0);
    mem.totalSeconds = Math.max(mem.totalSeconds || 0, timelineSum);
    mem.sessionsCount = Math.max((mem.sessionsCount || 0) + 1, updatedTimeline.length);
    mem.lastReadAt = event.timestamp;
    if (!mem.firstReadAt || mem.firstReadAt > event.timestamp) {
      mem.firstReadAt = event.timestamp;
    }
    mem.timeline = updatedTimeline;

    const cacheKey = `${targetUid || "guest"}:${event.bookId}`;
    memoryCache.set(cacheKey, mem);
    const userKey = getMemoryStorageKey(event.bookId, targetUid);
    localStorage.setItem(userKey, JSON.stringify(mem));
    if (!targetUid) {
      localStorage.setItem(`${MEMORY_KEY_PREFIX}:${event.bookId}`, JSON.stringify(mem));
    }
  } catch (e) {
    console.warn(`[ReaderStorage] Failed to record memory session:`, e);
  }
}

export function getAllReadingMemories(uid?: string | null): Record<string, BookReadingMemory> {
  const result: Record<string, BookReadingMemory> = {};
  if (typeof window === "undefined") return result;

  const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
  const userPrefix = targetUid ? `readershub:memory:v1:${targetUid}:` : null;

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;

      if (userPrefix && key.startsWith(userPrefix)) {
        const bookId = key.replace(userPrefix, "");
        if (bookId) result[bookId] = getBookReadingMemory(bookId, targetUid);
      } else if (!targetUid && key.startsWith(`${MEMORY_KEY_PREFIX}:`)) {
        // Guest memory keys (`readershub:memory:v1:{bookId}`); never attributed to a signed-in reader
        const rest = key.replace(`${MEMORY_KEY_PREFIX}:`, "");
        if (!rest.includes(":")) {
          const bookId = rest;
          if (bookId && !result[bookId]) {
            result[bookId] = getBookReadingMemory(bookId, targetUid);
          }
        }
      }
    }
  } catch (e) {
    console.warn("[ReaderStorage] Error retrieving all reading memories:", e);
  }

  return result;
}

// -------------------------------------------------------------
// Offline Book Caching (Cache API)
// -------------------------------------------------------------

export async function isBookOffline(bookId: string, pdfUrl: string): Promise<boolean> {
  if (typeof window === "undefined" || !("caches" in window) || !pdfUrl) return false;
  try {
    const cache = await caches.open(OFFLINE_CACHE_NAME);
    const match = await cache.match(pdfUrl);
    return Boolean(match);
  } catch {
    return false;
  }
}

export async function cacheBookOffline(bookId: string, pdfUrl: string): Promise<boolean> {
  if (typeof window === "undefined" || !("caches" in window) || !pdfUrl) return false;
  try {
    const cache = await caches.open(OFFLINE_CACHE_NAME);
    const response = await fetch(pdfUrl, { mode: "cors" });
    if (response.ok) {
      await cache.put(pdfUrl, response);
      return true;
    }
  } catch (e) {
    console.warn(`[ReaderStorage] Failed to cache book offline:`, e);
  }
  return false;
}

export async function removeBookOffline(bookId: string, pdfUrl: string): Promise<boolean> {
  if (typeof window === "undefined" || !("caches" in window) || !pdfUrl) return false;
  try {
    const cache = await caches.open(OFFLINE_CACHE_NAME);
    return await cache.delete(pdfUrl);
  } catch {
    return false;
  }
}

export async function getOfflineBooksList(): Promise<string[]> {
  if (typeof window === "undefined" || !("caches" in window)) return [];
  try {
    const cache = await caches.open(OFFLINE_CACHE_NAME);
    const requests = await cache.keys();
    return requests.map((req) => req.url);
  } catch {
    return [];
  }
}

// -------------------------------------------------------------
// Reading Progress Storage
// -------------------------------------------------------------

export function getSavedProgress(bookId: string, uid?: string | null): ReadingProgressData | null {
  const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
  const cacheKey = `${targetUid || "guest"}:${bookId}`;
  if (progressCache.has(cacheKey)) {
    return progressCache.get(cacheKey)!;
  }

  if (typeof window === "undefined") return null;
  try {
    const userKey = getProgressStorageKey(bookId, targetUid);
    let raw = localStorage.getItem(userKey);
    if (!raw && !targetUid) {
      raw = localStorage.getItem(`${PROGRESS_KEY_PREFIX}:${bookId}`);
    }
    if (raw) {
      const stored = JSON.parse(raw);
      const parsed = stored && stored.bookId ? (normalizeProgressItem(stored).item as ReadingProgressData) : stored;
      progressCache.set(cacheKey, parsed);
      return parsed;
    }
  } catch (e) {
    console.warn(`[ReaderStorage] Failed to read progress for ${bookId}:`, e);
  }
  return null;
}

export function saveProgress(bookId: string, page: number, totalPages: number, uid?: string | null): void {
  if (typeof window === "undefined" || !bookId || page < 1) return;
  try {
    const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
    const cacheKey = `${targetUid || "guest"}:${bookId}`;
    const progress = totalPages > 0 ? Math.min(100, Math.round((page / totalPages) * 100)) : 0;
    const data: ReadingProgressData = {
      bookId,
      page,
      totalPages,
      progress,
      lastReadAt: Date.now(),
    };
    progressCache.set(cacheKey, data);
    const key = getProgressStorageKey(bookId, targetUid);
    localStorage.setItem(key, JSON.stringify(data));
    if (!targetUid) {
      localStorage.setItem(`${PROGRESS_KEY_PREFIX}:${bookId}`, JSON.stringify(data));
    }
  } catch (e) {
    console.warn(`[ReaderStorage] Failed to save progress for ${bookId}:`, e);
  }
}

export function removeStoredReadingProgressItem(bookId: string, uid?: string | null): void {
  if (typeof window === "undefined" || !bookId) return;
  try {
    const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
    const cacheKey = `${targetUid || "guest"}:${bookId}`;
    progressCache.delete(cacheKey);

    const userKey = getProgressStorageKey(bookId, targetUid);
    localStorage.removeItem(userKey);
    if (!targetUid) {
      localStorage.removeItem(`${PROGRESS_KEY_PREFIX}:${bookId}`);
    }

    const history = getStoredReadingHistory(targetUid);
    const filtered = history.filter((h) => h.bookId !== bookId);
    saveStoredReadingHistory(filtered, targetUid);
  } catch (e) {
    console.warn(`[ReaderStorage] Failed to remove reading progress for ${bookId}:`, e);
  }
}

// -------------------------------------------------------------
// Bookmarks Storage
// -------------------------------------------------------------

export function getBookmarks(bookId: string, uid?: string | null): BookmarkItem[] {
  const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
  const cacheKey = `${targetUid || "guest"}:${bookId}`;
  if (bookmarksCache.has(cacheKey)) {
    return bookmarksCache.get(cacheKey)!;
  }

  if (typeof window === "undefined" || !bookId) return [];
  try {
    const userKey = getBookmarksStorageKey(bookId, targetUid);
    let raw = localStorage.getItem(userKey);
    if (!raw && !targetUid) {
      raw = localStorage.getItem(`${BOOKMARKS_KEY_PREFIX}:${bookId}`);
    }
    if (raw) {
      const parsed = JSON.parse(raw);
      bookmarksCache.set(cacheKey, parsed);
      return parsed;
    }
  } catch (e) {
    console.warn(`[ReaderStorage] Failed to read bookmarks for ${bookId}:`, e);
  }
  bookmarksCache.set(cacheKey, []);
  return [];
}

export function saveBookmark(bookId: string, page: number, label?: string, uid?: string | null): BookmarkItem {
  const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
  const cacheKey = `${targetUid || "guest"}:${bookId}`;
  const current = getBookmarks(bookId, targetUid);
  const existing = current.find((b) => b.page === page);
  if (existing) {
    if (label !== undefined) {
      existing.label = label;
      bookmarksCache.set(cacheKey, current);
      const userKey = getBookmarksStorageKey(bookId, targetUid);
      localStorage.setItem(userKey, JSON.stringify(current));
      if (!targetUid) {
        localStorage.setItem(`${BOOKMARKS_KEY_PREFIX}:${bookId}`, JSON.stringify(current));
      }
    }
    return existing;
  }

  const newItem: BookmarkItem = {
    id: `bm_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    bookId,
    page,
    label: label || `Page ${page}`,
    createdAt: Date.now(),
  };

  const updated = [...current, newItem].sort((a, b) => a.page - b.page);
  bookmarksCache.set(cacheKey, updated);
  try {
    const userKey = getBookmarksStorageKey(bookId, targetUid);
    localStorage.setItem(userKey, JSON.stringify(updated));
    if (!targetUid) {
      localStorage.setItem(`${BOOKMARKS_KEY_PREFIX}:${bookId}`, JSON.stringify(updated));
    }
  } catch (e) {
    console.warn(`[ReaderStorage] Failed to save bookmark for ${bookId}:`, e);
  }
  return newItem;
}

export function deleteBookmark(bookId: string, bookmarkId: string, uid?: string | null): void {
  const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
  const cacheKey = `${targetUid || "guest"}:${bookId}`;
  const current = getBookmarks(bookId, targetUid);
  const updated = current.filter((b) => b.id !== bookmarkId && String(b.page) !== bookmarkId);
  bookmarksCache.set(cacheKey, updated);
  try {
    const userKey = getBookmarksStorageKey(bookId, targetUid);
    localStorage.setItem(userKey, JSON.stringify(updated));
    if (!targetUid) {
      localStorage.setItem(`${BOOKMARKS_KEY_PREFIX}:${bookId}`, JSON.stringify(updated));
    }
  } catch (e) {
    console.warn(`[ReaderStorage] Failed to delete bookmark for ${bookId}:`, e);
  }
}

/**
 * Replaces the stored bookmark list for a book (used by cloud restore, migration and import).
 */
export function saveBookmarksList(bookId: string, list: BookmarkItem[], uid?: string | null): void {
  if (typeof window === "undefined" || !bookId) return;
  const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
  const sorted = [...list].sort((a, b) => a.page - b.page);
  bookmarksCache.set(`${targetUid || "guest"}:${bookId}`, sorted);
  annotationsCache.delete(`${targetUid || "guest"}:${bookId}`);
  try {
    localStorage.setItem(getBookmarksStorageKey(bookId, targetUid), JSON.stringify(sorted));
    if (!targetUid) {
      localStorage.setItem(`${BOOKMARKS_KEY_PREFIX}:${bookId}`, JSON.stringify(sorted));
    }
  } catch (e) {
    console.warn(`[ReaderStorage] Failed to save bookmarks for ${bookId}:`, e);
  }
}

/**
 * All bookmark lists for one namespace, keyed by book ID.
 */
export function getAllBookmarks(uid?: string | null): Record<string, BookmarkItem[]> {
  const result: Record<string, BookmarkItem[]> = {};
  if (typeof window === "undefined") return result;
  const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
  const prefix = `${BOOKMARKS_KEY_PREFIX}:${targetUid || "guest"}:`;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) {
        const bookId = key.substring(prefix.length);
        if (isSafeBookId(bookId)) {
          const list = getBookmarks(bookId, targetUid);
          if (list.length > 0) result[bookId] = list;
        }
      }
    }
  } catch (e) {
    console.warn("[ReaderStorage] Error retrieving all bookmarks:", e);
  }
  return result;
}

export function isPageBookmarked(bookId: string, page: number, uid?: string | null): boolean {
  const list = getBookmarks(bookId, uid);
  return list.some((b) => b.page === page);
}

// -------------------------------------------------------------
// Annotations Storage (Highlights, Notes, Drawings, Shapes)
// -------------------------------------------------------------

export function getBookAnnotations(bookId: string, uid?: string | null): BookAnnotations {
  const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
  const cacheKey = `${targetUid || "guest"}:${bookId}`;
  if (annotationsCache.has(cacheKey)) {
    return annotationsCache.get(cacheKey)!;
  }

  const defaultVal: BookAnnotations = {
    highlights: [],
    notes: [],
    drawings: {},
    bookmarks: [],
  };

  if (typeof window === "undefined" || !bookId) return defaultVal;

  try {
    const userKey = getAnnotationsStorageKey(bookId, targetUid);
    let raw = localStorage.getItem(userKey);
    if (!raw && !targetUid) {
      raw = localStorage.getItem(`${ANNOTATIONS_KEY_PREFIX}:${bookId}`);
    }
    const bms = getBookmarks(bookId, targetUid);

    if (raw) {
      const parsed = JSON.parse(raw);
      const res: BookAnnotations = {
        highlights: Array.isArray(parsed.highlights) ? parsed.highlights : [],
        notes: Array.isArray(parsed.notes) ? parsed.notes : [],
        drawings: parsed.drawings && typeof parsed.drawings === "object" ? parsed.drawings : {},
        bookmarks: bms,
      };
      annotationsCache.set(cacheKey, res);
      return res;
    }
    const res = { ...defaultVal, bookmarks: bms };
    annotationsCache.set(cacheKey, res);
    return res;
  } catch (e) {
    console.warn(`[ReaderStorage] Failed to read annotations for ${bookId}:`, e);
  }

  return defaultVal;
}

export function saveBookAnnotations(bookId: string, annotations: BookAnnotations, uid?: string | null): void {
  if (typeof window === "undefined" || !bookId) return;
  const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
  const cacheKey = `${targetUid || "guest"}:${bookId}`;
  annotationsCache.set(cacheKey, annotations);
  try {
    const userKey = getAnnotationsStorageKey(bookId, targetUid);
    localStorage.setItem(userKey, JSON.stringify(annotations));
    if (!targetUid) {
      localStorage.setItem(`${ANNOTATIONS_KEY_PREFIX}:${bookId}`, JSON.stringify(annotations));
    }
  } catch (e) {
    console.warn(`[ReaderStorage] Failed to save annotations for ${bookId}:`, e);
  }
}

export function getAllBookAnnotations(uid?: string | null): Record<string, BookAnnotations> {
  const result: Record<string, BookAnnotations> = {};
  if (typeof window === "undefined") return result;

  const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
  const prefix = targetUid ? `readershub:annotations:v1:${targetUid}:` : `readershub:annotations:v1:guest:`;

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) {
        const bookId = key.substring(prefix.length);
        if (bookId) result[bookId] = getBookAnnotations(bookId, targetUid);
      } else if (!targetUid && key && key.startsWith(`${ANNOTATIONS_KEY_PREFIX}:`) && !key.startsWith("readershub:annotations:v1:")) {
        const bookId = key.replace(`${ANNOTATIONS_KEY_PREFIX}:`, "");
        if (bookId) result[bookId] = getBookAnnotations(bookId, targetUid);
      }
    }
  } catch (e) {
    console.warn("[ReaderStorage] Error retrieving all annotations:", e);
  }

  return result;
}

// -------------------------------------------------------------
// Highlight Helpers
// -------------------------------------------------------------

export function addHighlight(bookId: string, highlight: Omit<HighlightItem, "id" | "createdAt">, uid?: string | null): HighlightItem {
  const current = getBookAnnotations(bookId, uid);
  const newItem: HighlightItem = {
    ...highlight,
    id: `hl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    createdAt: Date.now(),
  };

  current.highlights.push(newItem);
  saveBookAnnotations(bookId, current, uid);
  return newItem;
}

export function deleteHighlight(bookId: string, highlightId: string, uid?: string | null): void {
  const current = getBookAnnotations(bookId, uid);
  current.highlights = current.highlights.filter((h) => h.id !== highlightId);
  saveBookAnnotations(bookId, current, uid);
}

// -------------------------------------------------------------
// Notes Helpers
// -------------------------------------------------------------

export function addNote(bookId: string, note: Omit<NoteItem, "id" | "createdAt" | "updatedAt">, uid?: string | null): NoteItem {
  const current = getBookAnnotations(bookId, uid);
  const newItem: NoteItem = {
    ...note,
    id: `note_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  current.notes.push(newItem);
  saveBookAnnotations(bookId, current, uid);
  return newItem;
}

export function updateNote(bookId: string, noteId: string, updatedText: string, uid?: string | null): void {
  const current = getBookAnnotations(bookId, uid);
  const note = current.notes.find((n) => n.id === noteId);
  if (note) {
    note.note = updatedText;
    note.updatedAt = Date.now();
    saveBookAnnotations(bookId, current, uid);
  }
}

export function deleteNote(bookId: string, noteId: string, uid?: string | null): void {
  const current = getBookAnnotations(bookId, uid);
  current.notes = current.notes.filter((n) => n.id !== noteId);
  saveBookAnnotations(bookId, current, uid);
}

// -------------------------------------------------------------
// Drawing & Shapes Helpers
// -------------------------------------------------------------

export function savePageDrawings(bookId: string, page: number, strokes: DrawingStroke[], uid?: string | null): void {
  const current = getBookAnnotations(bookId, uid);
  if (strokes.length === 0) {
    delete current.drawings[page];
  } else {
    current.drawings[page] = strokes;
  }
  saveBookAnnotations(bookId, current, uid);
}

export function clearPageDrawings(bookId: string, page: number, uid?: string | null): void {
  const current = getBookAnnotations(bookId, uid);
  delete current.drawings[page];
  saveBookAnnotations(bookId, current, uid);
}

/**
 * Shared authoritative calculation for genuinely finished / completed books.
 * Single source of truth across:
 * - Stats & Goals (booksCompleted)
 * - Knowledge Insights (totalCompleted / Books Finished)
 * - My Shelf (Completed tab)
 * - Reading Paths (step completion check)
 * 
 * Rules:
 * 1. Progress completion condition: progress >= 95% OR current page >= totalPages.
 * 2. Genuine active reading time requirement: >= 180 seconds (3 min) of active logged study on that book.
 */
export function getGenuinelyCompletedBookIds(
  history?: ReadingProgressItem[],
  memories?: Record<string, BookReadingMemory>,
  uid?: string | null
): string[] {
  const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
  let historyList = history;
  if (!historyList && typeof window !== "undefined") {
    try {
      const userKey = getHistoryStorageKey(targetUid);
      const raw = localStorage.getItem(userKey);
      if (raw) historyList = JSON.parse(raw);
    } catch {}
  }
  if (!historyList) historyList = [];

  const localMemories = typeof window !== "undefined" ? getAllReadingMemories(targetUid) : {};
  const allMemories: Record<string, BookReadingMemory> = { ...localMemories, ...(memories || {}) };
  const completedIds: string[] = [];

  for (const raw of historyList) {
    if (!raw?.bookId) continue;
    const mem = allMemories[raw.bookId] || (typeof window !== "undefined" ? getBookReadingMemory(raw.bookId, targetUid) : undefined);
    const bookSecs = mem?.totalSeconds || 0;

    // Judged against the verified PDF page count: a stale "100%" saved against a wrong denominator
    // (such as page 100 of a 100-page default for a 394-page book) is not a finished book
    const { item, inconsistent } = normalizeProgressItem(raw);
    if (inconsistent) continue;

    // Complete when the reader reaches the last real page, or >= 95% with genuine reading time
    const isFinished = (item.totalPages > 0 && item.page >= item.totalPages) || (item.progress >= 95 && (bookSecs >= 180 || item.page > 1));

    if (isFinished && (bookSecs >= 180 || !mem || item.progress >= 95)) {
      completedIds.push(item.bookId);
    }
  }

  // Also verify any books in allMemories with completed saved progress or genuine reading time
  for (const [bId, mem] of Object.entries(allMemories)) {
    if (!bId || completedIds.includes(bId)) continue;
    const bookSecs = mem?.totalSeconds || 0;
    const saved = typeof window !== "undefined" ? getSavedProgress(bId, targetUid) : null;
    const catalogBook = getBookById(bId) || BOOKS.find((b) => b.id === bId || b.id.toLowerCase() === bId.toLowerCase());
    const catalogPages = getVerifiedPageCount(bId) ?? (Number(catalogBook?.pages) || 0);
    const curPage = saved?.page || 0;
    const curProg = saved?.progress || (catalogPages > 0 && curPage > 0 ? Math.round((curPage / catalogPages) * 100) : 0);
    if ((curProg >= 95 || (catalogPages > 0 && curPage >= catalogPages)) && (bookSecs >= 180 || !mem || curProg >= 95)) {
      completedIds.push(bId);
    }
  }

  return completedIds;
}

// -------------------------------------------------------------
// Genuine Local Reading Statistics Calculator
// -------------------------------------------------------------

export function calculateReadingStats(
  uid?: string | null,
  explicitHistory?: ReadingProgressItem[],
  explicitFavorites?: string[],
  explicitStreakData?: ReadingStreakData,
  explicitActiveTime?: WebsiteActiveTimeData
): ReadingStats {
  const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
  const streakData = explicitStreakData || getReadingActivityData(targetUid);
  const todayKey = getLocalDateKey();
  const todaySeconds = streakData.daily[todayKey]?.seconds || 0;
  const isTodayQualified = Boolean(streakData.daily[todayKey]?.qualified || todaySeconds >= DAILY_READING_GOAL_SECONDS);

  // Compute total reading seconds across all recorded daily history
  let totalReadingSeconds = 0;
  Object.values(streakData.daily || {}).forEach((d) => {
    totalReadingSeconds += d.seconds || 0;
  });

  const activeTimeData = explicitActiveTime || getWebsiteActiveTimeData(targetUid);
  const todayActiveSeconds = Math.max(activeTimeData.daily[todayKey] || 0, todaySeconds);
  const totalActiveSeconds = Math.max(activeTimeData.totalActiveSeconds || 0, totalReadingSeconds);

  if (typeof window === "undefined") {
    return {
      booksStarted: 0,
      booksCompleted: 0,
      completedBookIds: [],
      pagesRead: 0,
      totalFavorites: 0,
      totalBookmarks: 0,
      totalNotes: 0,
      totalHighlights: 0,
      totalDrawings: 0,
      readingStreakDays: streakData.currentStreak,
      todayReadingSeconds: todaySeconds,
      isTodayQualified,
      totalReadingSeconds,
      totalActiveSeconds,
      todayActiveSeconds,
    };
  }

  let booksStarted = 0;
  let booksCompleted = 0;
  let pagesRead = 0;
  let totalFavorites = 0;
  let totalBookmarks = 0;
  let totalNotes = 0;
  let totalHighlights = 0;
  let totalDrawings = 0;
  let completedIds: string[] = [];

  try {
    // 1. Favorites
    const favs = explicitFavorites !== undefined ? explicitFavorites : getStoredFavorites(targetUid);
    totalFavorites = favs.length;

    // 2. Reading History & Genuinely Explored Books
    const parsed: ReadingProgressItem[] =
      explicitHistory !== undefined ? explicitHistory : getStoredReadingHistory(targetUid);

    const allMemories = getAllReadingMemories(targetUid);
    completedIds = getGenuinelyCompletedBookIds(parsed, allMemories, targetUid);
    booksCompleted = completedIds.length;

    for (const item of parsed) {
      const mem = allMemories[item.bookId] || getBookReadingMemory(item.bookId, targetUid);
      const bookSecs = mem?.totalSeconds || 0;
      const hasGenuineReading = bookSecs >= 30 || item.progress > 0 || (item.page && item.page > 1);

      // A book counts as started/explored only when genuine active reading occurred on this book
      if (hasGenuineReading) {
        booksStarted += 1;
      }

      // Pages read is bounded by plausible reading time on this book
      if (hasGenuineReading) {
        const plausiblePages = bookSecs > 0 ? Math.floor(bookSecs / 45) : (item.page || 1);
        pagesRead += Math.max(1, Math.min(item.page || 1, Math.max(item.page || 1, plausiblePages)));
      }
    }

    // 3. Scan LocalStorage for Bookmarks & Annotations scoped strictly to targetUid
    const userBmPrefix = targetUid ? `readershub:bookmarks:v1:${targetUid}:` : "readershub:bookmarks:v1:guest:";
    const userAnnPrefix = targetUid ? `readershub:annotations:v1:${targetUid}:` : "readershub:annotations:v1:guest:";

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;

      if (key.startsWith(userBmPrefix) || (!targetUid && key.startsWith(`${BOOKMARKS_KEY_PREFIX}:`) && !key.startsWith("readershub:bookmarks:v1:"))) {
        const raw = localStorage.getItem(key);
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) totalBookmarks += parsed.length;
          } catch {}
        }
      } else if (key.startsWith(userAnnPrefix) || (!targetUid && key.startsWith(`${ANNOTATIONS_KEY_PREFIX}:`) && !key.startsWith("readershub:annotations:v1:"))) {
        const raw = localStorage.getItem(key);
        if (raw) {
          try {
            const parsedAnn = JSON.parse(raw);
            if (Array.isArray(parsedAnn.notes)) totalNotes += parsedAnn.notes.length;
            if (Array.isArray(parsedAnn.highlights)) totalHighlights += parsedAnn.highlights.length;
            if (parsedAnn.drawings && typeof parsedAnn.drawings === "object") {
              totalDrawings += Object.keys(parsedAnn.drawings).length;
            }
          } catch {}
        }
      }
    }
  } catch (e) {
    console.warn("[ReaderStorage] Error calculating stats:", e);
  }

  return {
    booksStarted,
    booksCompleted,
    completedBookIds: completedIds,
    pagesRead,
    totalFavorites,
    totalBookmarks,
    totalNotes,
    totalHighlights,
    totalDrawings,
    readingStreakDays: streakData.currentStreak,
    todayReadingSeconds: todaySeconds,
    isTodayQualified,
    totalReadingSeconds,
    totalActiveSeconds,
    todayActiveSeconds,
  };
}

// -------------------------------------------------------------
// Backup / Data Export & Import (100% Client-Side JSON)
// -------------------------------------------------------------

export function exportAllUserData(uid?: string | null): string {
  if (typeof window === "undefined") return "{}";

  const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;

  const exportData: ReaderHubExportData = {
    version: "1.3.0",
    exportedAt: Date.now(),
    favorites: [],
    readingHistory: [],
    annotations: {},
    bookmarks: {},
    readingActivity: getReadingActivityData(targetUid),
    readingMemories: getAllReadingMemories(targetUid),
    activeTime: getWebsiteActiveTimeData(targetUid),
  };

  try {
    // Export exactly this reader's namespace (never another account's keys on a shared device)
    exportData.favorites = getStoredFavorites(targetUid);
    exportData.readingHistory = getStoredReadingHistory(targetUid);
    exportData.annotations = getAllBookAnnotations(targetUid);
    exportData.bookmarks = getAllBookmarks(targetUid);
  } catch (e) {
    console.warn("[ReaderStorage] Failed to export data:", e);
  }

  return JSON.stringify(exportData, null, 2);
}

/**
 * Restores a backup into the given reader's namespace (current reader by default).
 * Non-destructive: every category is merged with what is already stored, never overwritten.
 */
export function importUserData(
  jsonString: string,
  uid?: string | null
): { success: boolean; message: string; importedCount?: number; skippedCount?: number } {
  if (typeof window === "undefined" || !jsonString) {
    return { success: false, message: "No data provided to import." };
  }

  try {
    const data = JSON.parse(jsonString);

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return { success: false, message: "Invalid backup format. Must be a valid JSON object." };
    }

    const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;

    let importedFavs = 0;
    let importedHistory = 0;
    let importedAnnotations = 0;
    let importedBookmarks = 0;
    let skipped = 0;

    // 1. Favorites (union)
    if (Array.isArray(data.favorites)) {
      const validFavs = data.favorites.filter((f: any) => isSafeBookId(f));
      skipped += data.favorites.length - validFavs.length;
      saveStoredFavorites(Array.from(new Set([...getStoredFavorites(targetUid), ...validFavs])), targetUid);
      importedFavs = validFavs.length;
    }

    // 2. Reading History (furthest page wins)
    if (Array.isArray(data.readingHistory)) {
      const histMap = new Map<string, ReadingProgressItem>();
      getStoredReadingHistory(targetUid).forEach((h) => histMap.set(h.bookId, h));
      for (const item of data.readingHistory) {
        if (item && typeof item === "object" && isSafeBookId(item.bookId) && typeof item.page === "number" && item.page > 0) {
          const incoming: ReadingProgressItem = {
            bookId: item.bookId,
            page: item.page,
            totalPages: Number(item.totalPages) || 0,
            progress: Number(item.progress) || 0,
            lastReadAt: Number(item.lastReadAt) || Date.now(),
          };
          const ex = histMap.get(incoming.bookId);
          histMap.set(incoming.bookId, ex ? mergeProgressItems(ex, incoming) : incoming);
          importedHistory++;
        } else {
          skipped++;
        }
      }
      const merged = Array.from(histMap.values()).sort((a, b) => (b.lastReadAt || 0) - (a.lastReadAt || 0));
      saveStoredReadingHistory(merged, targetUid);
    }

    // 3. Active Time (max per day)
    if (data.activeTime && typeof data.activeTime === "object") {
      const cur = getWebsiteActiveTimeData(targetUid);
      const incomingDaily = data.activeTime.daily && typeof data.activeTime.daily === "object" ? data.activeTime.daily : {};
      const daily: Record<string, number> = { ...(cur.daily || {}) };
      Object.entries(incomingDaily).forEach(([k, v]) => {
        daily[k] = Math.max(daily[k] || 0, Number(v) || 0);
      });
      saveWebsiteActiveTimeData(
        {
          ...cur,
          totalActiveSeconds: Math.max(cur.totalActiveSeconds || 0, Number(data.activeTime.totalActiveSeconds) || 0),
          daily,
          lastUpdated: Math.max(cur.lastUpdated || 0, Number(data.activeTime.lastUpdated) || 0),
        },
        targetUid
      );
    }

    // 4. Annotations (union by ID)
    if (data.annotations && typeof data.annotations === "object") {
      for (const [bookId, ann] of Object.entries(data.annotations)) {
        if (isSafeBookId(bookId) && ann && typeof ann === "object") {
          const { bookmarks: _embedded, ...merged } = mergeAnnotations(getBookAnnotations(bookId, targetUid), ann as BookAnnotations);
          saveBookAnnotations(bookId, merged as BookAnnotations, targetUid);
          importedAnnotations++;
        } else {
          skipped++;
        }
      }
    }

    // 5. Bookmarks (union by ID)
    if (data.bookmarks && typeof data.bookmarks === "object") {
      for (const [bookId, bms] of Object.entries(data.bookmarks)) {
        if (isSafeBookId(bookId) && Array.isArray(bms)) {
          saveBookmarksList(bookId, mergeBookmarkLists(getBookmarks(bookId, targetUid), bms as BookmarkItem[]), targetUid);
          importedBookmarks++;
        } else {
          skipped++;
        }
      }
    }

    // 6. Streak & Reading Activity (max seconds per day)
    if (data.readingActivity && typeof data.readingActivity === "object" && data.readingActivity.daily && typeof data.readingActivity.daily === "object") {
      const cur = getReadingActivityData(targetUid);
      const mergedDaily: Record<string, DailyReadingActivity> = { ...cur.daily };
      Object.entries(data.readingActivity.daily as Record<string, DailyReadingActivity>).forEach(([dateKey, act]) => {
        if (!act || typeof act !== "object") return;
        const ex = mergedDaily[dateKey];
        const secs = Math.max(ex?.seconds || 0, Number(act.seconds) || 0);
        mergedDaily[dateKey] = {
          seconds: secs,
          qualified: Boolean(ex?.qualified || act.qualified || secs >= DAILY_READING_GOAL_SECONDS),
          lastUpdated: Math.max(ex?.lastUpdated || 0, Number(act.lastUpdated) || 0),
        };
      });
      const streak = calculateStreak(mergedDaily);
      saveReadingActivityData(
        {
          daily: mergedDaily,
          currentStreak: streak.currentStreak,
          longestStreak: Math.max(streak.longestStreak, cur.longestStreak || 0, Number(data.readingActivity.longestStreak) || 0),
          lastQualifiedDate: streak.lastQualifiedDate || cur.lastQualifiedDate,
        },
        targetUid
      );
    }

    // 7. Reading Memories (merged without double counting)
    if (data.readingMemories && typeof data.readingMemories === "object") {
      for (const [bookId, mem] of Object.entries(data.readingMemories)) {
        if (isSafeBookId(bookId) && mem && typeof mem === "object") {
          const merged = mergeReadingMemory(getBookReadingMemory(bookId, targetUid), mem as BookReadingMemory, bookId);
          memoryCache.set(`${targetUid || "guest"}:${bookId}`, merged);
          localStorage.setItem(getMemoryStorageKey(bookId, targetUid), JSON.stringify(merged));
        }
      }
    }

    invalidateAllCaches();

    const totalImported = importedFavs + importedHistory + importedAnnotations + importedBookmarks;
    const msg = skipped > 0
      ? `Restored ${totalImported} items successfully (${skipped} invalid records skipped).`
      : `Restored ${totalImported} items, reading streak, and annotations with zero errors!`;

    return {
      success: true,
      message: msg,
      importedCount: totalImported,
      skippedCount: skipped,
    };
  } catch (e: any) {
    return { success: false, message: `Failed to restore data: ${e?.message || "Corrupted file"}` };
  }
}

// -------------------------------------------------------------
// Granular Local Data Reset & Recovery Utilities
// -------------------------------------------------------------

export function clearStoredReadingHistory(uid?: string | null): void {
  if (typeof window === "undefined") return;
  try {
    const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
    localStorage.removeItem(getHistoryStorageKey(targetUid));
    if (!targetUid) {
      localStorage.removeItem(HISTORY_KEY);
    }
    const prefix = targetUid ? `${targetUid}:` : "guest:";
    for (const k of Array.from(progressCache.keys())) {
      if (k.startsWith(prefix) || (!targetUid && !k.includes(":"))) {
        progressCache.delete(k);
      }
    }
    const targetKeyPrefix = targetUid ? `readershub:progress:v1:${targetUid}:` : "readershub:progress:v1:guest:";
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && (key.startsWith(targetKeyPrefix) || (!targetUid && key.startsWith(`${PROGRESS_KEY_PREFIX}:`)))) {
        localStorage.removeItem(key);
      }
    }
  } catch (e) {
    console.warn("[ReaderStorage] Failed to clear reading history:", e);
  }
}
export const clearReadingHistory = clearStoredReadingHistory;

export function clearStoredFavorites(uid?: string | null): void {
  if (typeof window === "undefined") return;
  try {
    const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
    localStorage.removeItem(getFavoritesStorageKey(targetUid));
    if (!targetUid) {
      localStorage.removeItem(FAVORITES_KEY);
    }
  } catch (e) {
    console.warn("[ReaderStorage] Failed to clear favorites:", e);
  }
}

export function clearAllUserDataForUid(uid: string): void {
  if (typeof window === "undefined" || !uid) return;
  try {
    const targetUid = uid.trim();
    localStorage.removeItem(getFavoritesStorageKey(targetUid));
    localStorage.removeItem(getHistoryStorageKey(targetUid));
    localStorage.removeItem(getActivityStorageKey(targetUid));
    localStorage.removeItem(getActiveTimeStorageKey(targetUid));
    localStorage.removeItem(getCollectionsStorageKey(targetUid));
    localStorage.removeItem(getReflectionsStorageKey(targetUid));
    localStorage.removeItem(getShelfDismissalsStorageKey(targetUid));

    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.includes(targetUid)) {
        localStorage.removeItem(key);
      }
    }
    invalidateAllCaches();
  } catch (e) {
    console.warn("[ReaderStorage] Failed to clear user data for UID:", e);
  }
}

export function clearAllAnnotations(): void {
  if (typeof window === "undefined") return;
  try {
    annotationsCache.clear();
    bookmarksCache.clear();
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && (key.startsWith(ANNOTATIONS_KEY_PREFIX) || key.startsWith(BOOKMARKS_KEY_PREFIX))) {
        localStorage.removeItem(key);
      }
    }
  } catch (e) {
    console.warn("[ReaderStorage] Failed to clear annotations:", e);
  }
}

export function clearStreakData(uid?: string | null): void {
  if (typeof window === "undefined") return;
  try {
    const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;
    localStorage.removeItem(getActivityStorageKey(targetUid));
  } catch (e) {
    console.warn("[ReaderStorage] Failed to clear streak:", e);
  }
}

export async function clearAllOfflineBooks(): Promise<void> {
  if (typeof window === "undefined" || !("caches" in window)) return;
  try {
    await caches.delete("readershub-offline-books-v1");
  } catch (e) {
    console.warn("[ReaderStorage] Failed to delete offline cache:", e);
  }
}

export async function factoryResetAllData(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    progressCache.clear();
    annotationsCache.clear();
    bookmarksCache.clear();
    memoryCache.clear();
    activeTimeCache = null;

    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith("readershub:") || key.startsWith("readers_hub_") || key.startsWith("readershub_certificates_"))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));

    if ("caches" in window) {
      await caches.delete("readershub-offline-books-v1");
    }
  } catch (e) {
    console.warn("[ReaderStorage] Factory reset failed:", e);
  }
}

export function invalidateAllCaches(): void {
  progressCache.clear();
  annotationsCache.clear();
  bookmarksCache.clear();
  memoryCache.clear();
  activeTimeCache = null;
  shelfDismissalsCache.clear();
  collectionsCache.clear();
  reflectionsCache.clear();
}

export function clearAllUserDataOnLogout(): void {
  if (typeof window === "undefined") return;
  try {
    invalidateAllCaches();
    // Only remove ephemeral guest keys on logout. NEVER purge persistent user account offline caches!
    localStorage.removeItem("readershub:reading-activity:v1:guest");
    localStorage.removeItem("readershub:favorites:v1:guest");
    localStorage.removeItem("readershub:history:v1:guest");
    localStorage.removeItem("readershub:active-time:v1:guest");
    localStorage.removeItem("readershub:collections:v1:guest");
    localStorage.removeItem("readershub:reflections:v1:guest");
    localStorage.removeItem("readershub:shelf-dismissals:v1:guest");

    // Legacy guest keys are guest-only too; they were merged into the account at login
    [FAVORITES_KEY, HISTORY_KEY, ACTIVITY_KEY, ACTIVE_TIME_KEY, COLLECTIONS_KEY, REFLECTIONS_KEY, SHELF_DISMISSALS_KEY].forEach(
      (k) => localStorage.removeItem(k)
    );

    // Per-book guest keys: `{prefix}:guest:{bookId}` and legacy `{prefix}:{bookId}` (no account UID segment)
    const perBookPrefixes = [ANNOTATIONS_KEY_PREFIX, BOOKMARKS_KEY_PREFIX, PROGRESS_KEY_PREFIX, MEMORY_KEY_PREFIX];
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!key) continue;
      const prefix = perBookPrefixes.find((p) => key.startsWith(`${p}:`));
      if (!prefix) continue;
      const rest = key.substring(prefix.length + 1);
      if (rest.startsWith("guest:") || !rest.includes(":")) {
        localStorage.removeItem(key);
      }
    }
  } catch (e) {
    console.warn("[ReaderStorage] Failed to clear user data on logout:", e);
  }
}

export function exportAllStorageDataForSync(uid?: string | null): {
  favorites: string[];
  readingHistory: ReadingProgressItem[];
  readingActivity: ReadingStreakData;
  activeTime: WebsiteActiveTimeData;
  readingMemories: Record<string, BookReadingMemory>;
  annotations: Record<string, BookAnnotations>;
  collections?: ReadingCollection[];
  reflections?: Record<string, BookReflection>;
  shelfDismissals?: ShelfDismissalsMap;
} {
  const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;

  if (typeof window === "undefined") {
    return {
      favorites: [],
      readingHistory: [],
      readingActivity: { daily: {}, currentStreak: 0, longestStreak: 0, lastQualifiedDate: null },
      activeTime: { totalActiveSeconds: 0, daily: {}, lastUpdated: Date.now() },
      readingMemories: {},
      annotations: {},
      collections: [],
      reflections: {},
      shelfDismissals: {},
    };
  }

  const favorites = getStoredFavorites(targetUid);
  const readingHistory = getStoredReadingHistory(targetUid);
  const readingActivity = getReadingActivityData(targetUid);
  const activeTime = getWebsiteActiveTimeData(targetUid);
  const readingMemories = getAllReadingMemories(targetUid);
  const annotations = getAllBookAnnotations();
  const collections = getReadingCollections(targetUid);
  const reflections = getBookReflections(targetUid);
  const shelfDismissals = getShelfDismissals(targetUid);

  return {
    favorites,
    readingHistory,
    readingActivity,
    activeTime,
    readingMemories,
    annotations,
    collections,
    reflections,
    shelfDismissals,
  };
}

export function hydrateStorageFromCloudData(
  data: {
    favorites?: string[];
    readingHistory?: ReadingProgressItem[];
    readingActivity?: ReadingStreakData;
    activeTime?: WebsiteActiveTimeData;
    readingMemories?: Record<string, BookReadingMemory>;
    annotations?: Record<string, BookAnnotations>;
    collections?: ReadingCollection[];
    reflections?: Record<string, BookReflection>;
    shelfDismissals?: ShelfDismissalsMap;
    bookmarks?: Record<string, BookmarkItem[]>;
  },
  uid?: string | null
): void {
  if (typeof window === "undefined") return;

  try {
    const targetUid = uid !== undefined ? (uid ? uid.trim() : null) : activeUserUid;

    // 1. Favorites: Non-destructive merge
    if (Array.isArray(data.favorites) && data.favorites.length > 0) {
      const existingFavs = getStoredFavorites(targetUid);
      const merged = Array.from(new Set([...existingFavs, ...data.favorites]));
      saveStoredFavorites(merged, targetUid);
    }

    // 2. Reading History: Non-destructive merge
    if (Array.isArray(data.readingHistory) && data.readingHistory.length > 0) {
      const existingHist = getStoredReadingHistory(targetUid);
      const histMap = new Map<string, ReadingProgressItem>();
      existingHist.forEach((item) => {
        if (item?.bookId) histMap.set(item.bookId, item);
      });

      data.readingHistory.forEach((item) => {
        if (!item?.bookId) return;
        const ex = histMap.get(item.bookId);
        if (!ex) {
          histMap.set(item.bookId, item);
        } else {
          // Furthest page wins; the denominator is the PDF's verified page count (never a 100-page default)
          histMap.set(item.bookId, mergeProgressItems(ex, item));
        }
      });

      const mergedHist = Array.from(histMap.values());
      saveStoredReadingHistory(mergedHist, targetUid);

      // Also update individual progress keys
      mergedHist.forEach((item) => {
        if (item.bookId) {
          const key = getProgressStorageKey(item.bookId, targetUid);
          const existingProg = getSavedProgress(item.bookId, targetUid);
          if (!existingProg || item.page > (existingProg.page || 0)) {
            localStorage.setItem(
              key,
              JSON.stringify({
                bookId: item.bookId,
                page: item.page,
                totalPages: item.totalPages,
                progress: item.progress,
                lastReadAt: item.lastReadAt,
              })
            );
            if (!targetUid) {
              localStorage.setItem(
                `${PROGRESS_KEY_PREFIX}:${item.bookId}`,
                JSON.stringify({
                  bookId: item.bookId,
                  page: item.page,
                  totalPages: item.totalPages,
                  progress: item.progress,
                  lastReadAt: item.lastReadAt,
                })
              );
            }
          }
        }
      });
    }

    // 3. Reading Activity: Safeguard historical activity per user UID
    if (data.readingActivity) {
      const incomingDays = Object.keys(data.readingActivity.daily || {}).length;
      if (incomingDays > 0) {
        const existingActivity = getReadingActivityData(targetUid);
        const existingDaily = existingActivity.daily || {};

        const mergedDaily: Record<string, DailyReadingActivity> = { ...existingDaily };
        Object.entries(data.readingActivity.daily || {}).forEach(([dateKey, act]) => {
          if (mergedDaily[dateKey]) {
            const secs = Math.max(mergedDaily[dateKey].seconds || 0, act.seconds || 0);
            mergedDaily[dateKey] = {
              seconds: secs,
              qualified: Boolean(mergedDaily[dateKey].qualified || act.qualified || secs >= 900),
              lastUpdated: Math.max(mergedDaily[dateKey].lastUpdated || 0, act.lastUpdated || 0),
            };
          } else {
            mergedDaily[dateKey] = act;
          }
        });

        const { currentStreak, longestStreak, lastQualifiedDate } = calculateStreak(mergedDaily);
        const finalActivity: ReadingStreakData = {
          daily: mergedDaily,
          currentStreak,
          longestStreak: Math.max(longestStreak, data.readingActivity.longestStreak || 0),
          lastQualifiedDate: lastQualifiedDate || data.readingActivity.lastQualifiedDate,
        };
        saveReadingActivityData(finalActivity, targetUid);
      }
    }

    // 4. Active Time: Non-destructive merge
    if (data.activeTime && data.activeTime.totalActiveSeconds > 0) {
      const cur = getWebsiteActiveTimeData(targetUid);
      const mergedTotal = Math.max(cur.totalActiveSeconds || 0, data.activeTime.totalActiveSeconds || 0);
      const mergedDaily = { ...(cur.daily || {}), ...(data.activeTime.daily || {}) };
      const mergedExpl = { ...(cur.explorationDaily || {}), ...(data.activeTime.explorationDaily || {}) };
      const mergedData: WebsiteActiveTimeData = {
        totalActiveSeconds: mergedTotal,
        daily: mergedDaily,
        explorationDaily: mergedExpl,
        totalExplorationSeconds: Math.max(cur.totalExplorationSeconds || 0, data.activeTime.totalExplorationSeconds || 0),
        lastUpdated: Math.max(cur.lastUpdated || 0, data.activeTime.lastUpdated || 0),
      };
      saveWebsiteActiveTimeData(mergedData, targetUid);
    }

    // 5. Reading Memories: Non-destructive merge
    if (data.readingMemories && Object.keys(data.readingMemories).length > 0) {
      for (const [bookId, memory] of Object.entries(data.readingMemories)) {
        if (bookId && memory) {
          const curMem = getBookReadingMemory(bookId, targetUid);
          const timeline = memory.timeline && memory.timeline.length > (curMem.timeline?.length || 0)
            ? memory.timeline
            : curMem.timeline || [];
          const timelineSum = timeline.reduce((acc, ev) => acc + (Number(ev.durationSeconds) || 0), 0);
          const mergedMem: BookReadingMemory = {
            bookId,
            totalSeconds: Math.max(curMem.totalSeconds || 0, memory.totalSeconds || 0, timelineSum),
            sessionsCount: Math.max(curMem.sessionsCount || 0, memory.sessionsCount || 0, timeline.length),
            firstReadAt: Math.min(curMem.firstReadAt || Date.now(), memory.firstReadAt || Date.now()),
            lastReadAt: Math.max(curMem.lastReadAt || 0, memory.lastReadAt || 0),
            timeline,
          };
          const userKey = getMemoryStorageKey(bookId, targetUid);
          localStorage.setItem(userKey, JSON.stringify(mergedMem));
          if (!targetUid) {
            localStorage.setItem(`${MEMORY_KEY_PREFIX}:${bookId}`, JSON.stringify(mergedMem));
          }
        }
      }
    }

    // 6. Annotations: Non-destructive merge
    if (data.annotations && Object.keys(data.annotations).length > 0) {
      for (const [bookId, ann] of Object.entries(data.annotations)) {
        if (bookId && ann) {
          const curAnn = getBookAnnotations(bookId, targetUid);
          const mergedAnn: BookAnnotations = {
            highlights: [...(curAnn.highlights || []), ...(ann.highlights || []).filter((h) => !curAnn.highlights.some((ch) => ch.id === h.id))],
            notes: [...(curAnn.notes || []), ...(ann.notes || []).filter((n) => !curAnn.notes.some((cn) => cn.id === n.id))],
            drawings: { ...(curAnn.drawings || {}), ...(ann.drawings || {}) },
            bookmarks: [...(curAnn.bookmarks || []), ...(ann.bookmarks || []).filter((b) => !curAnn.bookmarks?.some((cb) => cb.id === b.id))],
          };
          const annKey = getAnnotationsStorageKey(bookId, targetUid);
          localStorage.setItem(annKey, JSON.stringify(mergedAnn));
          if (!targetUid) {
            localStorage.setItem(`${ANNOTATIONS_KEY_PREFIX}:${bookId}`, JSON.stringify(mergedAnn));
          }
        }
      }
    }

    // 7. Collections: Non-destructive merge
    if (Array.isArray(data.collections) && data.collections.length > 0) {
      const curCols = getReadingCollections(targetUid);
      const colMap = new Map<string, ReadingCollection>();
      curCols.forEach((c) => colMap.set(c.id, c));
      data.collections.forEach((c) => {
        if (!c?.id) return;
        const ex = colMap.get(c.id);
        if (!ex) {
          colMap.set(c.id, c);
        } else {
          colMap.set(c.id, {
            ...ex,
            ...c,
            bookIds: Array.from(new Set([...(ex.bookIds || []), ...(c.bookIds || [])])),
            updatedAt: Math.max(ex.updatedAt || 0, c.updatedAt || 0),
          });
        }
      });
      const mergedCols = Array.from(colMap.values());
      saveReadingCollections(mergedCols, targetUid);
    }

    // 8. Reflections: Non-destructive merge
    if (data.reflections && Object.keys(data.reflections).length > 0) {
      const curRefs = getBookReflections(targetUid);
      const mergedRefs = { ...curRefs };
      Object.entries(data.reflections).forEach(([bookId, ref]) => {
        if (!mergedRefs[bookId] || (ref.completedAt || 0) > (mergedRefs[bookId].completedAt || 0)) {
          mergedRefs[bookId] = ref;
        }
      });
      const refKey = getReflectionsStorageKey(targetUid);
      localStorage.setItem(refKey, JSON.stringify(mergedRefs));
      if (!targetUid) {
        localStorage.setItem(REFLECTIONS_KEY, JSON.stringify(mergedRefs));
      }
    }

    // 9. Shelf Dismissals: Non-destructive merge
    if (data.shelfDismissals && Object.keys(data.shelfDismissals).length > 0) {
      const curDism = getShelfDismissals(targetUid);
      const mergedDism: ShelfDismissalsMap = { ...curDism };
      Object.entries(data.shelfDismissals).forEach(([sec, bMap]) => {
        if (!mergedDism[sec]) mergedDism[sec] = {};
        mergedDism[sec] = { ...mergedDism[sec], ...bMap };
      });
      const dismKey = getShelfDismissalsStorageKey(targetUid);
      localStorage.setItem(dismKey, JSON.stringify(mergedDism));
      if (!targetUid) {
        localStorage.setItem(SHELF_DISMISSALS_KEY, JSON.stringify(mergedDism));
      }
    }

    // 10. Bookmarks: Non-destructive union by ID (previously written to the cloud but never restored)
    if (data.bookmarks && typeof data.bookmarks === "object") {
      for (const [bookId, list] of Object.entries(data.bookmarks)) {
        if (isSafeBookId(bookId) && Array.isArray(list) && list.length > 0) {
          saveBookmarksList(bookId, mergeBookmarkLists(getBookmarks(bookId, targetUid), list), targetUid);
        }
      }
    }

    // Invalidate in-memory caches so subsequent calls immediately read the hydrated values
    invalidateAllCaches();
  } catch (e) {
    console.warn("[ReaderStorage] Hydration error:", e);
  }
}

/**
 * Safely & non-destructively copies and merges all guest/local data on this device
 * into the authenticated user's isolated storage namespace upon login.
 * Never deletes guest data; only copies/unions forward so the user never loses progress.
 */
export function migrateGuestDataToUser(uid: string): void {
  if (typeof window === "undefined" || !uid) return;
  const targetUid = uid.trim();
  if (!targetUid) return;

  try {
    // 1. Migrate Favorites
    const guestFavs = getStoredFavorites(null);
    if (guestFavs.length > 0) {
      const userFavs = getStoredFavorites(targetUid);
      const mergedFavs = Array.from(new Set([...userFavs, ...guestFavs]));
      saveStoredFavorites(mergedFavs, targetUid);
    }

    // 2. Migrate Reading History
    const guestHistory = getStoredReadingHistory(null);
    if (guestHistory.length > 0) {
      const userHistory = getStoredReadingHistory(targetUid);
      const histMap = new Map<string, ReadingProgressItem>();
      userHistory.forEach((h) => histMap.set(h.bookId, h));
      guestHistory.forEach((gh) => {
        const ex = histMap.get(gh.bookId);
        if (!ex) {
          histMap.set(gh.bookId, gh);
        } else {
          histMap.set(gh.bookId, mergeProgressItems(ex, gh));
        }
      });
      saveStoredReadingHistory(Array.from(histMap.values()), targetUid);
    }

    // 3. Migrate Reading Activity & Streaks
    const guestActivity = getReadingActivityData(null);
    if (guestActivity && Object.keys(guestActivity.daily || {}).length > 0) {
      const userActivity = getReadingActivityData(targetUid);
      const mergedDaily = { ...(userActivity.daily || {}) };
      Object.entries(guestActivity.daily || {}).forEach(([dateKey, act]) => {
        if (mergedDaily[dateKey]) {
          const secs = Math.max(mergedDaily[dateKey].seconds || 0, act.seconds || 0);
          mergedDaily[dateKey] = {
            seconds: secs,
            qualified: Boolean(mergedDaily[dateKey].qualified || act.qualified || secs >= 900),
            lastUpdated: Math.max(mergedDaily[dateKey].lastUpdated || 0, act.lastUpdated || 0),
          };
        } else {
          mergedDaily[dateKey] = act;
        }
      });
      const { currentStreak, longestStreak, lastQualifiedDate } = calculateStreak(mergedDaily);
      saveReadingActivityData(
        {
          daily: mergedDaily,
          currentStreak,
          longestStreak: Math.max(longestStreak, userActivity.longestStreak || 0),
          lastQualifiedDate: lastQualifiedDate || userActivity.lastQualifiedDate,
        },
        targetUid
      );
    }

    // 4. Migrate Active Time
    const guestActive = getWebsiteActiveTimeData(null);
    if (guestActive && guestActive.totalActiveSeconds > 0) {
      const userActive = getWebsiteActiveTimeData(targetUid);
      const mergedDaily = { ...(userActive.daily || {}) };
      Object.entries(guestActive.daily || {}).forEach(([k, s]) => {
        mergedDaily[k] = Math.max(mergedDaily[k] || 0, s || 0);
      });
      saveWebsiteActiveTimeData(
        {
          totalActiveSeconds: Math.max(userActive.totalActiveSeconds || 0, guestActive.totalActiveSeconds || 0),
          daily: mergedDaily,
          explorationDaily: { ...(userActive.explorationDaily || {}), ...(guestActive.explorationDaily || {}) },
          totalExplorationSeconds: Math.max(userActive.totalExplorationSeconds || 0, guestActive.totalExplorationSeconds || 0),
          lastUpdated: Math.max(userActive.lastUpdated || 0, guestActive.lastUpdated || 0),
        },
        targetUid
      );
    }

    // 4b. Migrate collections, reflections and shelf dismissals (previously lost at logout)
    const guestCollections = getReadingCollections(null);
    if (guestCollections.length > 0) {
      const colMap = new Map<string, ReadingCollection>();
      getReadingCollections(targetUid).forEach((c) => colMap.set(c.id, c));
      guestCollections.forEach((c) => {
        const ex = colMap.get(c.id);
        colMap.set(c.id, ex ? { ...ex, bookIds: Array.from(new Set([...(ex.bookIds || []), ...(c.bookIds || [])])) } : c);
      });
      saveReadingCollections(Array.from(colMap.values()), targetUid);
    }

    const guestReflections = getBookReflections(null);
    if (Object.keys(guestReflections).length > 0) {
      const merged = { ...getBookReflections(targetUid) };
      Object.entries(guestReflections).forEach(([bookId, ref]) => {
        if (!merged[bookId] || (ref.completedAt || 0) > (merged[bookId].completedAt || 0)) merged[bookId] = ref;
      });
      reflectionsCache.set(targetUid, merged);
      localStorage.setItem(getReflectionsStorageKey(targetUid), JSON.stringify(merged));
    }

    const guestDismissals = getShelfDismissals(null);
    if (Object.keys(guestDismissals).length > 0) {
      const merged: ShelfDismissalsMap = { ...getShelfDismissals(targetUid) };
      Object.entries(guestDismissals).forEach(([sec, bMap]) => {
        merged[sec] = { ...(merged[sec] || {}), ...bMap };
      });
      shelfDismissalsCache.set(targetUid, merged);
      localStorage.setItem(getShelfDismissalsStorageKey(targetUid), JSON.stringify(merged));
    }

    // 5. Migrate per-book guest data (progress, memory, annotations, bookmarks).
    // Guest per-book keys exist in two shapes: `{prefix}:guest:{bookId}` and the legacy `{prefix}:{bookId}`.
    const guestBookIdFor = (key: string, prefix: string): string | null => {
      if (!key.startsWith(`${prefix}:`)) return null;
      const rest = key.substring(prefix.length + 1);
      const bookId = rest.startsWith("guest:") ? rest.substring(6) : rest;
      return isSafeBookId(bookId) ? bookId : null;
    };
    const readJson = (key: string): any => {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    };

    const guestKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) guestKeys.push(key);
    }

    for (const key of guestKeys) {
      const progressBookId = guestBookIdFor(key, PROGRESS_KEY_PREFIX);
      const memoryBookId = guestBookIdFor(key, MEMORY_KEY_PREFIX);
      const annotationBookId = guestBookIdFor(key, ANNOTATIONS_KEY_PREFIX);
      const bookmarkBookId = guestBookIdFor(key, BOOKMARKS_KEY_PREFIX);

      if (progressBookId) {
        const guestProg = readJson(key);
        if (guestProg && typeof guestProg.page === "number") {
          const userKey = getProgressStorageKey(progressBookId, targetUid);
          const userProg = readJson(userKey);
          const merged = userProg ? mergeProgressItems(userProg, { ...guestProg, bookId: progressBookId }) : { ...guestProg, bookId: progressBookId };
          localStorage.setItem(userKey, JSON.stringify(merged));
        }
      } else if (memoryBookId) {
        const guestMem = readJson(key);
        if (guestMem && typeof guestMem === "object") {
          const userKey = getMemoryStorageKey(memoryBookId, targetUid);
          const merged = mergeReadingMemory(readJson(userKey) || undefined, guestMem, memoryBookId);
          localStorage.setItem(userKey, JSON.stringify(merged));
        }
      } else if (annotationBookId) {
        const guestAnn = readJson(key);
        if (guestAnn && typeof guestAnn === "object") {
          const userKey = getAnnotationsStorageKey(annotationBookId, targetUid);
          const { bookmarks: _ignored, ...merged } = mergeAnnotations(readJson(userKey) || undefined, guestAnn);
          localStorage.setItem(userKey, JSON.stringify(merged));
        }
      } else if (bookmarkBookId) {
        const guestBms = readJson(key);
        if (Array.isArray(guestBms) && guestBms.length > 0) {
          const userKey = getBookmarksStorageKey(bookmarkBookId, targetUid);
          const merged = mergeBookmarkLists(readJson(userKey) || [], guestBms);
          localStorage.setItem(userKey, JSON.stringify(merged));
        }
      }
    }

    invalidateAllCaches();
  } catch (err) {
    console.warn("[ReaderStorage] Error in migrateGuestDataToUser:", err);
  }
}


