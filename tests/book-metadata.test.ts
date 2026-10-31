/**
 * Book metadata integrity: page counts come from the real PDFs, saved progress is read through them,
 * and a wrong (e.g. 100-page) denominator can never fake a completion. Real catalogue books are used.
 */
import "./setup";
import { memoryStorage } from "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { BOOKS, getBookById } from "../data/books";
import { getVerifiedPageCount, progressPercent } from "../lib/book-pages";
import { computeReadingProgress, isFinishedReading, mergeProgressItems, normalizeProgressItem } from "../lib/reading-merge";
import * as rs from "../lib/reader-storage";
import { searchCatalog } from "../lib/search/catalog-search";
import { getRelatedBooksWithReasons, generateRecommendations } from "../lib/recommendations";

const audit = JSON.parse(fs.readFileSync("data/catalogue-audit.json", "utf8"));
const rec = (bookId: string, page: number, totalPages: number, progress = 0) => ({ bookId, page, totalPages, progress, lastReadAt: 1 });

beforeEach(() => {
  memoryStorage.clear();
  rs.invalidateAllCaches();
  rs.setActiveUserUid(null);
});

// ---------------------------------------------------------------- Catalogue audit coverage

test("every catalogue book has a verified PDF page count and the catalogue matches it", () => {
  assert.equal(audit.summary.total, BOOKS.length);
  assert.equal(audit.summary.unavailable, 0);
  for (const b of BOOKS) {
    const verified = getVerifiedPageCount(b.id);
    assert.ok(verified && verified > 0, `${b.id} has a verified count`);
    assert.equal(Number(b.pages), verified, `${b.id}: catalogue pages equal the PDF`);
  }
  assert.equal(new Set(BOOKS.map((b) => b.id)).size, BOOKS.length, "book IDs are unique");
});

test("unusual counts are real: 1-page and 4,263-page PDFs, and the 2-page cheat sheet", () => {
  assert.equal(getVerifiedPageCount("moun-sangeet-letters-collection"), 1);
  assert.equal(getVerifiedPageCount("geeta-darshan"), 4263);
  assert.equal(getVerifiedPageCount("git-quick-reference-cheat-sheet"), 2);
});

test("a missing or unknown PDF has no invented page count", () => {
  assert.equal(getVerifiedPageCount("no-such-book"), null);
  assert.equal(getVerifiedPageCount(""), null);
  assert.equal(progressPercent(50, 0), 0, "unknown total never yields a percentage");
  const r = computeReadingProgress(undefined, "no-such-book", 40);
  assert.equal(r.item.totalPages, 0);
  assert.equal(r.isNewCompletion, false);
});

// ---------------------------------------------------------------- Saved records with a wrong denominator

test("a saved 100-page record is read against the real PDF, keeping the reader's page (1984: 394 pages)", () => {
  const fixed = normalizeProgressItem(rec("1984", 100, 100, 100));
  assert.equal(fixed.item.totalPages, 394);
  assert.equal(fixed.item.page, 100, "current page preserved");
  assert.equal(fixed.item.progress, 25, "progress recalculated from the real total");
  assert.equal(isFinishedReading(rec("1984", 100, 100, 100)), false, "page 100 of 394 is not finished");
});

test("a book near 347 pages (dhyan-sutra, 348): Page 71 of 348, completion only on the last page", () => {
  const r = computeReadingProgress(undefined, "dhyan-sutra", 71);
  assert.equal(r.item.totalPages, 348);
  assert.equal(r.item.progress, 20);
  assert.equal(r.isNewCompletion, false);
  const end = computeReadingProgress(r.item, "dhyan-sutra", 348, 348);
  assert.equal(end.isNewCompletion, true);
  assert.equal(computeReadingProgress(end.item, "dhyan-sutra", 348, 348).isNewCompletion, false, "reopening never repeats it");
});

