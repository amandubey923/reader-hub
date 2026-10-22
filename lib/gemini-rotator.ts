/**
 * Reader's HUB — Resilient Gemini API Key Pool & Rotation Engine
 *
 * Responsibilities:
 * 1. Reads server-side environment variables matching GEMINI_API_KEY, Gemini_API_Key,
 *    Gemini_API_Key_2, Gemini_API_Key_3, etc. (and any GEMINI_KEY / GOOGLE_API_KEY).
 * 2. Deduplicates keys, removes empty/placeholder strings, and manages an active pool.
 * 3. Rotates keys if a key encounters rate limits (429), quota exhaustion, or temporary upstream failures.
 * 4. Never exposes keys to client-side code or browser bundles.
 */

import { GoogleGenAI } from "@google/genai";

export interface GeminiKeyEntry {
  key: string;
  name: string;
  failCount: number;
  lastFailedAt: number;
}

/**
 * Discovers and returns all configured Gemini API keys from process.env
 */
export function getGeminiKeyPool(): GeminiKeyEntry[] {
  const candidates: { name: string; key: string }[] = [];

  // Check specific standard names first
  const primaryKeys = [
    "GEMINI_API_KEY",
    "Gemini_API_Key",
    "GEMINI_KEY",
    "GOOGLE_API_KEY",
  ];

  for (const name of primaryKeys) {
    const val = process.env[name];
    if (val && typeof val === "string" && val.trim().length > 10) {
      candidates.push({ name, key: val.trim() });
    }
  }

  // Check indexed variants: Gemini_API_Key_1 .. Gemini_API_Key_20
  for (let i = 1; i <= 20; i++) {
    const names = [
      `Gemini_API_Key_${i}`,
      `GEMINI_API_KEY_${i}`,
      `GEMINI_KEY_${i}`,
      `GOOGLE_API_KEY_${i}`,
    ];
    for (const name of names) {
      const val = process.env[name];
      if (val && typeof val === "string" && val.trim().length > 10) {
        candidates.push({ name, key: val.trim() });
      }
    }
  }

  // Catch any remaining process.env keys that contain "gemini" and "key"
  for (const [k, v] of Object.entries(process.env)) {
    if (
      k.toLowerCase().includes("gemini") &&
      k.toLowerCase().includes("key") &&
      v &&
      typeof v === "string" &&
      v.trim().length > 10
    ) {
      candidates.push({ name: k, key: v.trim() });
    }
  }

  // Deduplicate by actual API key value to prevent trying identical keys under different env names
  const uniqueKeys = new Map<string, GeminiKeyEntry>();
  for (const cand of candidates) {
    if (!uniqueKeys.has(cand.key)) {
      uniqueKeys.set(cand.key, {
        key: cand.key,
        name: cand.name,
        failCount: 0,
        lastFailedAt: 0,
      });
    }
  }

  return Array.from(uniqueKeys.values());
}

/**
 * Checks whether an error is transient or quota/rate-limit related
 */
export function isRotateableError(err: any): boolean {
  if (!err) return false;
  const status = err?.status || err?.statusCode || err?.response?.status;
  const message = String(err?.message || "").toLowerCase();

  // 429 Too Many Requests / Resource Exhausted
  if (status === 429 || message.includes("429") || message.includes("quota") || message.includes("resource_exhausted")) {
    return true;
  }

  // 403 Forbidden / API Key limit / suspended / permission denied
  if (status === 403 || message.includes("permission_denied") || message.includes("api key not valid") || message.includes("forbidden")) {
    return true;
  }

  // 503 Service Unavailable / 500 Server Error
  if (status === 503 || status === 500 || status === 502 || message.includes("overloaded") || message.includes("timeout")) {
    return true;
  }

  return false;
}

/**
 * Execute a Gemini AI operation with automatic key rotation and model cascading
 */
export async function executeWithKeyRotation<T>(
  operation: (ai: GoogleGenAI, keyEntry: GeminiKeyEntry, model: string) => Promise<T>,
  options: {
    models?: string[];
    perAttemptTimeoutMs?: number;
    logPrefix?: string;
  } = {}
): Promise<{ result: T; keyUsed: string; modelUsed: string }> {
  const pool = getGeminiKeyPool();
  const logPrefix = options.logPrefix || "[Gemini Rotation]";

  if (pool.length === 0) {
    throw new Error("No valid Gemini API key configured. Please add GEMINI_API_KEY in environment variables.");
  }

  const models = options.models || [
    "gemini-3.1-flash-lite-preview",
    "gemini-3-flash-preview",
    "gemini-3.1-flash-lite",
    "gemini-3.6-flash",
    "gemini-3.7-flash",
    "gemini-2.5-flash",
  ];
  const timeoutMs = options.perAttemptTimeoutMs || 8000;

  let lastError: any = null;

  // Try each unique key in the pool
  for (let kIdx = 0; kIdx < pool.length; kIdx++) {
    const keyEntry = pool[kIdx];
    const ai = new GoogleGenAI({ apiKey: keyEntry.key });

    // Try models in cascade order for this key
    for (const model of models) {
      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout (${timeoutMs}ms) on model ${model}`)), timeoutMs)
        );

        const opPromise = operation(ai, keyEntry, model);
        const result = await Promise.race([opPromise, timeoutPromise]);

        if (result) {
          return {
            result,
            keyUsed: keyEntry.name,
            modelUsed: model,
          };
        }
      } catch (err: any) {
        lastError = err;
        const msg = err?.message || String(err);
        console.warn(`${logPrefix} Key "${keyEntry.name}" with model "${model}" failed: ${msg}`);

        // If it's a rate limit / quota exhaustion, break out of models for this key immediately and rotate to the next key!
        if (isRotateableError(err) && (msg.includes("429") || msg.includes("quota") || msg.includes("exhausted") || msg.includes("permission_denied"))) {
          console.warn(`${logPrefix} Quota/Permission issue detected on "${keyEntry.name}". Rotating to next key...`);
          break; // move to next key in pool
        }
      }
    }
  }

  throw lastError || new Error("All configured Gemini API keys and models failed.");
}

