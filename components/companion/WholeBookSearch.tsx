"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  BookPolicy,
  BuildProgress,
  MAX_INDEX_PAGES,
  addSemanticVectors,
  buildBookIndex,
  fetchBookPolicy,
  loadBookIndex,
} from "@/lib/companion/book-index";

type Status = "checking" | "blocked" | "off" | "building" | "lexical" | "embedding" | "semantic" | "error";

/**
 * Whole-book search controls for the open book. Building happens in this browser; nothing is uploaded
 * unless the reader (signed in) also turns on semantic search for a rights-cleared title.
 */
export default function WholeBookSearch({ bookId, totalPages, signedIn }: { bookId: string; totalPages: number; signedIn: boolean }) {
  const [status, setStatus] = useState<Status>("checking");
  const [policy, setPolicy] = useState<BookPolicy | null>(null);
  const [progress, setProgress] = useState<BuildProgress | null>(null);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("checking");
    setError("");
    (async () => {
      const p = await fetchBookPolicy(bookId);
      if (cancelled) return;
      setPolicy(p);
      if (!p.bookWideAllowed) return setStatus("blocked");
      const index = await loadBookIndex(bookId);
      if (!cancelled) setStatus(index ? (index.vectors ? "semantic" : "lexical") : "off");
    })();
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [bookId]);

  const run = async (kind: "lexical" | "semantic") => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError("");
    setStatus(kind === "lexical" ? "building" : "embedding");
    try {
      if (kind === "lexical") await buildBookIndex(bookId, setProgress, controller.signal);
      else await addSemanticVectors(bookId, setProgress, controller.signal);
      setStatus(kind === "lexical" ? "lexical" : "semantic");
    } catch (err: any) {
      if (err?.name === "AbortError") {
        setStatus(kind === "lexical" ? "off" : "lexical");
      } else {
        setError(err?.message || "Something went wrong.");
        setStatus(kind === "lexical" ? "off" : "lexical");
      }
    } finally {
      setProgress(null);
    }
  };

  const bar = progress && (
    <div className="mt-1.5">
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--border)]">
        <div
          className="h-full bg-gradient-to-r from-[var(--accent-glow)] to-[var(--accent-secondary)] transition-[width] duration-300"
          style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }}
        />
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-[var(--text-secondary)]">
        <span>
          {progress.phase === "reading" ? "Reading pages in your browser" : "Creating semantic vectors"} · {progress.done}/{progress.total}
        </span>
        <button type="button" onClick={() => abortRef.current?.abort()} className="cursor-pointer font-semibold hover:text-[var(--foreground)]">
          Cancel
        </button>
      </div>
    </div>
  );

  const btn =
    "cursor-pointer rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-2 py-1 text-[10px] font-semibold text-[var(--accent)] hover:bg-[var(--accent)]/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";

  return (
    <div className="text-[11px] text-[var(--text-secondary)]" aria-live="polite">
      {status === "checking" && <span>Checking whole-book search…</span>}
      {status === "blocked" && <span title={policy?.reason}>Page-by-page help · rights for this title aren&apos;t cleared for whole-book search</span>}
      {status === "off" && (
        <div className="flex items-center justify-between gap-2">
          <span>Whole-book search is off</span>
          <button type="button" className={btn} onClick={() => run("lexical")} title="Reads the book in your browser to find passages beyond the open pages">
            Search whole book
          </button>
        </div>
      )}
      {(status === "building" || status === "embedding") && bar}
      {status === "lexical" && (
        <div className="flex items-center justify-between gap-2">
          <span>
            ✓ Whole-book search on{totalPages > MAX_INDEX_PAGES ? ` (first ${MAX_INDEX_PAGES} pages)` : ""}
          </span>
          {signedIn && (
            <button type="button" className={btn} onClick={() => run("semantic")} title="Adds meaning-based search using AI embeddings">
              Add deep search
            </button>
          )}
        </div>
      )}
      {status === "semantic" && <span>✓ Whole-book deep search on</span>}
      {error && <div className="mt-1 text-[10px] text-[#b4321f]">{error}</div>}
    </div>
  );
}
