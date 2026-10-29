/**
 * Page-aware chunking and retrieval for the AI Reading Companion.
 * Pure functions (no browser or network) so the index can be built in the browser and unit-tested.
 *
 * - Chunks never span pages, so every passage carries a verifiable page number.
 * - Lexical search is BM25 over Unicode word tokens (works for English and Devanagari).
 * - Optional semantic vectors are fused with BM25 using reciprocal rank fusion.
 */

import type { PageText, RetrievedPassage } from "./types";

export interface BookChunk {
  id: string;
  pageNum: number;
  text: string;
}

export interface LexicalDoc {
  len: number;
  tf: Record<string, number>;
}

export interface LexicalIndex {
  docs: LexicalDoc[];
  df: Record<string, number>;
  avgLen: number;
}

export interface RankedChunk {
  index: number;
  score: number;
}

const STOPWORDS = new Set([
  // English
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "at", "for", "is", "are", "was", "were", "be", "been", "it", "its",
  "this", "that", "these", "those", "with", "as", "by", "from", "but", "not", "no", "he", "she", "they", "we", "you", "i",
  "his", "her", "their", "our", "your", "my", "me", "him", "them", "us", "what", "which", "who", "whom", "how", "why",
  "when", "where", "do", "does", "did", "have", "has", "had", "so", "if", "then", "there", "here", "about", "into", "than",
  "can", "could", "would", "should", "will", "shall", "may", "might", "also", "very", "just", "all", "any", "some",
  // Hinglish / Hindi (romanised + Devanagari)
  "hai", "hain", "ka", "ki", "ke", "ko", "se", "me", "mein", "aur", "ya", "ye", "yeh", "woh", "wo", "kya", "nahi", "bhi",
  "है", "हैं", "का", "की", "के", "को", "से", "में", "और", "या", "यह", "वह", "क्या", "नहीं", "भी", "था", "थी", "थे", "पर", "एक",
]);

export function tokenize(text: string): string[] {
  const tokens = text.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}\p{M}]+/gu) || [];
  return tokens.filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * Splits page text into passages of at most `maxChars`, preferring sentence/paragraph boundaries.
 */
export function chunkPages(
  pages: PageText[],
  options: { maxChars?: number; overlap?: number } = {}
): BookChunk[] {
  const maxChars = options.maxChars ?? 1100;
  const overlap = Math.min(options.overlap ?? 120, Math.floor(maxChars / 4));
  const chunks: BookChunk[] = [];

  for (const page of pages) {
    const text = (page.text || "").replace(/\s+\n/g, "\n").trim();
    if (!text) continue;

    let start = 0;
    let part = 0;
    while (start < text.length) {
      let end = Math.min(text.length, start + maxChars);
      if (end < text.length) {
        const window = text.slice(start, end);
        const breakAt = Math.max(window.lastIndexOf("\n"), window.lastIndexOf(". "), window.lastIndexOf("। "));
        if (breakAt > maxChars * 0.5) end = start + breakAt + 1;
      }
      const piece = text.slice(start, end).trim();
      if (piece) chunks.push({ id: `${page.pageNum}:${part++}`, pageNum: page.pageNum, text: piece });
      if (end >= text.length) break;
      start = Math.max(end - overlap, start + 1);
    }
  }
  return chunks;
}

export function buildLexicalIndex(chunks: BookChunk[]): LexicalIndex {
  const df: Record<string, number> = {};
  let totalLen = 0;
  const docs = chunks.map((chunk) => {
    const tf: Record<string, number> = {};
    const tokens = tokenize(chunk.text);
    for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
    for (const t of Object.keys(tf)) df[t] = (df[t] || 0) + 1;
    totalLen += tokens.length;
    return { len: tokens.length, tf };
  });
  return { docs, df, avgLen: docs.length ? totalLen / docs.length : 0 };
}

export function searchLexical(index: LexicalIndex, query: string, limit = 8): RankedChunk[] {
  const terms = Array.from(new Set(tokenize(query)));
  const n = index.docs.length;
  if (!terms.length || !n) return [];
  const k1 = 1.4;
  const b = 0.75;

  const results: RankedChunk[] = [];
  index.docs.forEach((doc, i) => {
    let score = 0;
    for (const term of terms) {
      const freq = doc.tf[term];
      if (!freq) continue;
      const df = index.df[term] || 0;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      score += idf * ((freq * (k1 + 1)) / (freq + k1 * (1 - b + (b * doc.len) / (index.avgLen || 1))));
    }
    if (score > 0) results.push({ index: i, score });
  });
  return results.sort((a, b2) => b2.score - a.score).slice(0, limit);
}

export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

export function searchSemantic(vectors: ArrayLike<number>[], query: ArrayLike<number>, limit = 8, minScore = 0.2): RankedChunk[] {
  return vectors
    .map((v, index) => ({ index, score: cosineSimilarity(v, query) }))
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Reciprocal rank fusion of several ranked lists (robust to different score scales). */
export function fuseRankings(lists: RankedChunk[][], k = 60): RankedChunk[] {
  const scores = new Map<number, number>();
  for (const list of lists) {
    list.forEach((item, rank) => scores.set(item.index, (scores.get(item.index) || 0) + 1 / (k + rank + 1)));
  }
  return Array.from(scores.entries())
    .map(([index, score]) => ({ index, score }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Turns ranked chunks into prompt passages: skips pages already visible, one passage per page, bounded size.
 */
export function selectPassages(
  chunks: BookChunk[],
  ranked: RankedChunk[],
  options: { excludePages?: number[]; maxPassages?: number; maxChars?: number } = {}
): RetrievedPassage[] {
  const exclude = new Set(options.excludePages || []);
  const maxPassages = options.maxPassages ?? 4;
  const maxChars = options.maxChars ?? 1200;
  const usedPages = new Set<number>();
  const passages: RetrievedPassage[] = [];

  for (const r of ranked) {
    const chunk = chunks[r.index];
    if (!chunk || exclude.has(chunk.pageNum) || usedPages.has(chunk.pageNum)) continue;
    usedPages.add(chunk.pageNum);
    passages.push({ pageNum: chunk.pageNum, text: chunk.text.slice(0, maxChars), score: Number(r.score.toFixed(4)) });
    if (passages.length >= maxPassages) break;
  }
  return passages;
}
