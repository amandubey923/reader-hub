/**
 * Reader's HUB — unified local catalogue search.
 *
 * One ranked, typo-tolerant search used by the home page, /library, the navbar search and the assistants.
 * Built once over the static catalogue (430 books); a query typically takes a few milliseconds, so no search
 * library or server round-trip is needed.
 */

import { Book, BOOKS } from "@/data/books";
import { RESOURCE_TYPE_LABELS, getResourceType, getSubgroups } from "./book-meta";

// ---------------------------------------------------------------- Normalisation

/**
 * Lower-cases, folds Latin accents ("Márquez" → "marquez") and turns punctuation into spaces.
 * Only combining marks U+0300–U+036F are removed, so Devanagari vowel signs (also "marks") survive.
 */
export function normalizeText(text: string): string {
  return (text || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
    .trim();
}

export function tokenizeQuery(text: string): string[] {
  return normalizeText(text).split(" ").filter((t) => t.length > 0);
}

/** Damerau–Levenshtein distance with an early exit once `max` is exceeded. */
export function editDistance(a: string, b: string, max = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows = a.length + 1;
  const cols = b.length + 1;
  let prevPrev: number[] = new Array(cols).fill(0);
  let prev: number[] = Array.from({ length: cols }, (_, j) => j);
  for (let i = 1; i < rows; i++) {
    const cur: number[] = new Array(cols).fill(0);
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], prevPrev[j - 2] + 1);
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prevPrev = prev;
    prev = cur;
  }
  return prev[cols - 1];
}

const maxTypos = (len: number) => (len >= 8 ? 2 : len >= 4 ? 1 : 0);

/** Light English suffix stripping so "stoicism" finds "Stoic" and "beginners" finds "beginner". */
const stemOf = (token: string) => token.replace(/(isms?|ists?|ers?|ings?|es|s)$/, "");

/** Words that refine a query but should not be required to match ("osho books", "books by orwell"). */
const FILLER_WORDS = new Set(["the", "a", "an", "of", "and", "or", "by", "for", "to", "in", "on", "with", "about", "book", "books", "novel", "novels", "read", "reading", "beginner", "beginners", "intro", "introduction", "guide", "best", "good", "top", "recommend", "recommended"]);

// ---------------------------------------------------------------- Index

export type SearchField = "title" | "author" | "tags" | "category" | "subgroup" | "type" | "language" | "description";

const FIELD_WEIGHTS: Record<SearchField, number> = {
  title: 10,
  author: 8,
  tags: 4,
  category: 4,
  subgroup: 4,
  type: 3,
  language: 3,
  description: 1,
};

export const FIELD_LABELS: Record<SearchField, string> = {
  title: "title",
  author: "author",
  tags: "topic",
  category: "category",
  subgroup: "category",
  type: "type",
  language: "language",
  description: "description",
};

interface IndexedBook {
  book: Book;
  fields: Record<SearchField, string>; // normalised full text
  words: Record<SearchField, Set<string>>;
}

function buildEntry(book: Book): IndexedBook {
  const raw: Record<SearchField, string> = {
    title: book.title,
    author: book.author,
    tags: (book.tags || []).join(" "),
    category: book.category,
    subgroup: getSubgroups(book).join(" "),
    type: `${getResourceType(book)} ${RESOURCE_TYPE_LABELS[getResourceType(book)] || ""}`,
    language: book.language,
    description: book.description || "",
  };
  const fields = {} as Record<SearchField, string>;
  const words = {} as Record<SearchField, Set<string>>;
  (Object.keys(raw) as SearchField[]).forEach((f) => {
    fields[f] = normalizeText(raw[f]);
    words[f] = new Set(fields[f].split(" ").filter(Boolean));
  });
  return { book, fields, words };
}

let INDEX: IndexedBook[] | null = null;
let VOCAB: Map<string, Set<number>> | null = null; // word → indexes of books containing it (any field)
let SUGGEST_VOCAB: string[] | null = null; // title/author words, for "did you mean"

