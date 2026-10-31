import booksData from "@/data/books.json";
import { searchCatalog } from "@/lib/search/catalog-search";
import { isSameAuthor } from "@/lib/recommendations";

export interface AssistantBook {
  id: string;
  title: string;
  author: string;
  category: string;
  cover: string;
  rating: number;
  year: string | number;
  description: string;
}

export interface AssistantResponse {
  reply: string;
  books: AssistantBook[];
  suggestedActions?: string[];
  isDeterministic?: boolean;
}

const ALL_BOOKS: AssistantBook[] = (booksData as any[]).map((b) => ({
  id: b.id,
  title: b.title,
  author: b.author,
  category: b.category,
  cover: b.cover,
  rating: b.rating || 4.8,
  year: b.year || 2024,
  description: b.description || "",
}));

const ALL_CATEGORIES = Array.from(new Set(ALL_BOOKS.map((b) => b.category)));

/**
 * Returns a compact catalog summary string for system grounding
 */
export function getCompactCatalogSummary(): string {
  const byCategory: Record<string, string[]> = {};

  for (const book of ALL_BOOKS) {
    if (!byCategory[book.category]) {
      byCategory[book.category] = [];
    }
    byCategory[book.category].push(`- "${book.title}" by ${book.author} (ID: ${book.id})`);
  }

  const categoryBlocks = Object.entries(byCategory).map(([cat, books]) => {
    return `### Category: ${cat} (${books.length} books)\n${books.slice(0, 20).join("\n")}${books.length > 20 ? `\n...and ${books.length - 20} more` : ""}`;
  });

  return `TOTAL AVAILABLE BOOKS IN READER'S HUB: ${ALL_BOOKS.length}\n\nCATEGORIES:\n${categoryBlocks.join("\n\n")}`;
}

export function findBooksByIds(ids: string[]): AssistantBook[] {
  if (!ids || ids.length === 0) return [];
  const lowerIds = ids.map((id) => id.toLowerCase().trim());
  return ALL_BOOKS.filter((b) => lowerIds.includes(b.id.toLowerCase())).slice(0, 6);
}

/**
 * Deterministic fast-path resolver for high-confidence local queries
 */
