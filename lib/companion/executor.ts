"use client";

/**
 * Client-side execution of validated companion actions.
 * Every action is re-validated against the live reader, and success is reported only after the
 * reader state confirms it (page actually changed, bookmark actually stored, book actually opened).
 */

import { BOOKS } from "@/data/books";
import { getReaderBridge, waitForReader } from "./reader-bridge";
import { validateAction } from "./tools";
import type { CompanionAction } from "./types";

export interface ActionOutcome {
  ok: boolean;
  message: string;
}

const BOOK_BY_ID = new Map(BOOKS.map((b) => [b.id, b]));

export function catalogTitle(bookId: string): string | undefined {
  return BOOK_BY_ID.get(bookId)?.title;
}

export function liveActionEnvironment() {
  const snap = getReaderBridge()?.getSnapshot();
  return {
    reader: snap && snap.isLoaded ? { totalPages: snap.totalPages, currentPage: snap.currentPage } : undefined,
    bookExists: (id: string) => BOOK_BY_ID.has(id),
  };
}

export async function executeAction(
  proposed: CompanionAction,
  navigate: (href: string) => void
): Promise<ActionOutcome> {
  const check = validateAction(proposed, liveActionEnvironment());
  if (!check.ok) return { ok: false, message: check.error };
  const action = check.action;
  const bridge = getReaderBridge();
  const start = bridge?.getSnapshot();

  switch (action.name) {
    case "go_to_page": {
      const page = action.args.page as number;
      if (!bridge?.goToPage(page)) return { ok: false, message: `Couldn't move to page ${page}.` };
      const snap = await waitForReader((s) => s.visiblePages.includes(page) || s.currentPage === page);
      return snap ? { ok: true, message: `Now on page ${page}.` } : { ok: false, message: `The reader didn't reach page ${page}.` };
    }
    case "next_page":
    case "previous_page": {
      const before = start?.currentPage ?? 0;
      const moved = action.name === "next_page" ? bridge?.nextPage() : bridge?.previousPage();
      if (!moved) return { ok: false, message: "Couldn't turn the page." };
      const snap = await waitForReader((s) => (action.name === "next_page" ? s.currentPage > before : s.currentPage < before));
      return snap
        ? { ok: true, message: `Now on page ${snap.visiblePages.length > 1 ? `${snap.visiblePages[0]}–${snap.visiblePages[snap.visiblePages.length - 1]}` : snap.currentPage}.` }
        : { ok: false, message: "The page didn't change." };
    }
    case "open_book": {
      const bookId = action.args.bookId as string;
      const title = catalogTitle(bookId) || bookId;
      if (start?.bookId === bookId) return { ok: true, message: `“${title}” is already open.` };
      navigate(`/book/${bookId}`);
      const snap = await waitForReader((s) => s.bookId === bookId, 15000);
      return snap ? { ok: true, message: `Opened “${title}”.` } : { ok: false, message: `“${title}” is still loading. It will open in a moment.` };
    }
    case "bookmark_page": {
      const page = action.args.page as number;
      const result = bridge?.addBookmark(page);
      if (!result?.ok) return { ok: false, message: `Couldn't bookmark page ${page}.` };
      return { ok: true, message: result.alreadyExisted ? `Page ${page} was already bookmarked.` : `Bookmarked page ${page}.` };
    }
    case "add_note": {
      const page = action.args.page as number;
      return bridge?.addNote(page, action.args.text as string)
        ? { ok: true, message: `Saved your note on page ${page}.` }
        : { ok: false, message: `Couldn't save the note on page ${page}.` };
    }
  }
}