function ensureIndex() {
  if (INDEX) return;
  INDEX = BOOKS.map(buildEntry);
  VOCAB = new Map();
  const suggest = new Set<string>();
  INDEX.forEach((entry, i) => {
    (Object.keys(entry.words) as SearchField[]).forEach((f) => {
      entry.words[f].forEach((w) => {
        if (!VOCAB!.has(w)) VOCAB!.set(w, new Set());
        VOCAB!.get(w)!.add(i);
        if ((f === "title" || f === "author" || f === "tags") && w.length >= 3) suggest.add(w);
      });
    });
  });
  SUGGEST_VOCAB = Array.from(suggest);
}

/** How well a query token matches a single word: 1 exact, 0.85 prefix, 0.75 stem, 0.6 typo, 0.5 typo in prefix, 0.45 inner substring. */
function wordMatchQuality(token: string, word: string): number {
  if (word === token) return 1;
  if (token.length >= 2 && word.startsWith(token)) return 0.85;
  const allowed = maxTypos(token.length);
  if (allowed > 0 && Math.abs(word.length - token.length) <= allowed) {
    if (editDistance(token, word, allowed) <= allowed) return 0.6;
  }
  // Typo in a prefix the reader hasn't finished typing ("dostoe" → "dostoevsky")
  if (token.length >= 5 && word.length > token.length && editDistance(token, word.slice(0, token.length), 1) <= 1) return 0.5;
  const stem = stemOf(token);
  if (stem !== token && stem.length >= 4 && word.startsWith(stem)) return 0.75;
  if (token.length >= 4 && word.includes(token)) return 0.45;
  return 0;
}

/** Vocabulary words matching a token (computed once per token, then reused for every book). */
function matchingWords(token: string): Map<string, number> {
  ensureIndex();
  const out = new Map<string, number>();
  VOCAB!.forEach((_books, word) => {
    const q = wordMatchQuality(token, word);
    if (q > 0) out.set(word, q);
  });
  return out;
}

// ---------------------------------------------------------------- Search

export interface SearchHit {
  book: Book;
  score: number;
  /** Field that contributed most, e.g. "author" → "Matched author". */
  matchedField: SearchField;
  /** True when every query word matched; false for partial (fallback) results. */
  complete: boolean;
}

export interface SearchResult {
  hits: SearchHit[];
  /** Query tokens, normalised (useful for highlighting). */
  tokens: string[];
  /** Suggested corrected query when nothing matched well. */
  didYouMean?: string;
  partial: boolean;
}

const memo = new Map<string, SearchResult>();

export function searchCatalog(query: string, options: { limit?: number } = {}): SearchResult {
  const tokens = tokenizeQuery(query).slice(0, 8);
  if (tokens.length === 0) return { hits: [], tokens, partial: false };

  const key = tokens.join(" ");
  let result = memo.get(key);
  if (!result) {
    result = runSearch(tokens);
    if (memo.size > 200) memo.clear();
    memo.set(key, result);
  }
  return options.limit ? { ...result, hits: result.hits.slice(0, options.limit) } : result;
}

