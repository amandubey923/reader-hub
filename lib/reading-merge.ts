/**
 * Reader's HUB — Pure progress & merge rules shared by local storage, cloud sync, migration and import.
 * No browser or Firebase dependencies, so these rules are unit-testable.
 */

import type {
  BookAnnotations,
  BookmarkItem,
  BookReadingMemory,
  BookReflection,
  ReadingCollection,
  ReadingProgressItem,
  ShelfDismissalsMap,
  WebsiteActiveTimeData,
} from "./reader-storage";
import { getVerifiedPageCount, progressPercent } from "./book-pages";

export interface ReadingProgressComputation {
  item: ReadingProgressItem;
  changed: boolean;
  isNewCompletion: boolean;
}

/**
 * Brings a saved progress record in line with the book's real PDF page count, keeping the reader's page.
 * - Known PDF: the denominator becomes the verified count and progress is recalculated from the page
 *   (a stale "100%" computed against a wrong total is discarded).
 * - A saved page beyond the end of the real PDF (left over from a different file) is clamped for display
 *   but marked inconsistent, so it can never count as finishing the book.
 * - Unknown PDF: nothing is invented; a missing total stays 0 (unknown).
 */
export function normalizeProgressItem(item: ReadingProgressItem): { item: ReadingProgressItem; inconsistent: boolean } {
  const verified = getVerifiedPageCount(item?.bookId);
  const page = Number(item?.page) > 0 ? Math.floor(Number(item.page)) : 1;
  if (verified) {
    const inconsistent = page > verified;
    const clamped = Math.min(page, verified);
    return {
      item: {
        ...item,
        page: clamped,
        totalPages: verified,
        progress: inconsistent ? Math.min(99, progressPercent(clamped, verified)) : progressPercent(clamped, verified),
      },
      inconsistent,
    };
  }
  const total = Number(item?.totalPages) > 0 ? Math.floor(Number(item.totalPages)) : 0;
  return {
    item: { ...item, page, totalPages: total, progress: total > 0 ? progressPercent(page, total) : Math.min(99, Number(item?.progress) || 0) },
    inconsistent: total > 0 && page > total,
  };
}

/** True only when the reader has genuinely reached the last page of the real PDF. */
export function isFinishedReading(item: ReadingProgressItem | undefined): boolean {
  if (!item?.bookId) return false;
  const { item: n, inconsistent } = normalizeProgressItem(item);
  return !inconsistent && n.totalPages > 0 && n.page >= n.totalPages;
}

/**
 * Computes the next progress record for a book.
 * Total pages, in order of authority: the open PDF's numPages (passed by the reader), the verified count of
 * the book's PDF, the saved record, the catalogue value. If none is known the total stays unknown (0) and the
 * book can never be marked complete. Omitted page/totalPages keep the existing values, so a caller that only
 * knows the book ID (e.g. the detail page) can never rewrite real progress.
 */
export function computeReadingProgress(
  existing: ReadingProgressItem | undefined,
  bookId: string,
  page?: number,
  totalPages?: number,
  catalogPages: number = 0,
  now: number = Date.now()
): ReadingProgressComputation {
  const prev = existing ? normalizeProgressItem(existing) : undefined;
  const base = prev?.item;
  // page <= 1 is treated as "unspecified" (existing behaviour: re-opening a book never rewinds saved progress)
  const curTotal =
    totalPages && totalPages > 0
      ? totalPages
      : getVerifiedPageCount(bookId) ?? (base && base.totalPages > 0 ? base.totalPages : catalogPages > 0 ? catalogPages : 0);
  const rawPage = page && page > 1 ? page : base && base.page > 0 ? base.page : 1;
  const curPage = curTotal > 0 ? Math.min(rawPage, curTotal) : rawPage;
  const progress = progressPercent(curPage, curTotal);

  const wasCompleted = Boolean(existing && isFinishedReading(existing));
  // A page that only reached the end because it was clamped is not a real finish
  const isCompleted = curTotal > 0 && curPage >= curTotal && rawPage <= curTotal && !(prev?.inconsistent && !(page && page > 1));

  const changed =
    !existing ||
    existing.page !== curPage ||
    existing.totalPages !== curTotal ||
    existing.progress !== progress;

  return {
    item: {
      bookId,
      page: curPage,
      totalPages: curTotal,
      progress,
      lastReadAt: changed ? now : existing?.lastReadAt ?? now,
    },
    changed,
    isNewCompletion: !wasCompleted && isCompleted,
  };
}

