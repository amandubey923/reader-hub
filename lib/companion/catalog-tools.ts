/**
 * Server-executed, read-only catalog tools the companion model can call (search + details).
 * They only expose public catalog metadata from data/books.json.
 */

import { BOOKS, Book } from "@/data/books";
import { tokenize } from "./retrieval";
import type { CompanionBookCard } from "./types";

export const CATALOG_TOOL_DECLARATIONS = [
  {
    name: "search_catalog",
    description:
      "Search the Reader's HUB catalog by topic, title, author, category or language. Use it before recommending or comparing books; never recommend books that are not returned.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text topic, title or author keywords" },
        category: { type: "string", description: "Optional exact category name" },
        language: { type: "string", description: "Optional language, e.g. English or Hindi" },
        limit: { type: "integer", description: "Maximum results (1-8)" },
      },
    },
  },
  {
    name: "get_book_details",
    description: "Get verified catalog details for one book by its exact ID.",
    parametersJsonSchema: {
      type: "object",
      properties: { bookId: { type: "string" } },
      required: ["bookId"],
    },
  },
];

export const CATALOG_TOOL_NAMES = new Set(CATALOG_TOOL_DECLARATIONS.map((t) => t.name));

const BOOK_BY_ID = new Map(BOOKS.map((b) => [b.id, b]));

export function catalogBookExists(bookId: string): boolean {
  return BOOK_BY_ID.has(bookId);
}

export function getCatalogBook(bookId: string): Book | undefined {
  return BOOK_BY_ID.get(bookId);
}

export function toBookCard(book: Book): CompanionBookCard {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    cover: book.cover,
    category: book.category,
    language: book.language,
  };
}

function summarizeBook(book: Book) {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    category: book.category,
    language: book.language,
    year: book.year,
    pages: book.pages,
    rating: book.rating,
    tags: (book.tags || []).slice(0, 6),
    description: (book.description || "").slice(0, 280),
  };
}

export function searchCatalog(args: { query?: unknown; category?: unknown; language?: unknown; limit?: unknown }) {
  const query = typeof args.query === "string" ? args.query.slice(0, 200) : "";
  const category = typeof args.category === "string" ? args.category.trim().toLowerCase() : "";
  const language = typeof args.language === "string" ? args.language.trim().toLowerCase() : "";
  const limit = Math.min(8, Math.max(1, Number.isInteger(args.limit) ? (args.limit as number) : 6));
  const terms = tokenize(query);

  const scored = BOOKS.map((book) => {
    if (category && book.category.toLowerCase() !== category) return null;
    if (language && !book.language.toLowerCase().includes(language)) return null;
    if (!terms.length) return { book, score: book.rating || 0 };

    const title = book.title.toLowerCase();
    const author = book.author.toLowerCase();
    const tags = (book.tags || []).join(" ").toLowerCase();
    const body = `${book.category} ${book.description}`.toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (title.includes(t)) score += 5;
      if (author.includes(t)) score += 4;
      if (tags.includes(t)) score += 3;
      if (body.includes(t)) score += 1;
    }
    return score > 0 ? { book, score: score + (book.rating || 0) / 10 } : null;
  }).filter((x): x is { book: Book; score: number } => Boolean(x));

  scored.sort((a, b) => b.score - a.score);
  return { results: scored.slice(0, limit).map((s) => summarizeBook(s.book)), totalMatches: scored.length };
}

export function getBookDetails(args: { bookId?: unknown }) {
  const book = typeof args.bookId === "string" ? BOOK_BY_ID.get(args.bookId.trim()) : undefined;
  return book ? { book: summarizeBook(book) } : { error: "No book with that ID exists in the catalog." };
}

export function runCatalogTool(name: string, args: Record<string, unknown>) {
  if (name === "search_catalog") return searchCatalog(args);
  if (name === "get_book_details") return getBookDetails(args);
  return { error: "Unknown tool." };
}