function runSearch(tokens: string[]): SearchResult {
  ensureIndex();
  const phrase = tokens.join(" ");
  const tokenMatches = tokens.map(matchingWords);
  const hasContentWord = tokens.some((t) => !FILLER_WORDS.has(t));
  const optional = tokens.map((t) => hasContentWord && FILLER_WORDS.has(t));
  const requiredCount = optional.filter((o) => !o).length;

  const score = (requireAll: boolean): SearchHit[] => {
    const hits: SearchHit[] = [];
    INDEX!.forEach((entry) => {
      let total = 0;
      let matchedRequired = 0;
      const fieldScores: Partial<Record<SearchField, number>> = {};

      tokenMatches.forEach((matches, ti) => {
        let best = 0;
        let bestField: SearchField | null = null;
        for (const field of Object.keys(FIELD_WEIGHTS) as SearchField[]) {
          let q = 0;
          for (const w of entry.words[field]) {
            const m = matches.get(w);
            if (m && m > q) q = m;
          }
          const s = q * FIELD_WEIGHTS[field];
          if (s > best) {
            best = s;
            bestField = field;
          }
        }
        if (bestField) {
          if (!optional[ti]) matchedRequired++;
          total += optional[ti] ? best * 0.3 : best;
          fieldScores[bestField] = (fieldScores[bestField] || 0) + best;
        }
      });

      if (matchedRequired === 0 || (requireAll && matchedRequired < requiredCount)) return;

      // Phrase bonuses: exact/prefix title, full author name, phrase inside the title
      if (entry.fields.title === phrase) total += 25;
      else if (entry.fields.title.startsWith(phrase)) total += 14;
      else if (phrase.length >= 3 && entry.fields.title.includes(phrase)) total += 8;
      if (phrase.length >= 3 && entry.fields.author.includes(phrase)) total += 10;

      // Tiny quality prior only to break ties between equally relevant books
      total += (entry.book.rating || 0) * 0.05 + (entry.book.featured ? 0.1 : 0);

      const matchedField = (Object.entries(fieldScores).sort((a, b) => (b[1] as number) - (a[1] as number))[0]?.[0] || "title") as SearchField;
      hits.push({ book: entry.book, score: total, matchedField, complete: matchedRequired === requiredCount });
    });
    return hits.sort((a, b) => b.score - a.score || a.book.title.localeCompare(b.book.title));
  };

  const complete = score(true);
  if (complete.length > 0) return { hits: complete, tokens, partial: false };

  // Nothing matched every word: offer the best partial matches and a spelling suggestion
  const partialHits = requiredCount > 1 ? score(false) : [];
  // Only suggest a correction that actually finds books matching every word
  const correction = suggestCorrection(tokens);
  const usefulCorrection = correction && searchCatalog(correction).hits.some((h) => h.complete) ? correction : undefined;
  return { hits: partialHits, tokens, partial: partialHits.length > 0, didYouMean: usefulCorrection };
}

/** Closest known title/author/topic words for misspelled tokens. */
export function suggestCorrection(tokens: string[]): string | undefined {
  ensureIndex();
  let changed = false;
  const corrected = tokens.map((t) => {
    if (VOCAB!.has(t) || t.length < 3) return t;
    let best = t;
    let bestDist = 3;
    for (const w of SUGGEST_VOCAB!) {
      if (Math.abs(w.length - t.length) > 2) continue;
      const d = editDistance(t, w, 2);
      if (d < bestDist || (d === bestDist && w.length === t.length)) {
        bestDist = d;
        best = w;
      }
    }
    if (best !== t) changed = true;
    return best;
  });
  return changed ? corrected.join(" ") : undefined;
}

// ---------------------------------------------------------------- Suggestions & highlighting

export interface SearchSuggestion {
  kind: "title" | "author" | "category" | "topic";
  label: string;
  value: string;
}

const SUGGESTION_SOURCES: { kind: SearchSuggestion["kind"]; values: string[] }[] = [
  { kind: "author", values: Array.from(new Set(BOOKS.map((b) => b.author))) },
  { kind: "category", values: Array.from(new Set(BOOKS.map((b) => b.category))) },
  { kind: "topic", values: Array.from(new Set(BOOKS.flatMap((b) => b.tags || []))) },
];

/** Autocomplete for authors, categories and topics whose words start with the typed text. */
export function getSearchSuggestions(query: string, limit = 5): SearchSuggestion[] {
  const q = normalizeText(query);
  if (q.length < 2) return [];
  const out: SearchSuggestion[] = [];
  for (const source of SUGGESTION_SOURCES) {
    for (const value of source.values) {
      const n = normalizeText(value);
      if (n === q) continue;
      if (n.startsWith(q) || n.split(" ").some((w) => w.startsWith(q))) {
        out.push({ kind: source.kind, label: value, value });
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}

export interface HighlightSegment {
  text: string;
  match: boolean;
}

/** Splits `text` into segments, marking words that match any query token (prefix, exact or typo). */
export function highlightMatches(text: string, tokens: string[]): HighlightSegment[] {
  if (!text || tokens.length === 0) return [{ text, match: false }];
  const parts = text.split(/([\p{L}\p{N}\p{M}'’]+)/u);
  return parts
    .filter((p) => p.length > 0)
    .map((part) => {
      const n = normalizeText(part);
      const match = n.length > 0 && tokens.some((t) => wordMatchQuality(t, n) >= 0.5);
      return { text: part, match };
    });
}