export function tryDeterministicQuery(query: string): AssistantResponse | null {
  const q = query.toLowerCase().trim();

  // 1. Out of scope / unrelated queries
  if (
    q.includes("joke") ||
    q.includes("weather") ||
    q.includes("recipe") ||
    q.includes("write code") ||
    q.includes("capital of") ||
    q.includes("who is president")
  ) {
    return {
      reply: "I'm here specifically to help you explore the **Reader's HUB** library. Try asking me about a book, author, category, or library availability!",
      books: [],
      suggestedActions: ["What's available?", "Browse categories", "Recommend a book"],
      isDeterministic: true,
    };
  }

  // 2. Exact or near-exact book count query
  if (
    q.includes("how many books") ||
    q.includes("total books") ||
    q.includes("number of books") ||
    q.includes("what is available") ||
    q.includes("what's available") ||
    q === "books"
  ) {
    return {
      reply: `Reader's HUB currently features **${ALL_BOOKS.length} curated volumes** across ${ALL_CATEGORIES.length} genres including Classics, Hindi Literature, Philosophy, Self-Development, and Fiction.`,
      books: ALL_BOOKS.slice(0, 4),
      suggestedActions: ["Browse categories", "Find by author", "Recommend a book"],
      isDeterministic: true,
    };
  }

  // 3. Category listing query
  if (
    q.includes("what categories") ||
    q.includes("show categories") ||
    q.includes("list categories") ||
    q.includes("browse categories") ||
    q === "categories"
  ) {
    const list = ALL_CATEGORIES.map((c) => `• **${c}**`).join("\n");
    return {
      reply: `Here are the ${ALL_CATEGORIES.length} categories available in Reader's HUB:\n\n${list}`,
      books: [],
      suggestedActions: ALL_CATEGORIES.slice(0, 4),
      isDeterministic: true,
    };
  }

  // 4. Exact Title Match
  const titleMatch = ALL_BOOKS.find(
    (b) =>
      b.title.toLowerCase() === q ||
      q.includes(`"${b.title.toLowerCase()}"`) ||
      q.includes(`'${b.title.toLowerCase()}'`) ||
      q === `do you have ${b.title.toLowerCase()}` ||
      q === `is ${b.title.toLowerCase()} available` ||
      q.includes(b.title.toLowerCase())
  );

  if (titleMatch && (titleMatch.title.length > 5 || q.includes(titleMatch.title.toLowerCase()))) {
    return {
      reply: `Yes! **"${titleMatch.title}"** by ${titleMatch.author} is available in Reader's HUB under *${titleMatch.category}*.`,
      books: [titleMatch],
      suggestedActions: [`More in ${titleMatch.category}`, `More by ${titleMatch.author}`],
      isDeterministic: true,
    };
  }

  // 5. Non-existing popular titles
  if (
    q.includes("harry potter") ||
    q.includes("lord of the rings") ||
    q.includes("game of thrones") ||
    q.includes("twilight") ||
    q.includes("hunger games")
  ) {
    return {
      reply: `That volume is **not currently in Reader's HUB**. Reader's HUB focuses on public-domain classics, philosophical works, Hindi literature, and curated personal development texts.`,
      books: [],
      suggestedActions: ["Browse Classics", "Explore Philosophy", "Hindi Literature"],
      isDeterministic: true,
    };
  }

  // 6. Author Search ("Books by Osho", "Premchand books", "Dostoevsky")
  let authorQuery = "";
  const authorPatterns = [
    /books? (?:by|from|of) ([a-z\s]+)/i,
    /(?:which|what) ([a-z\s]+) books/i,
    /([a-z\s]+) books/i,
  ];

  for (const pat of authorPatterns) {
    const match = q.match(pat);
    if (match && match[1]) {
      const candidate = match[1].trim();
      if (!["the", "all", "any", "some", "good", "best", "available"].includes(candidate)) {
        authorQuery = candidate;
        break;
      }
    }
  }

  if (authorQuery && authorQuery.length >= 3) {
    // Shared engine handles accents, partial names and spelling variants ("dostoyevsky", "premchnd")
    const byId = new Map(ALL_BOOKS.map((b) => [b.id, b]));
    const authorHits = searchCatalog(authorQuery).hits.filter((h) => h.complete && h.matchedField === "author");
    const topAuthor = authorHits[0]?.book.author;
    const matchedAuthorBooks = authorHits
      .filter((h) => topAuthor && isSameAuthor(h.book.author, topAuthor))
      .map((h) => byId.get(h.book.id))
      .filter((b): b is AssistantBook => Boolean(b));

    if (matchedAuthorBooks.length > 0) {
      const authorName = matchedAuthorBooks[0].author;
      return {
        reply: `We have **${matchedAuthorBooks.length} book${matchedAuthorBooks.length > 1 ? "s" : ""}** by ${authorName} in Reader's HUB:`,
        books: matchedAuthorBooks.slice(0, 6),
        suggestedActions: ["Browse categories", "What's available?"],
        isDeterministic: true,
      };
    }
  }

  // 7. Category and Recommendation Search with broad stem matching (keys must be real catalog categories)
  const categoryStems: Record<string, string[]> = {
    "Philosophy & Spirituality": ["philosoph", "spirit", "stoic", "zen", "meditat", "mind"],
    "Classics & Literature": ["classic", "vintage", "ancient", "antiquity"],
    "Hindi Literature": ["hindi", "premchand", "upanyas", "kahani", "sahitya"],
    "Psychology & Self-Development": ["self-dev", "self dev", "habit", "productiv", "psycholog", "growth", "discipline"],
    "Business & Management": ["business", "management", "startup", "leadership"],
    "Economics & Finance": ["money", "invest", "finance", "wealth", "econom"],
    "Fiction & Dystopian": ["fiction", "dystop", "novel", "story", "stories"],
    "Fantasy & Adventure": ["fantasy", "adventure", "magic", "journey"],
    "Romance": ["romance", "love", "romantic", "heart"],
  };

  for (const [catName, stems] of Object.entries(categoryStems)) {
    const matchesStem = stems.some((stem) => q.includes(stem));
    const catBooks = ALL_BOOKS.filter((b) => b.category === catName);
    if (matchesStem && catBooks.length > 0) {
      return {
        reply: `Here are recommended **${catName}** volumes available in Reader's HUB:`,
        books: catBooks.slice(0, 6),
        suggestedActions: ["Browse other categories", "What's available?"],
        isDeterministic: true,
      };
    }
  }

  return null;
}

// The Library Assistant is a lightweight helper: short answers, a few books, no follow-up action chains.
// (Bodhi is the full reading companion; this keeps the two clearly different.)
export const ASSISTANT_MAX_BOOKS = 3;
export const ASSISTANT_MAX_REPLY_CHARS = 260;

/** Trims any reply (deterministic or AI) to at most two short sentences and three books. */
export function simplifyAssistantResponse(response: AssistantResponse): AssistantResponse {
  const text = (response.reply || "").replace(/\s+\n/g, "\n").trim();
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) || [text];
  let reply = sentences.slice(0, 2).join("").trim();
  if (reply.length > ASSISTANT_MAX_REPLY_CHARS) {
    reply = reply.slice(0, ASSISTANT_MAX_REPLY_CHARS).replace(/\s+\S*$/, "") + "…";
  }
  const seen = new Set<string>();
  const books = (response.books || []).filter((b) => b?.id && !seen.has(b.id) && seen.add(b.id)).slice(0, ASSISTANT_MAX_BOOKS);
  return { reply, books, isDeterministic: response.isDeterministic };
}
