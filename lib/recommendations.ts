/**
 * Reader's HUB — Transparent, browser-local recommendation engine.
 * Every score comes from catalogue metadata plus the reader's own (on-device) signals, and every recommended
 * book carries a plain-language reason. No external API calls; nothing about one reader is shared with another.
 */

import { Book, BOOKS, isTechnicalBook } from "@/data/books";
import { ReadingProgressItem } from "@/lib/reader-storage";
import { getPageCount, getSubgroups } from "@/lib/search/book-meta";

export interface RecommendationSection {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  books: Book[];
  /** Why each book is shown, keyed by book ID. */
  reasons: Record<string, string>;
}

export interface RecommendationResults {
  hasActivity: boolean;
  sections: RecommendationSection[];
}

export interface DiscoveryInterests {
  categories: string[];
  subgroups: string[];
  languages: string[];
}

export interface RecommendationOptions {
  interests?: DiscoveryInterests;
  /** Genuinely completed book IDs (never recommended again). */
  completedIds?: string[];
  now?: number;
}

const BOOK_BY_ID = new Map(BOOKS.map((b) => [b.id, b]));
const MAX_PER_AUTHOR = 2;
const SECTION_SIZE = 6;

// ---------------------------------------------------------------- Book-to-book similarity

export interface SimilarityBreakdown {
  score: number;
  reason: string;
}

const lower = (s: string) => (s || "").toLowerCase();

/** "Osho" and "Bhagwan Shree Rajneesh (Osho)" are the same author in this catalogue. */
export function isSameAuthor(a: string, b: string): boolean {
  const names = (s: string) => {
    const full = lower(s).trim();
    const inner = full.match(/\(([^)]+)\)/)?.[1]?.trim();
    return inner && inner.length >= 3 ? [full, inner] : [full];
  };
  const x = names(a);
  const y = names(b);
  return x[0] !== "" && x.some((n) => y.includes(n));
}

/** A reader who prefers English can read "Greek (Eng Trans)"; Hindi readers can read "Hindi / Urdu". */
export function isReadableIn(bookLanguage: string, preferred: string): boolean {
  const lang = lower(bookLanguage);
  const pref = lower(preferred);
  if (lang === pref) return true;
  if (pref === "english") return /\beng(lish)?\b/.test(lang);
  return lang.split(/[^a-zऀ-ॿ]+/).includes(pref);
}

/**
 * Explains and scores how related two books are. Author > shared tradition/track > shared topics > category.
 */
export function explainSimilarity(target: Book, candidate: Book): SimilarityBreakdown {
  if (target.id === candidate.id) return { score: -1, reason: "" };
  const parts: { points: number; reason: string }[] = [];

  if (isSameAuthor(target.author, candidate.author)) {
    parts.push({ points: 10, reason: `Also by ${candidate.author}` });
  }

  const sharedGroups = getSubgroups(target).filter((g) => getSubgroups(candidate).includes(g));
  if (sharedGroups.length) parts.push({ points: 6, reason: `Also in ${sharedGroups[0]}` });

  // Tags that merely repeat the category, language or a sub-group are already scored below, so they are not "topics"
  const generic = new Set([target.category, candidate.category, target.language, candidate.language, ...getSubgroups(target), ...getSubgroups(candidate)].map(lower));
  const targetTags = new Set((target.tags || []).map(lower).filter((t) => !generic.has(t)));
  const sharedTags = (candidate.tags || []).filter((t) => targetTags.has(lower(t))).slice(0, 4);
  if (sharedTags.length) {
    parts.push({ points: sharedTags.length * 2.5, reason: `Shared topic${sharedTags.length > 1 ? "s" : ""}: ${sharedTags.slice(0, 2).join(", ")}` });
  }

  if (target.category === candidate.category) parts.push({ points: 4, reason: `Also in ${candidate.category}` });
  else if (isTechnicalBook(target) && isTechnicalBook(candidate)) parts.push({ points: 3, reason: "Also technical study material" });

  if (target.resourceType && target.resourceType !== "Book" && target.resourceType === candidate.resourceType) {
    parts.push({ points: 3, reason: "Same type of study material" });
  }

  if (target.language === candidate.language) parts.push({ points: 1, reason: `Also in ${candidate.language}` });

  const pa = getPageCount(target);
  const pb = getPageCount(candidate);
  const lengthBonus = pa && pb && pb / pa >= 0.5 && pb / pa <= 2 ? 0.5 : 0;
  const ratingPrior = ((candidate.rating || 4.5) - 4) * 0.5;

  const best = parts.sort((a, b) => b.points - a.points)[0];
  const score = parts.reduce((s, p) => s + p.points, 0) + lengthBonus + ratingPrior;
  return { score, reason: best?.reason || "Popular in the library" };
}

