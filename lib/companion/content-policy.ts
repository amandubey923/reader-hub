/**
 * Content-handling policy for the AI Reading Companion, derived from data/content-rights-audit.json.
 * Server-only (keeps the audit data out of client bundles).
 *
 * - Page-level help (the pages the reader has open, or their selection) is allowed for every book.
 *   This matches the scope of the existing page translation feature: user-initiated, at most one spread.
 * - Book-wide indexing, retrieval and embeddings are allowed only for titles the audit classifies as
 *   public domain or openly licensed. Everything else (review required, potentially infringing,
 *   unknown, or not yet audited) stays page-level only.
 */

import auditData from "@/data/content-rights-audit.json";

export const BOOK_WIDE_ALLOWED_CLASSIFICATIONS = new Set([
  "PUBLIC_DOMAIN",
  "OPEN_LICENSE",
  "OFFICIAL_FREE_SOURCE",
  "COPYRIGHT_OWNER_AUTHORIZED",
]);

const classificationById = new Map<string, string>();
for (const rec of ((auditData as any).records || []) as Array<{ id: string; classification: string }>) {
  if (rec && typeof rec.id === "string") classificationById.set(rec.id, rec.classification);
}

export interface BookContentPolicy {
  bookId: string;
  classification: string;
  bookWideAllowed: boolean;
  reason: string;
}

export function getBookContentPolicy(bookId: string): BookContentPolicy {
  const classification = classificationById.get(bookId) || "NOT_AUDITED";
  const bookWideAllowed = BOOK_WIDE_ALLOWED_CLASSIFICATIONS.has(classification);
  return {
    bookId,
    classification,
    bookWideAllowed,
    reason: bookWideAllowed
      ? "Rights audit: public domain or open licence. Whole-book search is available."
      : "Rights for this title are not cleared for whole-book processing, so Bodhi helps with the pages you have open.",
  };
}
