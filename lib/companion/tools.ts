/**
 * Allow-listed companion actions: declarations for the model and strict argument validation.
 * Validation runs twice — on the server (model output) and again on the client against the live reader.
 */

import type { CompanionAction, CompanionActionName } from "./types";
import { isSafeBookId } from "@/lib/reading-merge";

export const NOTE_MAX_CHARS = 1000;

interface ActionSpec {
  description: string;
  parameters: Record<string, unknown>;
  /** Writes reader data (bookmarks/notes): the user must confirm before it runs. */
  needsConfirmation: boolean;
  /** Only meaningful while a book is open in the reader. */
  needsReader: boolean;
}

export const ACTION_SPECS: Record<CompanionActionName, ActionSpec> = {
  go_to_page: {
    description: "Move the open PDF reader to a specific page number of the current book.",
    parameters: {
      type: "object",
      properties: { page: { type: "integer", description: "1-based page number within the current book" } },
      required: ["page"],
    },
    needsConfirmation: false,
    needsReader: true,
  },
  next_page: {
    description: "Turn to the next page (or spread) in the open book.",
    parameters: { type: "object", properties: {} },
    needsConfirmation: false,
    needsReader: true,
  },
  previous_page: {
    description: "Turn back to the previous page (or spread) in the open book.",
    parameters: { type: "object", properties: {} },
    needsConfirmation: false,
    needsReader: true,
  },
  open_book: {
    description: "Open a book from the Reader's HUB catalog. Only use when the reader explicitly asks to open or read a specific book.",
    parameters: {
      type: "object",
      properties: { bookId: { type: "string", description: "Exact catalog book ID" } },
      required: ["bookId"],
    },
    needsConfirmation: false,
    needsReader: false,
  },
  bookmark_page: {
    description: "Bookmark a page in the open book (defaults to the current page). The reader will be asked to confirm.",
    parameters: {
      type: "object",
      properties: { page: { type: "integer", description: "Optional 1-based page; defaults to the current page" } },
    },
    needsConfirmation: true,
    needsReader: true,
  },
  add_note: {
    description: "Save a short note on a page of the open book (defaults to the current page). The reader will be asked to confirm.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "The note text, written for the reader" },
        page: { type: "integer", description: "Optional 1-based page; defaults to the current page" },
      },
      required: ["text"],
    },
    needsConfirmation: true,
    needsReader: true,
  },
};

export const ACTION_NAMES = Object.keys(ACTION_SPECS) as CompanionActionName[];

export interface ActionEnvironment {
  /** Present only while a book is loaded in the reader. */
  reader?: { totalPages: number; currentPage: number };
  bookExists: (bookId: string) => boolean;
}

export type ActionValidation =
  | { ok: true; action: CompanionAction }
  | { ok: false; error: string };

const toPage = (value: unknown): number | null => {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) ? n : null;
};

/**
 * Validates a proposed action and returns a normalised copy (unknown arguments are dropped).
 */
export function validateAction(raw: { name?: unknown; args?: unknown }, env: ActionEnvironment): ActionValidation {
  const name = raw?.name;
  if (typeof name !== "string" || !(ACTION_NAMES as string[]).includes(name)) {
    return { ok: false, error: "Unknown action." };
  }
  const spec = ACTION_SPECS[name as CompanionActionName];
  const args = raw.args && typeof raw.args === "object" && !Array.isArray(raw.args) ? (raw.args as Record<string, unknown>) : {};

  if (spec.needsReader && !env.reader) {
    return { ok: false, error: "No book is open in the reader." };
  }

  const pageInRange = (page: number) => !!env.reader && page >= 1 && page <= env.reader.totalPages;

  switch (name as CompanionActionName) {
    case "go_to_page": {
      const page = toPage(args.page);
      if (page === null || !pageInRange(page)) {
        return { ok: false, error: `Page must be a whole number between 1 and ${env.reader?.totalPages ?? "the last page"}.` };
      }
      return { ok: true, action: { name: "go_to_page", args: { page } } };
    }
    case "next_page":
      if (env.reader!.currentPage >= env.reader!.totalPages) return { ok: false, error: "Already on the last page." };
      return { ok: true, action: { name: "next_page", args: {} } };
    case "previous_page":
      if (env.reader!.currentPage <= 1) return { ok: false, error: "Already on the first page." };
      return { ok: true, action: { name: "previous_page", args: {} } };
    case "open_book": {
      const bookId = typeof args.bookId === "string" ? args.bookId.trim() : "";
      if (!isSafeBookId(bookId) || !env.bookExists(bookId)) {
        return { ok: false, error: "That book is not in the Reader's HUB catalog." };
      }
      return { ok: true, action: { name: "open_book", args: { bookId } } };
    }
    case "bookmark_page": {
      const page = args.page === undefined || args.page === null ? env.reader!.currentPage : toPage(args.page);
      if (page === null || !pageInRange(page)) return { ok: false, error: "That page is outside this book." };
      return { ok: true, action: { name: "bookmark_page", args: { page } } };
    }
    case "add_note": {
      const text = typeof args.text === "string" ? args.text.trim() : "";
      if (!text || text.length > NOTE_MAX_CHARS) {
        return { ok: false, error: `A note needs between 1 and ${NOTE_MAX_CHARS} characters.` };
      }
      const page = args.page === undefined || args.page === null ? env.reader!.currentPage : toPage(args.page);
      if (page === null || !pageInRange(page)) return { ok: false, error: "That page is outside this book." };
      return { ok: true, action: { name: "add_note", args: { page, text } } };
    }
  }
}

export function actionNeedsConfirmation(action: CompanionAction): boolean {
  return ACTION_SPECS[action.name].needsConfirmation;
}

/** Human-readable description used in confirmation prompts. */
export function describeAction(action: CompanionAction, bookTitle?: (id: string) => string | undefined): string {
  switch (action.name) {
    case "go_to_page":
      return `Go to page ${action.args.page}`;
    case "next_page":
      return "Turn to the next page";
    case "previous_page":
      return "Turn to the previous page";
    case "open_book":
      return `Open “${bookTitle?.(String(action.args.bookId)) ?? action.args.bookId}”`;
    case "bookmark_page":
      return `Bookmark page ${action.args.page}`;
    case "add_note":
      return `Save a note on page ${action.args.page}: “${String(action.args.text).slice(0, 120)}”`;
  }
}
