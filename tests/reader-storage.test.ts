import { memoryStorage } from "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  addHighlight,
  clearAllUserDataOnLogout,
  exportAllUserData,
  getAllReadingMemories,
  getBookAnnotations,
  getBookmarks,
  getBookReadingMemory,
  getSavedProgress,
  getStoredFavorites,
  getStoredReadingHistory,
  hydrateStorageFromCloudData,
  importUserData,
  invalidateAllCaches,
  migrateGuestDataToUser,
  saveBookmark,
  saveStoredFavorites,
  saveStoredReadingHistory,
  setActiveUserUid,
} from "../lib/reader-storage";

const USER_A = "userA";
const USER_B = "userB";

beforeEach(() => {
  memoryStorage.clear();
  invalidateAllCaches();
  setActiveUserUid(null);
});

test("signed-in reads never inherit guest data implicitly", () => {
  saveStoredFavorites(["1984"], null);
  saveStoredReadingHistory([{ bookId: "1984", page: 9, totalPages: 328, progress: 3, lastReadAt: 1 }], null);
  memoryStorage.setItem("readershub:memory:v1:1984", JSON.stringify({ bookId: "1984", totalSeconds: 600, timeline: [] }));
  memoryStorage.setItem("readershub:progress:v1:1984", JSON.stringify({ bookId: "1984", page: 9, totalPages: 328 }));

  assert.deepEqual(getStoredFavorites(USER_B), []);
  assert.deepEqual(getStoredReadingHistory(USER_B), []);
  assert.equal(getSavedProgress("1984", USER_B), null);
  assert.equal(getBookReadingMemory("1984", USER_B).totalSeconds, 0);
  assert.deepEqual(Object.keys(getAllReadingMemories(USER_B)), []);

  // Guest view is unchanged
  assert.deepEqual(getStoredFavorites(null), ["1984"]);
});

test("login migrates guest per-book data (annotations, bookmarks, progress, memory) into the account", () => {
  addHighlight("1984", { bookId: "1984", page: 4, text: "War is peace", color: "amber" }, null);
  saveBookmark("1984", 12, "Guest bookmark", null);
  memoryStorage.setItem("readershub:progress:v1:guest:1984", JSON.stringify({ bookId: "1984", page: 40, totalPages: 328, progress: 12, lastReadAt: 5 }));
  memoryStorage.setItem("readershub:memory:v1:1984", JSON.stringify({ bookId: "1984", totalSeconds: 900, sessionsCount: 1, timeline: [] }));

  migrateGuestDataToUser(USER_A);

  assert.equal(getBookAnnotations("1984", USER_A).highlights.length, 1);
  assert.equal(getBookmarks("1984", USER_A).length, 1);
  assert.equal(getSavedProgress("1984", USER_A)?.page, 40);
  assert.equal(getBookReadingMemory("1984", USER_A).totalSeconds, 900);
});

test("migration merges with existing account data instead of overwriting it", () => {
  addHighlight("1984", { bookId: "1984", page: 1, text: "account", color: "mint" }, USER_A);
  saveBookmark("1984", 30, "Account bookmark", USER_A);
  addHighlight("1984", { bookId: "1984", page: 2, text: "guest", color: "amber" }, null);
  saveBookmark("1984", 12, "Guest bookmark", null);

  migrateGuestDataToUser(USER_A);
  migrateGuestDataToUser(USER_A); // idempotent on repeat logins

  assert.equal(getBookAnnotations("1984", USER_A).highlights.length, 2);
  assert.deepEqual(getBookmarks("1984", USER_A).map((b) => b.page), [12, 30]);
});

test("logout clears guest keys (including legacy ones) but never account data", () => {
  saveStoredFavorites(["1984"], null);
  saveStoredReadingHistory([{ bookId: "1984", page: 9, totalPages: 328, progress: 3, lastReadAt: 1 }], null);
  saveBookmark("1984", 12, undefined, null);
  saveStoredFavorites(["godan"], USER_A);
  saveBookmark("godan", 3, undefined, USER_A);

  clearAllUserDataOnLogout();

  assert.deepEqual(getStoredFavorites(null), []);
  assert.deepEqual(getStoredReadingHistory(null), []);
  assert.equal(memoryStorage.getItem("readers_hub_favorites_v2"), null);
  assert.equal(memoryStorage.getItem("readershub:bookmarks:v1:1984"), null);
  assert.deepEqual(getStoredFavorites(USER_A), ["godan"]);
  assert.equal(getBookmarks("godan", USER_A).length, 1);

  // The next account on this device starts clean
  migrateGuestDataToUser(USER_B);
  assert.deepEqual(getStoredFavorites(USER_B), []);
});

test("export contains the signed-in reader's own annotations and bookmarks only", () => {
  addHighlight("1984", { bookId: "1984", page: 4, text: "mine", color: "amber" }, USER_A);
  saveBookmark("1984", 12, undefined, USER_A);
  saveBookmark("godan", 3, undefined, USER_B);

  const exported = JSON.parse(exportAllUserData(USER_A));
  assert.deepEqual(Object.keys(exported.annotations), ["1984"]);
  assert.deepEqual(Object.keys(exported.bookmarks), ["1984"]);
  assert.equal(exported.bookmarks["1984"].length, 1);
});

test("import restores into the reader's namespace and merges instead of overwriting", () => {
  saveStoredFavorites(["godan"], USER_A);
  saveStoredReadingHistory([{ bookId: "1984", page: 200, totalPages: 328, progress: 61, lastReadAt: 10 }], USER_A);

  const backup = JSON.stringify({
    favorites: ["1984", "bad:id"],
    readingHistory: [
      { bookId: "1984", page: 50, totalPages: 328, progress: 15, lastReadAt: 5 },
      { bookId: "meditations", page: 7, totalPages: 120, progress: 6, lastReadAt: 6 },
    ],
    bookmarks: { meditations: [{ id: "bm1", bookId: "meditations", page: 7, createdAt: 1 }] },
  });

  const res = importUserData(backup, USER_A);
  assert.equal(res.success, true);
  assert.equal(res.skippedCount, 1);
  assert.deepEqual(getStoredFavorites(USER_A).sort(), ["1984", "godan"]);
  const hist = getStoredReadingHistory(USER_A);
  assert.equal(hist.find((h) => h.bookId === "1984")?.page, 200, "existing progress is never rewound");
  assert.ok(hist.find((h) => h.bookId === "meditations"));
  assert.equal(getBookmarks("meditations", USER_A).length, 1);
  assert.deepEqual(getStoredFavorites(null), [], "guest namespace untouched");
});

test("import rejects non-object payloads", () => {
  assert.equal(importUserData("[1,2]", USER_A).success, false);
  assert.equal(importUserData("not json", USER_A).success, false);
});

test("cloud bookmarks are restored and merged with local ones", () => {
  saveBookmark("1984", 30, undefined, USER_A);
  hydrateStorageFromCloudData(
    { bookmarks: { "1984": [{ id: "cloud1", bookId: "1984", page: 5, createdAt: 1 }] } },
    USER_A
  );
  assert.deepEqual(getBookmarks("1984", USER_A).map((b) => b.page), [5, 30]);
});
