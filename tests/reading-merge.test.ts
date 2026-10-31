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

const existing = { bookId: "test-book", page: 200, totalPages: 328, progress: 61, lastReadAt: 1000 };

test("opening a book without page info never rewrites its page count (detail-page regression)", () => {
  const res = computeReadingProgress(existing, "test-book", undefined, undefined, 328, 5000);
  assert.equal(res.changed, false);
  assert.equal(res.isNewCompletion, false);
  assert.deepEqual(res.item, existing);
});

test("the old default (page 1 / 100 pages) is no longer injected for unknown totals", () => {
  const res = computeReadingProgress(existing, "test-book", 1, undefined, 328);
  assert.equal(res.item.totalPages, 328);
  assert.equal(res.item.page, 200);
  assert.equal(res.isNewCompletion, false);
});

test("first open uses the known page count; an unknown total stays unknown (never a 100-page default)", () => {
  assert.equal(computeReadingProgress(undefined, "x", undefined, undefined, 328).item.totalPages, 328);
  const unknown = computeReadingProgress(undefined, "x");
  assert.equal(unknown.item.totalPages, 0);
  assert.equal(unknown.item.progress, 0);
  assert.equal(unknown.isNewCompletion, false);
  assert.equal(unknown.changed, true);
});

test("reaching the last page is a new completion exactly once", () => {
  const first = computeReadingProgress(existing, "test-book", 328, 328);
  assert.equal(first.isNewCompletion, true);
  assert.equal(first.item.progress, 100);
  const again = computeReadingProgress(first.item, "test-book", 328, 328);
  assert.equal(again.isNewCompletion, false);
  assert.equal(again.changed, false);
});

test("page <= 1 keeps the saved position (existing behaviour preserved)", () => {
  assert.equal(computeReadingProgress(existing, "test-book", 1, 328).item.page, 200);
  assert.equal(computeReadingProgress(existing, "test-book", 0, 0).item.page, 200);
});

test("progress merge keeps the furthest page and the larger real page count", () => {
  const corrupted = { bookId: "test-book", page: 200, totalPages: 100, progress: 100, lastReadAt: 5 };
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
  assert.equal(isSafeBookId("The Conquest of Happiness"), true, "catalogue IDs with inner spaces are valid");
  assert.equal(isSafeBookId("a/b"), false, "would break Firestore paths");
  assert.equal(isSafeBookId(" padded"), false);
  assert.equal(isSafeBookId("line\nbreak"), false);
  assert.equal(isSafeBookId("x".repeat(201)), false);
});

// ---------------------------------------------------------------- Account-level merges

test("collections: union by ID, newest metadata wins, idempotent", async () => {
  const { mergeCollectionLists } = await import("../lib/reading-merge");
  const cloud = [{ id: "c1", name: "Old name", bookIds: ["a"], createdAt: 1, updatedAt: 10 }];
  const local = [
    { id: "c1", name: "New name", bookIds: ["b"], createdAt: 1, updatedAt: 20 },
    { id: "c2", name: "Local only", bookIds: [], createdAt: 5, updatedAt: 5 },
  ];
  const first = mergeCollectionLists(cloud, local);
  assert.equal(first.cloudNeedsUpdate, true);
  assert.deepEqual(first.merged.find((c) => c.id === "c1")!.bookIds, ["a", "b"]);
  assert.equal(first.merged.find((c) => c.id === "c1")!.name, "New name");
  const again = mergeCollectionLists(first.merged, local);
  assert.equal(again.cloudNeedsUpdate, false, "nothing new to upload the second time");
  assert.deepEqual(again.merged, first.merged);
  // An older local copy never renames the cloud collection
  assert.equal(mergeCollectionLists([{ ...cloud[0], updatedAt: 30 }], local).merged[0].name, "Old name");
});

test("reflections, dismissals and active time only ever grow", async () => {
  const { mergeReflectionMaps, mergeShelfDismissalMaps, mergeActiveTime } = await import("../lib/reading-merge");
  const r = mergeReflectionMaps({ a: { bookId: "a", reflection: "cloud", completedAt: 20 } }, { a: { bookId: "a", reflection: "older", completedAt: 10 }, b: { bookId: "b", reflection: "new", completedAt: 5 } });
  assert.equal(r.merged.a.reflection, "cloud");
  assert.equal(r.merged.b.reflection, "new");
  assert.equal(r.cloudNeedsUpdate, true);
  assert.equal(mergeReflectionMaps(r.merged, r.merged).cloudNeedsUpdate, false);

  const d = mergeShelfDismissalMaps({ s: { x: true } }, { s: { y: true }, t: { z: true } });
  assert.deepEqual(d.merged, { s: { x: true, y: true }, t: { z: true } });
  assert.equal(mergeShelfDismissalMaps(d.merged, { s: { x: true } }).cloudNeedsUpdate, false);

  const t = mergeActiveTime({ totalActiveSeconds: 100, daily: { d1: 100 }, lastUpdated: 1 }, { totalActiveSeconds: 80, daily: { d1: 60, d2: 20 }, lastUpdated: 2 });
  assert.deepEqual(t.merged.daily, { d1: 100, d2: 20 }, "per-day maxima, never summed");
  assert.equal(t.merged.totalActiveSeconds, 100);
  assert.equal(t.cloudNeedsUpdate, true);
  assert.equal(mergeActiveTime(t.merged, t.merged).cloudNeedsUpdate, false);
});

test("findItemsMissingFromCloud lists exactly what only this device holds", async () => {
  const { findItemsMissingFromCloud } = await import("../lib/reading-merge");
  const local = {
    favorites: ["a", "b"],
    readingHistory: [{ bookId: "a", page: 50, totalPages: 100, progress: 50, lastReadAt: 1 }],
    bookmarks: { a: [{ id: "bm1", bookId: "a", page: 3, createdAt: 1 }, { id: "bm2", bookId: "a", page: 7, createdAt: 1 }] },
    annotations: { a: { highlights: [{ id: "h1" } as any], notes: [], drawings: { 4: [] as any } } },
  };
  const cloud = {
    favorites: ["a"],
    readingHistory: [{ bookId: "a", page: 60, totalPages: 100, progress: 60, lastReadAt: 2 }],
    bookmarks: { a: [{ id: "other-id", bookId: "a", page: 3, createdAt: 1 }] },
    annotations: { a: { highlights: [], notes: [], drawings: {} } },
  };
  assert.deepEqual(findItemsMissingFromCloud(local, cloud).sort(), ["bookmark:a:bm2", "drawing:a:4", "favorite:b", "highlight:a:h1"]);
  assert.deepEqual(findItemsMissingFromCloud(local, { ...local, readingHistory: cloud.readingHistory }), []);
});
