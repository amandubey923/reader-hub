/**
 * Reader's HUB — Contextual Translation Utility & Client-Side Cache
 * Translates currently visible PDF page spreads into Hindi, Hinglish, or English.
 */

import { getAuthHeader } from "@/lib/firebase";

export type TranslationTarget = "hindi" | "hinglish" | "english";

export interface PageExtract {
  pageNum: number;
  text: string;
}

export interface TranslationResult {
  success: boolean;
  targetLanguage: TranslationTarget;
  translations: Record<number, string>; // pageNum -> translatedText
  error?: string;
}

// In-Memory Session Cache: "bookId:pageRange:targetLang:hash" -> TranslationResult
const translationCache = new Map<string, TranslationResult>();

/**
 * Normalizes fragmented PDF text layer items into coherent paragraphs.
 */
export function normalizePdfText(items: Array<{ str: string; hasEOL?: boolean; transform?: number[] }>): string {
  if (!Array.isArray(items) || items.length === 0) return "";

  const lines: string[] = [];
  let currentLine = "";

  for (const item of items) {
    const text = item.str || "";
    if (!text.trim()) {
      if (item.hasEOL && currentLine) {
        lines.push(currentLine.trim());
        currentLine = "";
      }
      continue;
    }

    currentLine = currentLine ? `${currentLine} ${text}` : text;

    if (item.hasEOL) {
      lines.push(currentLine.trim());
      currentLine = "";
    }
  }

  if (currentLine) {
    lines.push(currentLine.trim());
  }

  // Join lines, collapsing multiple spaces while preserving paragraph breaks
  return lines
    .join("\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Simple DJB2-based fast string hashing for translation cache keys.
 */
function fastHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Generates a deterministic cache key for a page spread translation request.
 */
export function getTranslationCacheKey(
  bookId: string,
  pages: PageExtract[],
  target: TranslationTarget
): string {
  const pageRange = pages.map((p) => p.pageNum).sort((a, b) => a - b).join("-");
  const combinedText = pages.map((p) => p.text).join("::");
  const contentHash = fastHash(combinedText);
  return `${bookId}:${pageRange}:${target}:${contentHash}`;
}

/**
 * Checks if a translation for this exact spread is already cached in memory.
 */
export function getCachedTranslation(
  bookId: string,
  pages: PageExtract[],
  target: TranslationTarget
): TranslationResult | undefined {
  const key = getTranslationCacheKey(bookId, pages, target);
  return translationCache.get(key);
}

/**
 * Translates the current visible page spread by calling the secure Next.js translation route.
 */
export async function translatePageSpread({
  bookId,
  pages,
  targetLanguage,
  signal,
}: {
  bookId: string;
  pages: PageExtract[];
  targetLanguage: TranslationTarget;
  signal?: AbortSignal;
}): Promise<TranslationResult> {
  // Check in-memory cache first for instant response
  const cached = getCachedTranslation(bookId, pages, targetLanguage);
  if (cached) {
    return cached;
  }

  try {
    const res = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await getAuthHeader()) },
      body: JSON.stringify({
        pages,
        targetLanguage,
      }),
      signal,
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      return {
        success: false,
        targetLanguage,
        translations: {},
        error: data?.error || "Translation unavailable. Please try again.",
      };
    }

    const result: TranslationResult = {
      success: true,
      targetLanguage,
      translations: data.translations || {},
    };

    // Cache the result for this session
    const cacheKey = getTranslationCacheKey(bookId, pages, targetLanguage);
    translationCache.set(cacheKey, result);

    return result;
  } catch (error: any) {
    if (error.name === "AbortError") {
      return {
        success: false,
        targetLanguage,
        translations: {},
        error: "Translation was cancelled.",
      };
    }

    console.warn("[Translator] Fetch error:", error);
    return {
      success: false,
      targetLanguage,
      translations: {},
      error: "Translation network error. Please check your connection.",
    };
  }
}

