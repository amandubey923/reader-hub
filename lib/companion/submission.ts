/**
 * Decides what to do with a message the reader submits to Bodhi, so one utterance starts at most one request.
 * - The same message again while it is being answered, or within a few seconds (double click, repeated
 *   Enter, a re-fired voice event), is dropped.
 * - A different message sent while one is being answered is queued and sent next, never lost.
 */

import type { CompanionBookCard } from "./types";

export const DUPLICATE_WINDOW_MS = 4000;
export const MAX_QUEUED = 3;

export function normalizeMessage(text: string): string {
  return (text || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
    .trim();
}

export interface SubmissionState {
  /** Normalised text of the message being answered, if any. */
  inFlight: string | null;
  /** Normalised texts waiting to be sent. */
  queued: string[];
  /** Last message actually sent, and when. */
  lastText: string | null;
  lastAt: number;
}

export type SubmissionDecision = "send" | "queue" | "drop";

export const EMPTY_SUBMISSION_STATE: SubmissionState = { inFlight: null, queued: [], lastText: null, lastAt: 0 };

export function decideSubmission(text: string, state: SubmissionState, now: number = Date.now()): SubmissionDecision {
  const n = normalizeMessage(text);
  if (!n) return "drop";
  if (state.inFlight !== null) {
    if (n === state.inFlight || state.queued.includes(n) || state.queued.length >= MAX_QUEUED) return "drop";
    return "queue";
  }
  if (state.lastText === n && now - state.lastAt < DUPLICATE_WINDOW_MS) return "drop";
  return "send";
}

/** One card per book, in order (the model can mention the same book several times). */
export function uniqueBooks(books: CompanionBookCard[] | undefined): CompanionBookCard[] {
  const seen = new Set<string>();
  return (books || []).filter((b) => {
    if (!b?.id || seen.has(b.id)) return false;
    seen.add(b.id);
    return true;
  });
}
