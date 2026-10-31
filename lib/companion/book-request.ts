/**
 * Recognises clear "open/read <book> [by <author>]" requests and resolves them against the catalogue,
 * so Bodhi answers with exactly one book and one Open action instead of asking the model (and the reader)
 * the same question again. Anything ambiguous returns null and goes to the model as before.
 */

import type { Book } from "@/data/books";
import { editDistance, normalizeText, searchCatalog } from "@/lib/search/catalog-search";
import { isSameAuthor } from "@/lib/recommendations";

const MAX_REQUEST_LENGTH = 90;

// "open X", "please open X", "can you open X", "read X", "start reading X", "X kholo", "X खोलो"
const LEADING = /^(?:(?:please|pls|can you|could you|bodhi)\s+)*(?:open(?:\s+up)?|read|start reading|show me|kholo)\s+(.+)$/i;
const TRAILING = /^(.+?)\s+(?:kholo|khol do|padho|खोलो|खोल दो)$/i;
const QUESTION = /\?|\b(what|why|how|who|when|where|which|explain|summari[sz]e|kya|kyun|kaise)\b/i;

// Things readers "open" inside the app that are not books
const NOT_A_BOOK = /^(?:the\s+|my\s+)?(?:next|previous|prev|page|pages|chapter|chapters|bookmarks?|notes?|highlights?|menu|settings|library|shelf|search|this|it|fullscreen|full screen)\b/i;

const STOP_WORDS = new Set(["the", "a", "an", "of", "and", "ka", "ki", "ke"]);

/** Every word the reader said must really be in the title (a fragment like "kam" is not a clear request). */
function wordsAreInTitle(query: string, title: string): boolean {
  const titleWords = normalizeText(title).split(" ");
  const words = normalizeText(query).split(" ").filter((w) => w && !STOP_WORDS.has(w));
  return (
    words.length > 0 &&
    words.every((q) => {
      const typos = q.length >= 8 ? 2 : q.length >= 4 ? 1 : 0;
      return titleWords.some((w) => w === q || (q.length >= 5 && w.startsWith(q)) || (typos > 0 && editDistance(q, w, typos) <= typos));
    })
  );
}

export interface BookRequestMatch {
  book: Book;
}

function cleanTitle(text: string): string {
  return text
    .replace(/^(?:the\s+)?(?:book|novel|kitab|किताब)\s+(?:called\s+|named\s+)?/i, "")
    .replace(/\s+(?:book|novel|kitab|किताब)$/i, "")
    .replace(/["“”'‘’]/g, "")
    .trim();
}

/** The single clearly-intended book for a title (and optional author), or null when unsure. */
function resolve(title: string, author?: string): Book | null {
  const t = cleanTitle(title);
  if (normalizeText(t).length < 3) return null;
  const hits = searchCatalog(author ? `${t} ${author}` : t).hits.filter((h) => h.complete);
  const titleHits = searchCatalog(t).hits.filter((h) => h.complete && h.matchedField === "title");
  if (titleHits.length === 0) return null;

  let candidates = titleHits;
  if (author) {
    const authorHits = new Set(searchCatalog(author).hits.filter((h) => h.complete).map((h) => h.book.id));
    candidates = titleHits.filter((h) => authorHits.has(h.book.id) || hits.some((x) => x.book.id === h.book.id && x.matchedField === "author"));
    if (candidates.length === 0) return null;
  }

  const [top, second] = candidates;
  if (!wordsAreInTitle(t, top.book.title)) return null;
  const normTitle = normalizeText(top.book.title);
  const normQuery = normalizeText(t);
  const exactish = normTitle === normQuery || normTitle.startsWith(normQuery) || normQuery.startsWith(normTitle);
  // Several editions/volumes by the same author (or very close scores) are ambiguous: let the model ask once
  const clearLead = !second || top.score >= second.score * 1.25 || (exactish && !normalizeText(second.book.title).startsWith(normQuery));
  if (!clearLead) return null;
  if (author && !isSameAuthor(top.book.author, author) && !searchCatalog(author).hits.some((h) => h.book.id === top.book.id)) return null;
  return top.book;
}

export function resolveBookRequest(input: string): BookRequestMatch | null {
  const text = (input || "").trim().replace(/[.!।]+$/u, "").replace(/\s+/g, " ");
  if (!text || text.length > MAX_REQUEST_LENGTH || QUESTION.test(text)) return null;

  const rest = text.match(LEADING)?.[1] ?? text.match(TRAILING)?.[1];
  if (!rest || NOT_A_BOOK.test(rest)) return null;

  // "kamayani book by jaishankar prasad" / "kamayani of jaishankar" — try title + author first
  const split = rest.match(/^(.+?)\s+(?:book\s+|novel\s+)?(?:by|of|written by|ki|की)\s+(.+)$/i);
  if (split && cleanTitle(split[1])) {
    const book = resolve(split[1], split[2]);
    if (book) return { book };
  }
  const book = resolve(rest);
  return book ? { book } : null;
}