/**
 * Merges two progress records for the same book: furthest page wins, latest timestamp is kept, and the
 * denominator is the verified PDF count when known (never a guessed default).
 */
export function mergeProgressItems(a: ReadingProgressItem, b: ReadingProgressItem): ReadingProgressItem {
  const bookId = a.bookId || b.bookId;
  const page = Math.max(Number(a.page) || 1, Number(b.page) || 1);
  const total = getVerifiedPageCount(bookId) ?? Math.max(Number(a.totalPages) || 0, Number(b.totalPages) || 0);
  const lastReadAt = Math.max(a.lastReadAt || 0, b.lastReadAt || 0);
  if (total > 0) {
    return normalizeProgressItem({ bookId, page, totalPages: total, progress: 0, lastReadAt }).item;
  }
  return { bookId, page, totalPages: 0, progress: Math.min(99, Math.max(a.progress || 0, b.progress || 0)), lastReadAt };
}

/**
 * Union of two bookmark lists by ID, one bookmark per page, sorted by page.
 */
export function mergeBookmarkLists(a: BookmarkItem[] = [], b: BookmarkItem[] = []): BookmarkItem[] {
  const byPage = new Map<number, BookmarkItem>();
  const seenIds = new Set<string>();
  for (const bm of [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]) {
    if (!bm || typeof bm.page !== "number" || !bm.id || seenIds.has(bm.id)) continue;
    seenIds.add(bm.id);
    if (!byPage.has(bm.page)) byPage.set(bm.page, bm);
  }
  return Array.from(byPage.values()).sort((x, y) => x.page - y.page);
}

/**
 * Non-destructive annotation merge: highlights and notes are unioned by ID;
 * for drawings, pages present in `incoming` replace the same page in `base`.
 */
export function mergeAnnotations(base: Partial<BookAnnotations> | undefined, incoming: Partial<BookAnnotations> | undefined): BookAnnotations {
  const b = base || {};
  const inc = incoming || {};
  const unionById = <T extends { id: string }>(x: T[] = [], y: T[] = []): T[] => {
    const xs = Array.isArray(x) ? x : [];
    const ys = Array.isArray(y) ? y : [];
    const ids = new Set(xs.map((item) => item.id));
    return [...xs, ...ys.filter((item) => item && !ids.has(item.id))];
  };
  return {
    highlights: unionById(b.highlights, inc.highlights),
    notes: unionById(b.notes, inc.notes),
    drawings: { ...(b.drawings || {}), ...(inc.drawings || {}) },
    bookmarks: mergeBookmarkLists(b.bookmarks, inc.bookmarks),
  };
}

/**
 * True when merging `incoming` into `base` would add something `base` does not already contain.
 */
export function annotationsAddContent(base: Partial<BookAnnotations> | undefined, incoming: Partial<BookAnnotations> | undefined): boolean {
  const merged = mergeAnnotations(base, incoming);
  const b = base || {};
  return (
    merged.highlights.length > (b.highlights?.length || 0) ||
    merged.notes.length > (b.notes?.length || 0) ||
    Object.keys(merged.drawings).some((page) => !(b.drawings || {})[page as unknown as number])
  );
}

/**
 * Merges two reading memories for one book without double counting.
 */
export function mergeReadingMemory(a: BookReadingMemory | undefined, b: BookReadingMemory | undefined, bookId: string): BookReadingMemory {
  const now = Date.now();
  const x = a || ({} as BookReadingMemory);
  const y = b || ({} as BookReadingMemory);
  const timeline = (y.timeline?.length || 0) > (x.timeline?.length || 0) ? y.timeline || [] : x.timeline || [];
  const timelineSum = timeline.reduce((acc, ev) => acc + (Number(ev.durationSeconds) || 0), 0);
  return {
    bookId,
    totalSeconds: Math.max(x.totalSeconds || 0, y.totalSeconds || 0, timelineSum),
    sessionsCount: Math.max(x.sessionsCount || 0, y.sessionsCount || 0, timeline.length),
    firstReadAt: Math.min(x.firstReadAt || now, y.firstReadAt || now),
    lastReadAt: Math.max(x.lastReadAt || 0, y.lastReadAt || 0),
    timeline,
  };
}

