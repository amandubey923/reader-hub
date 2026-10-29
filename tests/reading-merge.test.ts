import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeReadingProgress,
  mergeAnnotations,
  mergeBookmarkLists,
  mergeProgressItems,
  mergeReadingMemory,
  annotationsAddContent,
  isSafeBookId,
} from "../lib/reading-merge";

const existing = { bookId: "1984", page: 200, totalPages: 328, progress: 61, lastReadAt: 1000 };

test("opening a book without page info never rewrites its page count (detail-page regression)", () => {
  const res = computeReadingProgress(existing, "1984", undefined, undefined, 328, 5000);
  assert.equal(res.changed, false);
  assert.equal(res.isNewCompletion, false);
  assert.deepEqual(res.item, existing);
});

test("the old default (page 1 / 100 pages) is no longer injected for unknown totals", () => {
  const res = computeReadingProgress(existing, "1984", 1, undefined, 328);
  assert.equal(res.item.totalPages, 328);
  assert.equal(res.item.page, 200);
  assert.equal(res.isNewCompletion, false);
});

test("first open uses catalog page count, falls back to 100 only when nothing is known", () => {
  assert.equal(computeReadingProgress(undefined, "x", undefined, undefined, 328).item.totalPages, 328);
  assert.equal(computeReadingProgress(undefined, "x").item.totalPages, 100);
  assert.equal(computeReadingProgress(undefined, "x").changed, true);
});

test("reaching the last page is a new completion exactly once", () => {
  const first = computeReadingProgress(existing, "1984", 328, 328);
  assert.equal(first.isNewCompletion, true);
  assert.equal(first.item.progress, 100);
  const again = computeReadingProgress(first.item, "1984", 328, 328);
  assert.equal(again.isNewCompletion, false);
  assert.equal(again.changed, false);
});

test("page <= 1 keeps the saved position (existing behaviour preserved)", () => {
  assert.equal(computeReadingProgress(existing, "1984", 1, 328).item.page, 200);
  assert.equal(computeReadingProgress(existing, "1984", 0, 0).item.page, 200);
});

test("progress merge keeps the furthest page and the larger real page count", () => {
  const corrupted = { bookId: "1984", page: 200, totalPages: 100, progress: 100, lastReadAt: 5 };
  const merged = mergeProgressItems(corrupted, existing);
  assert.equal(merged.page, 200);
  assert.equal(merged.totalPages, 328);
  assert.equal(merged.lastReadAt, 1000);
});

test("bookmark merge unions by id, keeps one per page, sorted", () => {
  const a = [{ id: "b1", bookId: "x", page: 5, createdAt: 1 }];
  const b = [
    { id: "b1", bookId: "x", page: 5, createdAt: 1 },
    { id: "b2", bookId: "x", page: 2, createdAt: 2 },
    { id: "b3", bookId: "x", page: 5, createdAt: 3 },
  ];
  const merged = mergeBookmarkLists(a, b);
  assert.deepEqual(merged.map((m) => m.id), ["b2", "b1"]);
  assert.deepEqual(mergeBookmarkLists(undefined as any, null as any), []);
});

test("annotation merge is non-destructive and detects new content", () => {
  const base = { highlights: [{ id: "h1" } as any], notes: [], drawings: { 3: [] as any[] } };
  const incoming = { highlights: [{ id: "h1" } as any, { id: "h2" } as any], notes: [{ id: "n1" } as any], drawings: { 7: [] as any[] } };
  const merged = mergeAnnotations(base, incoming);
  assert.equal(merged.highlights.length, 2);
  assert.equal(merged.notes.length, 1);
  assert.deepEqual(Object.keys(merged.drawings).sort(), ["3", "7"]);
  assert.equal(annotationsAddContent(base, incoming), true);
  assert.equal(annotationsAddContent(merged, base), false);
});

test("reading memory merge never double counts", () => {
  const m = mergeReadingMemory(
    { bookId: "x", totalSeconds: 300, sessionsCount: 2, firstReadAt: 10, lastReadAt: 20, timeline: [] },
    { bookId: "x", totalSeconds: 200, sessionsCount: 5, firstReadAt: 5, lastReadAt: 30, timeline: [] },
    "x"
  );
  assert.equal(m.totalSeconds, 300);
  assert.equal(m.sessionsCount, 5);
  assert.equal(m.firstReadAt, 5);
  assert.equal(m.lastReadAt, 30);
});

test("book IDs that could break storage keys are rejected", () => {
  assert.equal(isSafeBookId("the-great-gatsby"), true);
  assert.equal(isSafeBookId("uid:book"), false);
  assert.equal(isSafeBookId(""), false);
  assert.equal(isSafeBookId(42), false);
});
