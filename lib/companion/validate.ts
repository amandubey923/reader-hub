/**
 * Strict validation and size-capping of /api/companion request bodies.
 */

import { isSafeBookId } from "@/lib/reading-merge";
import { catalogBookExists } from "./catalog-tools";
import type { CompanionReaderContext, CompanionRequest, CompanionTurn, PageText, RetrievedPassage } from "./types";

export const COMPANION_LIMITS = {
  messages: 14,
  messageChars: 1500,
  visiblePages: 2,
  pageChars: 6000,
  selectionChars: 2000,
  chapterChars: 160,
  retrieved: 5,
  passageChars: 1400,
};

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const clip = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max).trim() : "");

export type CompanionValidation = { ok: true; value: CompanionRequest } | { ok: false; error: string };

export function validateCompanionRequest(body: unknown): CompanionValidation {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid request." };
  const raw = body as Record<string, unknown>;

  if (!Array.isArray(raw.messages) || raw.messages.length === 0) {
    return { ok: false, error: "A message is required." };
  }
  const messages: CompanionTurn[] = raw.messages
    .filter((m: any) => m && (m.role === "user" || m.role === "assistant") && typeof m.text === "string")
    .map((m: any) => ({ role: m.role, text: clip(m.text, COMPANION_LIMITS.messageChars) }))
    .filter((m) => m.text.length > 0)
    .slice(-COMPANION_LIMITS.messages);

  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return { ok: false, error: "The last message must come from the reader." };
  }

  let reader: CompanionReaderContext | undefined;
  if (raw.reader !== undefined && raw.reader !== null) {
    const r = raw.reader as Record<string, unknown>;
    const bookId = typeof r.bookId === "string" ? r.bookId : "";
    if (!isSafeBookId(bookId) || !catalogBookExists(bookId)) return { ok: false, error: "Unknown book." };
    if (!isInt(r.totalPages) || r.totalPages < 1 || r.totalPages > 100000) return { ok: false, error: "Invalid page count." };
    const totalPages = r.totalPages;
    if (!isInt(r.currentPage) || r.currentPage < 1 || r.currentPage > totalPages) return { ok: false, error: "Invalid page." };

    const inBook = (p: unknown): p is number => isInt(p) && p >= 1 && p <= totalPages;
    const pages = (list: unknown, max: number, chars: number): PageText[] =>
      Array.isArray(list)
        ? list
            .filter((p: any) => p && inBook(p.pageNum) && typeof p.text === "string")
            .slice(0, max)
            .map((p: any) => ({ pageNum: p.pageNum, text: clip(p.text, chars) }))
        : [];

    const selectionRaw = r.selection as Record<string, unknown> | undefined;
    const selectionText = selectionRaw ? clip(selectionRaw.text, COMPANION_LIMITS.selectionChars) : "";

    reader = {
      bookId,
      currentPage: r.currentPage,
      totalPages,
      visiblePages: pages(r.visiblePages, COMPANION_LIMITS.visiblePages, COMPANION_LIMITS.pageChars),
      selection: selectionText
        ? { text: selectionText, pageNum: inBook(selectionRaw?.pageNum) ? (selectionRaw!.pageNum as number) : undefined }
        : undefined,
      chapter: clip(r.chapter, COMPANION_LIMITS.chapterChars) || undefined,
      retrieved: pages(r.retrieved, COMPANION_LIMITS.retrieved, COMPANION_LIMITS.passageChars) as RetrievedPassage[],
      bookIndexStatus: r.bookIndexStatus === "lexical" || r.bookIndexStatus === "semantic" ? r.bookIndexStatus : "none",
    };
  }

  return { ok: true, value: { messages, reader } };
}