/**
 * Book IDs are used inside storage keys (":"-separated) and as Firestore document IDs, so ":" "/" "\" and
 * control characters are rejected. Inner spaces are allowed: a catalogue ID such as "The Conquest of Happiness"
 * is legitimate and its reader data must not be silently skipped.
 */
export function isSafeBookId(id: unknown): id is string {
  return typeof id === "string" && id.length <= 200 && /^[^:/\\\s](?:[^:/\\\t\n\r\f\v]*[^:/\\\s])?$/.test(id);
}

// ---------------------------------------------------------------- Account-level merges (cloud ⇄ device)
// Each returns the merged value plus whether the cloud copy is missing something, so callers only write when needed.
// All are unions or maxima: running them again with the same inputs changes nothing (idempotent).

/** Collections merged by ID: book lists are unioned; name/description/colour come from the most recently updated copy. */
export function mergeCollectionLists(
  cloud: ReadingCollection[] = [],
  local: ReadingCollection[] = []
): { merged: ReadingCollection[]; cloudNeedsUpdate: boolean } {
  const byId = new Map<string, ReadingCollection>();
  for (const c of Array.isArray(cloud) ? cloud : []) if (c?.id) byId.set(c.id, { ...c, bookIds: [...(c.bookIds || [])] });
  let cloudNeedsUpdate = false;
  for (const c of Array.isArray(local) ? local : []) {
    if (!c?.id) continue;
    const ex = byId.get(c.id);
    if (!ex) {
      byId.set(c.id, { ...c, bookIds: [...(c.bookIds || [])] });
      cloudNeedsUpdate = true;
      continue;
    }
    const localIsNewer = (c.updatedAt || 0) > (ex.updatedAt || 0);
    const bookIds = Array.from(new Set([...(ex.bookIds || []), ...(c.bookIds || [])]));
    if (bookIds.length > (ex.bookIds || []).length || localIsNewer) cloudNeedsUpdate = true;
    byId.set(c.id, { ...ex, ...(localIsNewer ? c : {}), bookIds, updatedAt: Math.max(ex.updatedAt || 0, c.updatedAt || 0) });
  }
  return { merged: Array.from(byId.values()), cloudNeedsUpdate };
}

/** Reflections merged per book; the more recent reflection wins. */
export function mergeReflectionMaps(
  cloud: Record<string, BookReflection> = {},
  local: Record<string, BookReflection> = {}
): { merged: Record<string, BookReflection>; cloudNeedsUpdate: boolean } {
  const merged: Record<string, BookReflection> = { ...(cloud || {}) };
  let cloudNeedsUpdate = false;
  for (const [bookId, ref] of Object.entries(local || {})) {
    if (!ref) continue;
    if (!merged[bookId] || (ref.completedAt || 0) > (merged[bookId].completedAt || 0)) {
      merged[bookId] = ref;
      cloudNeedsUpdate = true;
    }
  }
  return { merged, cloudNeedsUpdate };
}

/** Shelf dismissals are a set of (section, book) flags, so they are unioned. */
export function mergeShelfDismissalMaps(
  cloud: ShelfDismissalsMap = {},
  local: ShelfDismissalsMap = {}
): { merged: ShelfDismissalsMap; cloudNeedsUpdate: boolean } {
  const merged: ShelfDismissalsMap = {};
  for (const [sec, m] of Object.entries(cloud || {})) merged[sec] = { ...(m || {}) };
  let cloudNeedsUpdate = false;
  for (const [sec, m] of Object.entries(local || {})) {
    for (const [bookId, flag] of Object.entries(m || {})) {
      if (!flag) continue;
      if (!merged[sec]?.[bookId]) cloudNeedsUpdate = true;
      merged[sec] = { ...(merged[sec] || {}), [bookId]: true };
    }
  }
  return { merged, cloudNeedsUpdate };
}

