/**
 * Verified page counts: the real number of pages in each book's PDF (PDF.js numPages, cross-checked with
 * pdf-lib), measured by `scripts/audit-catalogue.ts` and stored in data/pdf-page-counts.json.
 *
 * This is the only source for a book's total pages when the PDF itself is not open. There is deliberately
 * no default: an unknown total is `null`, never a guessed number like 100.
 */

import pageCounts from "@/data/pdf-page-counts.json";

const COUNTS = (pageCounts as { counts: Record<string, number> }).counts || {};

export function getVerifiedPageCount(bookId: string | null | undefined): number | null {
  if (!bookId) return null;
  const n = COUNTS[bookId];
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : null;
}

/** Percentage read; 0 when the total is unknown (an unknown denominator never produces 100%). */
export function progressPercent(page: number, totalPages: number): number {
  if (!(totalPages > 0) || !(page > 0)) return 0;
  return Math.min(100, Math.round((page / totalPages) * 100));
}
