"use client";

/**
 * Whole-book index for the AI companion, built and stored entirely in the reader's browser (IndexedDB).
 * Building it never uploads the book. Only the few passages retrieved for a question are sent with that question,
 * and only for titles whose rights are cleared (checked again on the server).
 */

import { getAuthHeader } from "@/lib/firebase";
import { getReaderBridge } from "./reader-bridge";
import {
  BookChunk,
  LexicalIndex,
  buildLexicalIndex,
  chunkPages,
  fuseRankings,
  searchLexical,
  searchSemantic,
  selectPassages,
} from "./retrieval";
import type { PageText, RetrievedPassage } from "./types";

const DB_NAME = "readershub-companion";
const STORE = "book-index";
const INDEX_VERSION = 1;
export const MAX_INDEX_PAGES = 1500;
const EMBED_BATCH = 32;
export const MAX_EMBED_CHUNKS = 900;

export interface StoredBookIndex {
  version: number;
  bookId: string;
  pageCount: number;
  indexedPages: number;
  builtAt: number;
  chunks: BookChunk[];
  lexical: LexicalIndex;
  vectors?: number[][];
}

export interface BookPolicy {
  bookWideAllowed: boolean;
  reason: string;
}

// ---------------------------------------------------------------- IndexedDB

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB unavailable"));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "bookId" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

const memoryCache = new Map<string, StoredBookIndex | null>();

export async function loadBookIndex(bookId: string): Promise<StoredBookIndex | null> {
  if (memoryCache.has(bookId)) return memoryCache.get(bookId)!;
  try {
    const stored = (await withStore("readonly", (s) => s.get(bookId))) as StoredBookIndex | undefined;
    const valid = stored && stored.version === INDEX_VERSION ? stored : null;
    memoryCache.set(bookId, valid);
    return valid;
  } catch {
    return null;
  }
}

async function saveBookIndex(index: StoredBookIndex): Promise<void> {
  memoryCache.set(index.bookId, index);
  await withStore("readwrite", (s) => s.put(index));
}

/** Removes every companion index from this browser (does not touch reading data). */
export async function clearAllBookIndexes(): Promise<void> {
  memoryCache.clear();
  try {
    await withStore("readwrite", (s) => s.clear());
  } catch {}
}

// ---------------------------------------------------------------- Policy

const policyCache = new Map<string, BookPolicy>();

export async function fetchBookPolicy(bookId: string): Promise<BookPolicy> {
  const cached = policyCache.get(bookId);
  if (cached) return cached;
  try {
    const res = await fetch(`/api/companion/policy?bookId=${encodeURIComponent(bookId)}`);
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    const policy = { bookWideAllowed: data.bookWideAllowed === true, reason: String(data.reason || "") };
    policyCache.set(bookId, policy);
    return policy;
  } catch {
    // Fail closed: without a confirmed policy only page-level help is offered
    return { bookWideAllowed: false, reason: "Couldn't check this book's rights status, so Bodhi is helping page by page." };
  }
}

// ---------------------------------------------------------------- Building

export interface BuildProgress {
  phase: "reading" | "embedding";
  done: number;
  total: number;
}

const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Extracts every page of the open book with PDF.js (in this browser), chunks it page by page and builds a BM25 index.
 */
export async function buildBookIndex(
  bookId: string,
  onProgress: (p: BuildProgress) => void,
  signal: AbortSignal
): Promise<StoredBookIndex> {
  const bridge = getReaderBridge();
  const snap = bridge?.getSnapshot();
  if (!bridge || !snap || snap.bookId !== bookId || !snap.isLoaded) throw new Error("Open the book in the reader first.");

  const total = Math.min(snap.totalPages, MAX_INDEX_PAGES);
  const pages: PageText[] = [];
  for (let p = 1; p <= total; p++) {
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    pages.push({ pageNum: p, text: await bridge.getPageText(p) });
    if (p % 4 === 0 || p === total) {
      onProgress({ phase: "reading", done: p, total });
      await yieldToUi();
    }
  }

  const chunks = chunkPages(pages);
  if (chunks.length === 0) throw new Error("This book has no selectable text to index (it may be a scanned PDF).");

  const index: StoredBookIndex = {
    version: INDEX_VERSION,
    bookId,
    pageCount: snap.totalPages,
    indexedPages: total,
    builtAt: Date.now(),
    chunks,
    lexical: buildLexicalIndex(chunks),
  };
  await saveBookIndex(index);
  return index;
}

async function embed(bookId: string, texts: string[], kind: "document" | "query"): Promise<number[][]> {
  const res = await fetch("/api/companion/embed", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await getAuthHeader()) },
    body: JSON.stringify({ bookId, texts, kind }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !Array.isArray(data.vectors)) throw new Error(data.error || "Semantic search is unavailable.");
  return data.vectors;
}

/**
 * Adds embedding vectors to an existing index (signed-in readers, rights-cleared books; enforced server-side).
 */
export async function addSemanticVectors(
  bookId: string,
  onProgress: (p: BuildProgress) => void,
  signal: AbortSignal
): Promise<StoredBookIndex> {
  const index = await loadBookIndex(bookId);
  if (!index) throw new Error("Build the whole-book index first.");
  if (index.chunks.length > MAX_EMBED_CHUNKS) {
    throw new Error(`This book is too long for semantic search (${index.chunks.length} passages; limit ${MAX_EMBED_CHUNKS}). Keyword search still works.`);
  }

  const vectors: number[][] = [];
  for (let i = 0; i < index.chunks.length; i += EMBED_BATCH) {
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    const batch = index.chunks.slice(i, i + EMBED_BATCH).map((c) => c.text.slice(0, 2000));
    vectors.push(...(await embed(bookId, batch, "document")));
    onProgress({ phase: "embedding", done: Math.min(i + EMBED_BATCH, index.chunks.length), total: index.chunks.length });
  }
  const updated = { ...index, vectors };
  await saveBookIndex(updated);
  return updated;
}

// ---------------------------------------------------------------- Retrieval

/**
 * Finds the passages most relevant to `query` elsewhere in the book (hybrid BM25 + semantic when available).
 */
export async function retrievePassages(
  bookId: string,
  query: string,
  excludePages: number[],
  options: { semantic: boolean } = { semantic: true }
): Promise<RetrievedPassage[]> {
  const index = await loadBookIndex(bookId);
  if (!index) return [];

  const lists = [searchLexical(index.lexical, query, 12)];
  if (options.semantic && index.vectors && index.vectors.length === index.chunks.length) {
    try {
      const [queryVector] = await embed(bookId, [query.slice(0, 2000)], "query");
      lists.push(searchSemantic(index.vectors, queryVector, 12));
    } catch {
      // Keyword results are still useful when the embedding call fails
    }
  }
  const ranked = lists.length > 1 ? fuseRankings(lists) : lists[0];
  return selectPassages(index.chunks, ranked, { excludePages, maxPassages: 4 });
}