/** Backwards-compatible numeric similarity. */
export function calculateBookSimilarity(target: Book, candidate: Book): number {
  return explainSimilarity(target, candidate).score;
}

function diversify<T extends { book: Book }>(items: T[], limit: number, perAuthor = MAX_PER_AUTHOR): T[] {
  const authorCounts = new Map<string, number>();
  const out: T[] = [];
  for (const item of items) {
    const n = authorCounts.get(item.book.author) || 0;
    if (n >= perAuthor) continue;
    authorCounts.set(item.book.author, n + 1);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

export function getRelatedBooksWithReasons(target: Book, allBooks: Book[] = BOOKS, limit = 4): { book: Book; reason: string }[] {
  const scored = allBooks
    .filter((b) => b.id !== target.id)
    .map((book) => ({ book, ...explainSimilarity(target, book) }))
    .filter((s) => s.score > 1)
    .sort((a, b) => b.score - a.score || a.book.title.localeCompare(b.book.title));
  return diversify(scored, limit, 3).map(({ book, reason }) => ({ book, reason }));
}

/** Backwards-compatible related books (book page, assistants). */
export function getRelatedBooks(target: Book, allBooks: Book[] = BOOKS, limit: number = 4): Book[] {
  return getRelatedBooksWithReasons(target, allBooks, limit).map((r) => r.book);
}

// ---------------------------------------------------------------- Reader profile

interface Signal {
  book: Book;
  weight: number;
  kind: "favorite" | "completed" | "reading";
}

const DAY_MS = 24 * 60 * 60 * 1000;

function buildSignals(history: ReadingProgressItem[], favorites: string[], completed: Set<string>, now: number): Signal[] {
  const signals = new Map<string, Signal>();
  for (const item of history) {
    const book = BOOK_BY_ID.get(item.bookId);
    if (!book) continue;
    const ageDays = Math.max(0, (now - (item.lastReadAt || now)) / DAY_MS);
    const recency = Math.max(0.3, Math.pow(0.5, ageDays / 45));
    const isDone = completed.has(book.id) || (item.progress || 0) >= 95;
    // Opening a book barely counts; real progress and finishing count most
    const engagement = isDone ? 2.5 : 0.6 + Math.min(1.8, (item.progress || 0) / 40);
    signals.set(book.id, { book, weight: engagement * recency, kind: isDone ? "completed" : "reading" });
  }
  for (const id of favorites) {
    const book = BOOK_BY_ID.get(id);
    if (!book) continue;
    const existing = signals.get(id);
    signals.set(id, { book, weight: Math.max(existing?.weight || 0, 3), kind: "favorite" });
  }
  return Array.from(signals.values()).sort((a, b) => b.weight - a.weight);
}

interface Candidate {
  book: Book;
  score: number;
  reason: string;
}

function rankForProfile(signals: Signal[], interests: DiscoveryInterests | undefined, exclude: Set<string>, allBooks: Book[]): Candidate[] {
  const anchors = signals.slice(0, 12);
  const categoryAffinity = new Map<string, number>();
  const totalWeight = signals.reduce((s, x) => s + x.weight, 0) || 1;
  signals.forEach((s) => categoryAffinity.set(s.book.category, (categoryAffinity.get(s.book.category) || 0) + s.weight / totalWeight));

  const wantCats = new Set(interests?.categories || []);
  const wantGroups = new Set(interests?.subgroups || []);
  const wantLangs = new Set(interests?.languages || []);

  return allBooks
    .filter((b) => !exclude.has(b.id))
    .map((book) => {
      const contributions: { points: number; reason: string }[] = [];

      // Closest book the reader engaged with
      let bestAnchor: { points: number; reason: string } | null = null;
      for (const a of anchors) {
        const sim = explainSimilarity(a.book, book);
        if (sim.score <= 2) continue;
        const points = sim.score * a.weight * 0.35;
        if (!bestAnchor || points > bestAnchor.points) {
          const verb = a.kind === "favorite" ? "you saved" : a.kind === "completed" ? "you finished" : "you're reading";
          bestAnchor = {
            points,
            reason: sim.reason.startsWith("Also by") ? `More from ${book.author}` : `Because ${verb} “${a.book.title}”`,
          };
        }
      }
      if (bestAnchor) contributions.push(bestAnchor);

      const affinity = categoryAffinity.get(book.category) || 0;
      if (affinity > 0) contributions.push({ points: affinity * 6, reason: `Because you enjoy ${book.category}` });

      const groups = getSubgroups(book);
      const matchedGroup = groups.find((g) => wantGroups.has(g));
      if (matchedGroup) contributions.push({ points: 8, reason: `Matches your interest in ${matchedGroup}` });
      if (wantCats.has(book.category) || (wantCats.has("Technical Knowledge") && isTechnicalBook(book))) {
        contributions.push({ points: 6, reason: `Matches your interest in ${wantCats.has(book.category) ? book.category : "Technical Knowledge"}` });
      }

      // A book must be relevant for a real reason; language and rating only adjust the order
      if (contributions.length === 0) return null;
      let score = contributions.reduce((s, c) => s + c.points, 0);
      if (wantLangs.size) {
        if (Array.from(wantLangs).some((l) => isReadableIn(book.language, l))) score += 3;
        else score -= 6;
      }
      score += ((book.rating || 4.5) - 4) * 0.6;

      const top = contributions.sort((a, b) => b.points - a.points)[0];
      return { book, score, reason: top.reason };
    })
    .filter((c): c is Candidate => c !== null && c.score > 1)
    .sort((a, b) => b.score - a.score || a.book.title.localeCompare(b.book.title));
}

function toSection(id: string, title: string, subtitle: string, icon: string, items: { book: Book; reason: string }[]): RecommendationSection {
  return {
    id,
    title,
    subtitle,
    icon,
    books: items.map((i) => i.book),
    reasons: Object.fromEntries(items.map((i) => [i.book.id, i.reason])),
  };
}

// ---------------------------------------------------------------- Sections

/**
 * Personalised recommendation sections from the reader's own on-device signals (history, favourites,
 * completed books) and optional interests. Guests without activity get transparent starter picks.
 */
export function generateRecommendations(
  readingHistory: ReadingProgressItem[] = [],
  favorites: string[] = [],
  allBooks: Book[] = BOOKS,
  options: RecommendationOptions = {}
): RecommendationResults {
  const now = options.now ?? Date.now();
  const completed = new Set(options.completedIds || []);
  const interests = options.interests;
  const hasInterests = Boolean(interests && (interests.categories.length || interests.subgroups.length || interests.languages.length));
  const signals = buildSignals(readingHistory, favorites, completed, now);

  // Books the reader already knows are never recommended back to them
  const known = new Set<string>([...readingHistory.map((h) => h.bookId), ...favorites, ...completed]);
  const sections: RecommendationSection[] = [];

  if (signals.length || hasInterests) {
    const ranked = rankForProfile(signals, interests, known, allBooks);
    const picked = diversify(ranked, SECTION_SIZE);
    if (picked.length >= 2) {
      sections.push(
        toSection(
          "picked-for-you",
          "Picked for You",
          hasInterests && !signals.length ? "Based on the interests you chose" : "Ranked from your reading, saved books and interests",
          "✨",
          picked
        )
      );
    }
    const used = new Set(picked.map((p) => p.book.id));

    // "Because you read …" for the most recent book with real engagement
    const recent = [...readingHistory]
      .filter((h) => BOOK_BY_ID.has(h.bookId))
      .sort((a, b) => (b.lastReadAt || 0) - (a.lastReadAt || 0))[0];
    const anchor = recent ? BOOK_BY_ID.get(recent.bookId) : favorites.map((id) => BOOK_BY_ID.get(id)).find(Boolean);
    if (anchor) {
      const related = getRelatedBooksWithReasons(anchor, allBooks, 30)
        .filter((r) => !known.has(r.book.id) && !used.has(r.book.id))
        .slice(0, SECTION_SIZE);
      if (related.length >= 2) {
        sections.push(toSection("because-you-read", `Because You Read “${anchor.title}”`, `Closest matches by author, tradition and topic`, "📖", related));
        related.forEach((r) => used.add(r.book.id));
      }
    }

    // More from the authors the reader engaged with most
    const authorWeights = new Map<string, number>();
    signals.forEach((s) => authorWeights.set(s.book.author, (authorWeights.get(s.book.author) || 0) + s.weight));
    const authorBooks = allBooks
      .filter((b) => authorWeights.has(b.author) && !known.has(b.id) && !used.has(b.id))
      .sort((a, b) => (authorWeights.get(b.author)! - authorWeights.get(a.author)!) || (b.rating || 0) - (a.rating || 0))
      .map((book) => ({ book, reason: `More from ${book.author}` }));
    const authorPicks = diversify(authorBooks, SECTION_SIZE, 3);
    if (authorPicks.length >= 2) {
      sections.push(toSection("more-from-authors", "More From Authors You Read", "Other works by writers already on your shelf", "✍️", authorPicks));
      authorPicks.forEach((p) => used.add(p.book.id));
    }

    // Short reads ranked by the same profile (measured page counts)
    const quick = diversify(
      ranked
        .filter((c) => !used.has(c.book.id) && (getPageCount(c.book) || Infinity) <= 150)
        .map((c) => ({ book: c.book, reason: `Short read (${getPageCount(c.book)} pages) · ${c.reason.replace(/^Because /, "because ")}` })),
      SECTION_SIZE
    );
    if (quick.length >= 2) sections.push(toSection("quick-reads", "Quick Reads for You", "Up to 150 pages, matched to your taste", "⏱️", quick));
  } else {
    // Guests / new readers: transparent starter picks, one strong title per category
    const byCategory = new Map<string, Book>();
    [...allBooks]
      .sort((a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)) || (b.rating || 0) - (a.rating || 0))
      .forEach((b) => {
        if (!byCategory.has(b.category)) byCategory.set(b.category, b);
      });
    const starters = Array.from(byCategory.values()).slice(0, SECTION_SIZE).map((book) => ({ book, reason: `Top rated in ${book.category}` }));
    sections.push(toSection("start-here", "Start Here", "A highly rated pick from each corner of the library", "🧭", starters));

    const quick = diversify(
      allBooks
        .filter((b) => (getPageCount(b) || Infinity) <= 150 && (getPageCount(b) || 0) >= 20 && !starters.some((s) => s.book.id === b.id))
        .sort((a, b) => (b.rating || 0) - (a.rating || 0))
        .map((book) => ({ book, reason: `Short read · ${getPageCount(book)} pages` })),
      SECTION_SIZE
    );
    if (quick.length >= 2) sections.push(toSection("quick-reads", "Quick Reads", "Highly rated books of up to 150 pages", "⏱️", quick));
  }

  // Evergreen essentials (excluding everything already shown or known)
  const shown = new Set(sections.flatMap((s) => s.books.map((b) => b.id)));
  const evergreen = diversify(
    allBooks
      .filter((b) => (b.rating || 0) >= 4.8 && !known.has(b.id) && !shown.has(b.id))
      .sort((a, b) => (b.rating || 0) - (a.rating || 0) || Number(Boolean(b.featured)) - Number(Boolean(a.featured)))
      .map((book) => ({ book, reason: `Rated ${book.rating}★ in ${book.category}` })),
    SECTION_SIZE
  );
  if (evergreen.length >= 2) {
    sections.push(toSection("evergreen-essentials", "Reader's HUB Evergreen Essentials", "Highest-rated works across the library", "🌟", evergreen));
  }

  return { hasActivity: signals.length > 0 || hasInterests, sections };
}
