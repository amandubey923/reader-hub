"use client";

/**
 * Narrow bridge between the PDF reader (components/reader/BookReader.tsx) and the AI companion.
 * The reader registers read-only getters plus a few allow-listed actions that reuse its own logic;
 * the companion never touches reader state, LocalStorage or Firestore directly.
 */

import { useSyncExternalStore } from "react";

export interface ReaderSnapshot {
  bookId: string;
  title: string;
  author: string;
  currentPage: number;
  totalPages: number;
  visiblePages: number[];
  layout: "single" | "double";
  chapter?: string;
  selection?: { text: string; pageNum: number };
  isLoaded: boolean;
}

export interface ReaderBridge {
  getSnapshot(): ReaderSnapshot;
  /** Plain text of one page via PDF.js (cached by the reader). */
  getPageText(pageNum: number): Promise<string>;
  goToPage(pageNum: number): boolean;
  nextPage(): boolean;
  previousPage(): boolean;
  addBookmark(pageNum: number): { ok: boolean; alreadyExisted?: boolean };
  addNote(pageNum: number, text: string): boolean;
}

let currentBridge: ReaderBridge | null = null;
let version = 0;
let cachedVersion = -1;
let cachedSnapshot: ReaderSnapshot | null = null;
const listeners = new Set<() => void>();

function emit() {
  version++;
  listeners.forEach((l) => l());
}

export function registerReaderBridge(bridge: ReaderBridge): () => void {
  currentBridge = bridge;
  emit();
  return () => {
    if (currentBridge === bridge) {
      currentBridge = null;
      emit();
    }
  };
}

/** Called by the reader whenever page, layout, selection or loading state changes. */
export function notifyReaderChanged(): void {
  emit();
}

export function getReaderBridge(): ReaderBridge | null {
  return currentBridge;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ReaderSnapshot | null {
  if (cachedVersion !== version) {
    cachedVersion = version;
    cachedSnapshot = currentBridge ? currentBridge.getSnapshot() : null;
  }
  return cachedSnapshot;
}

export function useReaderSnapshot(): ReaderSnapshot | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}

/**
 * Resolves once `predicate` holds for the reader snapshot, or with null after `timeoutMs`.
 * Used to confirm that an action really happened before telling the reader it did.
 */
export function waitForReader(
  predicate: (snapshot: ReaderSnapshot) => boolean,
  timeoutMs = 2500
): Promise<ReaderSnapshot | null> {
  return new Promise((resolve) => {
    const check = () => {
      const snap = getSnapshot();
      if (snap && predicate(snap)) {
        cleanup();
        resolve(snap);
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs);
    const unsubscribe = subscribe(check);
    const cleanup = () => {
      clearTimeout(timer);
      unsubscribe();
    };
    check();
  });
}