test("a page beyond the real PDF (left from another file) is clamped but never counts as finished", () => {
  const stale = rec("the-hard-thing-about-hard-things", 50, 120, 41); // the PDF has 8 pages
  const n = normalizeProgressItem(stale);
  assert.equal(n.inconsistent, true);
  assert.equal(n.item.page, 8);
  assert.ok(n.item.progress < 100);
  assert.equal(isFinishedReading(stale), false);
  assert.equal(computeReadingProgress(stale, "the-hard-thing-about-hard-things").isNewCompletion, false, "opening the detail page does not complete it");
  assert.equal(computeReadingProgress(stale, "the-hard-thing-about-hard-things", 8, 8).isNewCompletion, true, "actually reading to the end does");
});

test("correcting the denominator never creates a completion on its own", () => {
  // Saved as 'finished' only because of a 100-page default; just opening the book must not re-complete it
  const r = computeReadingProgress(rec("1984", 100, 100, 100), "1984");
  assert.equal(r.isNewCompletion, false);
  assert.equal(r.item.page, 100);
  assert.equal(r.item.totalPages, 394);
});

test("single- and two-page layouts: the reader's numPages wins and the last page completes the book", () => {
  // Two-page mode on an even-length book lands on numPages; on an odd one it is clamped to numPages
  for (const [id, pages] of [["1984", 394], ["the-great-gatsby", 66]] as const) {
    const live = computeReadingProgress(undefined, id, pages - 1, pages);
    assert.equal(live.isNewCompletion, false);
    assert.equal(computeReadingProgress(live.item, id, pages, pages).isNewCompletion, true);
  }
});

test("merging devices keeps the furthest real page and the verified total", () => {
  const merged = mergeProgressItems(rec("1984", 120, 100, 100), rec("1984", 80, 328, 24));
  assert.deepEqual([merged.page, merged.totalPages, merged.progress], [120, 394, 30]);
});

// ---------------------------------------------------------------- Storage, completion and isolation

test("stored history is read through verified counts; completion ignores a stale 100%", () => {
  rs.saveStoredReadingHistory([rec("1984", 100, 100, 100), rec("the-great-gatsby", 66, 180, 37)], "user-a");
  const hist = rs.getStoredReadingHistory("user-a");
  assert.deepEqual(hist.map((h) => [h.bookId, h.page, h.totalPages, h.progress]), [["1984", 100, 394, 25], ["the-great-gatsby", 66, 66, 100]]);
  const done = rs.getGenuinelyCompletedBookIds(undefined, {}, "user-a");
  assert.deepEqual(done, ["the-great-gatsby"], "Gatsby really finished (page 66 of 66); 1984 at page 100 of 394 is not");
  // Raw storage is not rewritten by reading it
  assert.ok(memoryStorage.getItem(rs.getHistoryStorageKey("user-a"))!.includes('"totalPages":100'));
});

test("guest and account progress stay isolated; guest migration uses the verified total", () => {
  rs.saveStoredReadingHistory([rec("1984", 50, 100, 50)], null);
  assert.deepEqual(rs.getStoredReadingHistory("user-b"), [], "an account never sees guest data implicitly");
  rs.migrateGuestDataToUser("user-b");
  const migrated = rs.getStoredReadingHistory("user-b");
  assert.deepEqual(migrated.map((h) => [h.page, h.totalPages]), [[50, 394]]);
});

// ---------------------------------------------------------------- Identity in search and recommendations

test("search results and recommendations always carry the matching catalogue identity", () => {
  for (const hit of searchCatalog("orwell").hits) assert.equal(getBookById(hit.book.id), hit.book);
  for (const r of getRelatedBooksWithReasons(getBookById("1984")!)) {
    const cat = getBookById(r.book.id)!;
    assert.deepEqual([r.book.title, r.book.author, r.book.cover], [cat.title, cat.author, cat.cover]);
  }
  for (const s of generateRecommendations([rec("1984", 10, 394, 3)], ["meditations"]).sections) {
    for (const b of s.books) assert.equal(getBookById(b.id), b);
  }
});
