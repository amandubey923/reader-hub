/**
 * Reader's HUB — Pure progress & merge rules shared by local storage, cloud sync, migration and import.
 * No browser or Firebase dependencies, so these rules are unit-testable.
 */

import type {
  BookAnnotations,
  BookmarkItem,
  BookReadingMemory,
  ReadingProgressItem,
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
