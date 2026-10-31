/**
 * Server-executed, read-only catalog tools the companion model can call (search + details).
 * They only expose public catalog metadata from data/books.json.
 */

import { BOOKS, Book } from "@/data/books";
import { tokenize } from "./retrieval";
import { searchCatalog as rankCatalog } from "@/lib/search/catalog-search";
import { getPageCount } from "@/lib/search/book-meta";
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
    pages: getPageCount(book),
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
  // Stopwords are dropped so natural phrasing ("books about stoicism for beginners") still ranks well
  const terms = tokenize(query);

  const inScope = (book: Book) =>
    (!category || book.category.toLowerCase() === category) && (!language || book.language.toLowerCase().includes(language));

  // Same ranked, typo-tolerant engine as the site search
  const ranked = terms.length
    ? rankCatalog(terms.join(" ")).hits.map((h) => h.book).filter(inScope)
    : BOOKS.filter(inScope).sort((a, b) => (b.rating || 0) - (a.rating || 0));

  return { results: ranked.slice(0, limit).map(summarizeBook), totalMatches: ranked.length };
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
