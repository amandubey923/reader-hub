/**
 * Derived, verifiable discovery metadata for catalogue books (no invented data).
 * - Page counts come from the measured PDFs (data/pdf-page-counts.json) and fall back to the catalogue value.
 * - Sub-groups reuse the existing Technical / Philosophy matching rules from data/books.ts.
 */

import pageCounts from "@/data/pdf-page-counts.json";
import {
  Book,
  BOOKS,
  PHILOSOPHY_SUBCATEGORIES,
  TECHNICAL_SUBCATEGORIES,
  isTechnicalBook,
  matchesPhilosophySubcategory,
  matchesTechnicalSubcategory,
} from "@/data/books";

const MEASURED: Record<string, number> = (pageCounts as { counts: Record<string, number> }).counts || {};

export type LengthBucket = "short" | "medium" | "long" | "epic";

export const LENGTH_BUCKETS: { id: LengthBucket; label: string; hint: string; min: number; max: number }[] = [
  { id: "short", label: "Short", hint: "up to 150 pages", min: 1, max: 150 },
  { id: "medium", label: "Medium", hint: "151–400 pages", min: 151, max: 400 },
  { id: "long", label: "Long", hint: "401–1,000 pages", min: 401, max: 1000 },
  { id: "epic", label: "Epic", hint: "1,000+ pages", min: 1001, max: Infinity },
];

export const RESOURCE_TYPE_LABELS: Record<string, string> = {
  Book: "Books",
  Notes: "Notes",
  HandwrittenNotes: "Handwritten notes",
  CheatSheet: "Cheat sheets",
  InterviewPrep: "Interview prep",
};

/** Real page count: measured from the PDF when available, otherwise the catalogue value (if plausible). */
export function getPageCount(book: Book): number | null {
  const measured = MEASURED[book.id];
  if (measured && measured > 0) return measured;
  const listed = Number(book.pages);
  return Number.isFinite(listed) && listed > 0 ? listed : null;
}

export function getLengthBucket(book: Book): LengthBucket | null {
  const pages = getPageCount(book);
  if (!pages) return null;
  return LENGTH_BUCKETS.find((b) => pages >= b.min && pages <= b.max)?.id ?? null;
}

/** Book type for every book (books without a resourceType are regular books). */
export function getResourceType(book: Book): string {
  return book.resourceType || "Book";
}

const SUBGROUP_CACHE = new Map<string, string[]>();

/** Technical tracks and philosophical traditions a book belongs to (existing matching rules). */
export function getSubgroups(book: Book): string[] {
  const cached = SUBGROUP_CACHE.get(book.id);
  if (cached) return cached;
  const groups: string[] = [];
  if (isTechnicalBook(book)) {
    for (const sub of TECHNICAL_SUBCATEGORIES) {
      if (sub !== "All Technical" && matchesTechnicalSubcategory(book, sub)) groups.push(sub);
    }
  }
  if (book.category === "Philosophy & Spirituality") {
    for (const sub of PHILOSOPHY_SUBCATEGORIES) {
      if (sub !== "All Philosophy" && matchesPhilosophySubcategory(book, sub)) groups.push(sub);
    }
  }
  SUBGROUP_CACHE.set(book.id, groups);
  return groups;
}

/** Categories a book is listed under for filtering (Technical Knowledge keeps its existing broader rule). */
export function getFilterCategories(book: Book): string[] {
  const cats = [book.category];
  if (isTechnicalBook(book) && book.category !== "Technical Knowledge") cats.push("Technical Knowledge");
  return cats;
}

export const ALL_LANGUAGES: string[] = (() => {
  const counts = new Map<string, number>();
  BOOKS.forEach((b) => b.language && counts.set(b.language, (counts.get(b.language) || 0) + 1));
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([lang]) => lang);
})();

export const ALL_AUTHORS: string[] = Array.from(new Set(BOOKS.map((b) => b.author))).sort((a, b) => a.localeCompare(b));