/** Active time: per-day maxima (never summed, so re-running cannot double count). */
export function mergeActiveTime(
  cloud: Partial<WebsiteActiveTimeData> | undefined,
  local: Partial<WebsiteActiveTimeData> | undefined
): { merged: WebsiteActiveTimeData; cloudNeedsUpdate: boolean } {
  const c = cloud || {};
  const l = local || {};
  const maxDaily = (a: Record<string, number> = {}, b: Record<string, number> = {}) => {
    const out: Record<string, number> = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = Math.max(out[k] || 0, Number(v) || 0);
    return out;
  };
  const merged: WebsiteActiveTimeData = {
    totalActiveSeconds: Math.max(c.totalActiveSeconds || 0, l.totalActiveSeconds || 0),
    daily: maxDaily(c.daily, l.daily),
    explorationDaily: maxDaily(c.explorationDaily, l.explorationDaily),
    totalExplorationSeconds: Math.max(c.totalExplorationSeconds || 0, l.totalExplorationSeconds || 0),
    lastUpdated: Math.max(c.lastUpdated || 0, l.lastUpdated || 0),
  };
  const cloudNeedsUpdate =
    merged.totalActiveSeconds > (c.totalActiveSeconds || 0) ||
    Object.entries(l.daily || {}).some(([k, v]) => (Number(v) || 0) > ((c.daily || {})[k] || 0));
  return { merged, cloudNeedsUpdate };
}

export interface AccountSnapshot {
  favorites?: string[];
  readingHistory?: ReadingProgressItem[];
  completedBookIds?: string[];
  collections?: ReadingCollection[];
  reflections?: Record<string, BookReflection>;
  bookmarks?: Record<string, BookmarkItem[]>;
  annotations?: Record<string, Partial<BookAnnotations>>;
  readingMemories?: Record<string, BookReadingMemory>;
  certificates?: Record<string, unknown>;
}

/**
 * Lists every important record held on this device that the cloud copy does not contain.
 * Used to verify a backfill by reading the cloud back; an empty list means the cloud holds a complete copy.
 */
export function findItemsMissingFromCloud(local: AccountSnapshot, cloud: AccountSnapshot): string[] {
  const missing: string[] = [];

  const favs = new Set(cloud.favorites || []);
  for (const id of local.favorites || []) if (!favs.has(id)) missing.push(`favorite:${id}`);

  const progress = new Map((cloud.readingHistory || []).map((h) => [h.bookId, h]));
  for (const h of local.readingHistory || []) {
    const c = progress.get(h.bookId);
    if (!c || (c.page || 0) < (h.page || 0)) missing.push(`progress:${h.bookId}`);
  }

  const completed = new Set(cloud.completedBookIds || []);
  for (const id of local.completedBookIds || []) if (!completed.has(id)) missing.push(`completed:${id}`);

  const cols = new Map((cloud.collections || []).map((c) => [c.id, c]));
  for (const c of local.collections || []) {
    const cc = cols.get(c.id);
    if (!cc) missing.push(`collection:${c.id}`);
    else for (const b of c.bookIds || []) if (!(cc.bookIds || []).includes(b)) missing.push(`collection:${c.id}:${b}`);
  }

  for (const id of Object.keys(local.reflections || {})) if (!(cloud.reflections || {})[id]) missing.push(`reflection:${id}`);

  for (const [bookId, list] of Object.entries(local.bookmarks || {})) {
    const cloudList = (cloud.bookmarks || {})[bookId] || [];
    const ids = new Set(cloudList.map((b) => b.id));
    const pages = new Set(cloudList.map((b) => b.page));
    // Bookmarks are one per page, so a bookmark on a page the cloud already has is not missing
    for (const b of list || []) if (!ids.has(b.id) && !pages.has(b.page)) missing.push(`bookmark:${bookId}:${b.id}`);
  }

  for (const [bookId, ann] of Object.entries(local.annotations || {})) {
    const c = (cloud.annotations || {})[bookId] || {};
    const hl = new Set((c.highlights || []).map((x) => x.id));
    const nt = new Set((c.notes || []).map((x) => x.id));
    for (const h of ann.highlights || []) if (!hl.has(h.id)) missing.push(`highlight:${bookId}:${h.id}`);
    for (const n of ann.notes || []) if (!nt.has(n.id)) missing.push(`note:${bookId}:${n.id}`);
    for (const page of Object.keys(ann.drawings || {})) {
      if (!(c.drawings || {})[page as unknown as number]) missing.push(`drawing:${bookId}:${page}`);
    }
  }

  for (const [bookId, mem] of Object.entries(local.readingMemories || {})) {
    const c = (cloud.readingMemories || {})[bookId];
    if (!c || (c.totalSeconds || 0) < (mem.totalSeconds || 0)) missing.push(`memory:${bookId}`);
  }

  for (const id of Object.keys(local.certificates || {})) if (!(cloud.certificates || {})[id]) missing.push(`certificate:${id}`);
  return missing;
}
