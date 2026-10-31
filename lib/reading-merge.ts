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

export const DEFAULT_TOTAL_PAGES = 100;

export interface ReadingProgressComputation {
  item: ReadingProgressItem;
  changed: boolean;
  isNewCompletion: boolean;
}

/**
 * Computes the next progress record for a book.
 * Omitted (or non-positive) page/totalPages keep the existing values instead of falling back to defaults,
 * so a caller that only knows the book ID can never rewrite real page counts.
 */
export function computeReadingProgress(
  existing: ReadingProgressItem | undefined,
  bookId: string,
  page?: number,
  totalPages?: number,
  catalogPages: number = 0,
  now: number = Date.now()
): ReadingProgressComputation {
  // page <= 1 is treated as "unspecified" (existing behaviour: re-opening a book never rewinds saved progress)
  const curPage = page && page > 1 ? page : existing && existing.page > 0 ? existing.page : 1;
  const curTotal =
    totalPages && totalPages > 0
      ? totalPages
      : existing && existing.totalPages > 0
      ? existing.totalPages
      : catalogPages > 0
      ? catalogPages
      : DEFAULT_TOTAL_PAGES;
  const progress = Math.min(100, Math.round((curPage / curTotal) * 100));

  const wasCompleted = Boolean(
    existing && ((existing.totalPages > 0 && existing.page >= existing.totalPages) || existing.progress >= 100)
  );
  const isCompleted = curPage >= curTotal;

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
 * Merges two progress records for the same book: furthest page wins, latest timestamp is kept.
 */
export function mergeProgressItems(a: ReadingProgressItem, b: ReadingProgressItem): ReadingProgressItem {
  const page = Math.max(a.page || 1, b.page || 1);
  const totalPages = Math.max(a.totalPages || 0, b.totalPages || 0) || DEFAULT_TOTAL_PAGES;
  return {
    bookId: a.bookId || b.bookId,
    page,
    totalPages,
    progress: Math.max(a.progress || 0, b.progress || 0, Math.min(100, Math.round((page / totalPages) * 100))),
    lastReadAt: Math.max(a.lastReadAt || 0, b.lastReadAt || 0),
  };
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
 * Book IDs are used inside storage keys; reject anything that could collide with the key scheme.
 */
export function isSafeBookId(id: unknown): id is string {
  return typeof id === "string" && /^[^:\s]{1,200}$/.test(id);
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
