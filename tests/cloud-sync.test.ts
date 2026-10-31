/**
 * Zero-data-loss sync scenarios, run against an in-memory Firestore fake (no emulator needed).
 * The fake implements only the SDK calls lib/firestore-sync uses, with Firestore's merge semantics
 * (maps merge recursively, arrays are replaced) and injectable read/write failures.
 */
import "./setup";
import { memoryStorage } from "./setup";
import { test, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

// ---------------------------------------------------------------- Fake Firestore

type Data = Record<string, any>;
const store = new Map<string, Data>();
const failReads = new Set<string>(); // path prefixes whose reads throw (offline / permission denied)
const failWrites = new Set<string>(); // path prefixes whose writes throw (interrupted / quota)
let writeCount = 0;

const join = (segments: string[]) => segments.join("/");
const matches = (set: Set<string>, path: string) => Array.from(set).some((p) => path === p || path.startsWith(p + "/"));
const isPlainObject = (v: unknown): v is Data => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
function deepMerge(target: Data, src: Data): Data {
  const out: Data = { ...target };
  for (const [k, v] of Object.entries(src)) out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : clone(v);
  return out;
}
const snapshot = (path: string) => {
  const data = store.get(path);
  return { id: path.split("/").pop()!, ref: { path }, exists: () => data !== undefined, data: () => (data ? clone(data) : undefined) };
};
const write = (path: string, apply: () => void) => {
  if (matches(failWrites, path)) throw new Error(`fake: write failed for ${path}`);
  writeCount++;
  apply();
};

const fakeFirestore = {
  doc: (_db: unknown, ...segments: string[]) => ({ path: join(segments) }),
  collection: (_db: unknown, ...segments: string[]) => ({ path: join(segments) }),
  query: (ref: unknown) => ref,
  where: () => ({}),
  serverTimestamp: () => Date.now(),
  arrayRemove: (...values: unknown[]) => ({ __arrayRemove: values }),
  async getDoc(ref: { path: string }) {
    if (matches(failReads, ref.path)) throw new Error(`fake: offline reading ${ref.path}`);
    return snapshot(ref.path);
  },
  async getDocs(ref: { path: string }) {
    if (matches(failReads, ref.path)) throw new Error(`fake: offline reading ${ref.path}`);
    const depth = ref.path.split("/").length + 1;
    const docs = Array.from(store.keys())
      .filter((p) => p.startsWith(ref.path + "/") && p.split("/").length === depth)
      .map(snapshot);
    return { docs, size: docs.length, empty: docs.length === 0, forEach: (fn: (d: unknown) => void) => docs.forEach(fn) };
  },
  async setDoc(ref: { path: string }, data: Data, options?: { merge?: boolean }) {
    write(ref.path, () => store.set(ref.path, options?.merge ? deepMerge(store.get(ref.path) || {}, data) : clone(data)));
  },
  async updateDoc(ref: { path: string }, data: Data) {
    if (!store.has(ref.path)) throw new Error("fake: no document to update");
    write(ref.path, () => {
      const cur = store.get(ref.path)!;
      for (const [k, v] of Object.entries(data)) {
        if (v && (v as any).__arrayRemove) cur[k] = (cur[k] || []).filter((x: unknown) => !(v as any).__arrayRemove.includes(x));
        else cur[k] = v;
      }
    });
  },
  async deleteDoc(ref: { path: string }) {
    write(ref.path, () => store.delete(ref.path));
  },
  writeBatch: () => {
    const ops: (() => Promise<void>)[] = [];
    return {
      set: (ref: { path: string }, data: Data, o?: { merge?: boolean }) => ops.push(() => fakeFirestore.setDoc(ref, data, o)),
      delete: (ref: { path: string }) => ops.push(() => fakeFirestore.deleteDoc(ref)),
      commit: async () => {
        for (const op of ops) await op();
      },
    };
  },
};

const libUrl = (file: string) => pathToFileURL(path.join(process.cwd(), "lib", file)).href;
let sync: typeof import("../lib/firestore-sync");
let rs: typeof import("../lib/reader-storage");
let certs: typeof import("../lib/certificate");

before(async () => {
  // Both the ESM and the CommonJS builds of the SDK, since the code under test is loaded as CommonJS
  mock.module("firebase/firestore", { namedExports: fakeFirestore });
  mock.module(pathToFileURL(require.resolve("firebase/firestore")).href, { namedExports: fakeFirestore });
  mock.module(libUrl("firebase.ts"), {
    namedExports: { db: { fake: true }, getFirebaseDb: () => ({ fake: true }), getFirebaseAuth: () => null, getAuthHeader: async () => ({}) },
  });
  mock.module(libUrl("social.ts"), { namedExports: { ensureUserProfile: async () => {} } });
  sync = await import("../lib/firestore-sync");
  rs = await import("../lib/reader-storage");
  certs = await import("../lib/certificate");
});

const userA = { uid: "user-a", email: "a@example.com", displayName: "A", photoURL: null } as any;
const userB = { uid: "user-b", email: "b@example.com", displayName: "B", photoURL: null } as any;
const now = Date.UTC(2026, 9, 30);

const highlight = (id: string, bookId = "1984", page = 3) => ({ id, bookId, page, text: `text ${id}`, color: "yellow", createdAt: now }) as any;
const annotations = (...hs: any[]) => ({ highlights: hs, notes: [], drawings: {} });
const collectionOf = (id: string, bookIds: string[], updatedAt = now) => ({ id, name: `List ${id}`, bookIds, createdAt: now, updatedAt });

async function reconcileAndFlush(user: any) {
  const result = await sync.reconcileAndSyncAllUserData(user);
  await sync.flushAllPendingSyncs();
  return result;
}

beforeEach(() => {
  sync.cancelAllPendingSyncTimers();
  store.clear();
  failReads.clear();
  failWrites.clear();
  writeCount = 0;
  memoryStorage.clear();
  rs.invalidateAllCaches();
  rs.setActiveUserUid(null);
});

// ---------------------------------------------------------------- Scenarios

test("a failed cloud read never lets this device overwrite that section in the cloud", async () => {
  // Another device already saved a highlight and two collections
  store.set("users/user-a/data/annotations", { annotations: { "1984": annotations(highlight("h-cloud")) } });
  store.set("users/user-a/data/collections", { collections: [collectionOf("c1", ["1984"]), collectionOf("c2", ["the-great-gatsby"])] });
  store.set("users/user-a/data/completed_books", { completedIds: ["meditations", "1984"] });
  // This device has older, partial copies
  rs.saveBookAnnotations("1984", annotations(highlight("h-local")), "user-a");
  rs.saveReadingCollections([collectionOf("c1", ["1984", "jane-eyre"])], "user-a");
  rs.saveStoredFavorites(["jane-eyre"], "user-a");

  failReads.add("users/user-a/data/annotations");
  failReads.add("users/user-a/data/collections");
  failReads.add("users/user-a/data/completed_books");
  await reconcileAndFlush(userA);

  const cloudAnn = store.get("users/user-a/data/annotations")!.annotations["1984"];
  assert.deepEqual(cloudAnn.highlights.map((h: any) => h.id), ["h-cloud"], "cloud highlights untouched");
  assert.equal(store.get("users/user-a/data/collections")!.collections.length, 2, "cloud collections untouched");
  assert.deepEqual(store.get("users/user-a/data/completed_books")!.completedIds, ["meditations", "1984"]);
  // Readable sections still sync, and nothing local was lost
  assert.ok(store.has("users/user-a/favorites/jane-eyre"), "readable sections still upload");
  assert.deepEqual(rs.getBookAnnotations("1984", "user-a").highlights.map((h) => h.id), ["h-local"]);
  assert.deepEqual(rs.getReadingCollections("user-a")[0].bookIds, ["1984", "jane-eyre"]);
});

test("fully offline: nothing is written to the cloud and local data is kept", async () => {
  rs.saveStoredFavorites(["1984"], "user-a");
  rs.saveBookAnnotations("1984", annotations(highlight("h1")), "user-a");
  failReads.add("users");
  failWrites.add("users");
  const result = await reconcileAndFlush(userA);
  assert.equal(writeCount, 0);
  assert.deepEqual(result.favorites, ["1984"], "UI still shows the device's data");
  assert.deepEqual(rs.getStoredFavorites("user-a"), ["1984"]);
  assert.equal(rs.getBookAnnotations("1984", "user-a").highlights.length, 1);
});

test("newer cloud progress is never overwritten by an older device", async () => {
  store.set("users/user-a/reading_progress/1984", { bookId: "1984", page: 200, totalPages: 394, progress: 51, lastReadAt: now });
  rs.saveStoredReadingHistory([{ bookId: "1984", page: 50, totalPages: 394, progress: 13, lastReadAt: now - 1000 }], "user-a");
  await reconcileAndFlush(userA);
  assert.equal(store.get("users/user-a/reading_progress/1984")!.page, 200);
  assert.equal(rs.getStoredReadingHistory("user-a").find((h) => h.bookId === "1984")!.page, 200, "device catches up");
});

test("offline-only reflections, shelf dismissals, active time and collection edits are backfilled", async () => {
  store.set("users/user-a/data/collections", { collections: [collectionOf("c1", ["1984"], now - 5000)] });
  rs.saveReadingCollections([collectionOf("c1", ["1984", "jane-eyre"], now)], "user-a");
  rs.saveBookReflection("1984", "Unsettling and timely.", 5, "user-a");
  localStorage.setItem(rs.getShelfDismissalsStorageKey("user-a"), JSON.stringify({ "continue-reading": { "the-great-gatsby": true } }));
  rs.saveWebsiteActiveTimeData({ totalActiveSeconds: 900, daily: { "2026-10-30": 900 }, lastUpdated: now }, "user-a");
  rs.invalidateAllCaches();

  await reconcileAndFlush(userA);

  assert.deepEqual(store.get("users/user-a/data/collections")!.collections[0].bookIds, ["1984", "jane-eyre"]);
  assert.equal(store.get("users/user-a/data/reflections")!.reflections["1984"].reflection, "Unsettling and timely.");
  assert.equal(store.get("users/user-a/data/shelf_dismissals")!.dismissals["continue-reading"]["the-great-gatsby"], true);
  assert.equal(store.get("users/user-a/data/active_time")!.totalActiveSeconds, 900);
});

test("reconciling twice is idempotent (no duplicates, no extra writes needed)", async () => {
  rs.saveReadingCollections([collectionOf("c1", ["1984"])], "user-a");
  rs.saveBookAnnotations("1984", annotations(highlight("h1"), highlight("h2", "1984", 4)), "user-a");
  rs.saveStoredFavorites(["1984", "jane-eyre"], "user-a");
  await reconcileAndFlush(userA);
  const first = JSON.stringify(Array.from(store.entries()).filter(([p]) => !p.endsWith("user-a") && !p.includes("backups")).map(([p, d]) => [p, { ...d, lastReadAt: 0, favoritedAt: 0 }]));
  writeCount = 0;
  await reconcileAndFlush(userA);
  const second = JSON.stringify(Array.from(store.entries()).filter(([p]) => !p.endsWith("user-a") && !p.includes("backups")).map(([p, d]) => [p, { ...d, lastReadAt: 0, favoritedAt: 0 }]));
  assert.equal(second, first);
  assert.equal(store.get("users/user-a/data/collections")!.collections.length, 1);
  assert.equal(store.get("users/user-a/data/annotations")!.annotations["1984"].highlights.length, 2);
});

test("two devices adding different highlights to the same book both survive", async () => {
  rs.saveBookAnnotations("1984", annotations(highlight("from-phone")), "user-a");
  await reconcileAndFlush(userA);

  // Laptop: same account, its own local copy (has never seen the phone's highlight)
  memoryStorage.clear();
  rs.invalidateAllCaches();
  rs.saveBookAnnotations("1984", annotations(highlight("from-laptop", "1984", 9)), "user-a");
  await reconcileAndFlush(userA);

  const ids = store.get("users/user-a/data/annotations")!.annotations["1984"].highlights.map((h: any) => h.id).sort();
  assert.deepEqual(ids, ["from-laptop", "from-phone"]);
  assert.deepEqual(rs.getBookAnnotations("1984", "user-a").highlights.map((h) => h.id).sort(), ["from-laptop", "from-phone"]);
});

test("pending changes are flushed (not dropped) before sign-out", async () => {
  sync.syncAnnotationsToCloud("user-a", "1984", annotations(highlight("just-made")) as any);
  sync.syncReflectionsToCloud("user-a", { "1984": { bookId: "1984", reflection: "x", completedAt: now } });
  assert.equal(store.size, 0, "debounced: nothing written yet");
  await sync.flushAllPendingSyncs(); // what signOutUser now does before signing out
  assert.equal(store.get("users/user-a/data/annotations")!.annotations["1984"].highlights[0].id, "just-made");
  assert.ok(store.get("users/user-a/data/reflections"));
  writeCount = 0;
  sync.cancelAllPendingSyncTimers(); // the post-logout cancel now finds nothing left to drop
  await new Promise((r) => setTimeout(r, 2200));
  assert.equal(writeCount, 0, "no duplicate write after the flush");
});

test("guest data moves into the account that signs in, and never into the next account", async () => {
  rs.saveStoredFavorites(["jane-eyre"], null);
  rs.saveBookAnnotations("jane-eyre", annotations(highlight("guest-h", "jane-eyre")), null);
  await reconcileAndFlush(userA);
  assert.ok(store.has("users/user-a/favorites/jane-eyre"));
  assert.equal(store.get("users/user-a/data/annotations")!.annotations["jane-eyre"].highlights[0].id, "guest-h");

  rs.clearAllUserDataOnLogout(); // A signs out on this shared device
  rs.invalidateAllCaches();
  await reconcileAndFlush(userB);
  assert.equal(Array.from(store.keys()).filter((p) => p.startsWith("users/user-b/favorites/")).length, 0);
  assert.equal(store.get("users/user-b/data/annotations"), undefined);
  assert.deepEqual(rs.getStoredFavorites("user-b"), []);
  assert.deepEqual(rs.getStoredFavorites("user-a"), ["jane-eyre"], "A's offline copy kept for A's next sign-in");
});

test("an interrupted write keeps local data and is retried by the next sync", async () => {
  rs.saveBookAnnotations("1984", annotations(highlight("h1")), "user-a");
  failWrites.add("users/user-a/data/annotations");
  await reconcileAndFlush(userA);
  assert.equal(store.get("users/user-a/data/annotations"), undefined);
  assert.equal(rs.getBookAnnotations("1984", "user-a").highlights.length, 1, "still on the device");

  const check = await sync.verifyCloudCopy("user-a");
  assert.ok(check && !check.complete && check.missing.includes("highlight:1984:h1"), JSON.stringify(check));

  failWrites.clear();
  await reconcileAndFlush(userA);
  const recheck = await sync.verifyCloudCopy("user-a");
  assert.ok(recheck?.complete, JSON.stringify(recheck));
  assert.deepEqual(sync.getLastCloudVerification("user-a")?.missing, []);
});

test("verification is read-only and reports unreadable sections instead of guessing", async () => {
  rs.saveStoredFavorites(["1984"], "user-a");
  await reconcileAndFlush(userA);
  const localBefore = JSON.stringify(memoryStorage.keys().filter((k) => !k.includes("cloud-verification")).map((k) => [k, memoryStorage.getItem(k)]));
  failReads.add("users/user-a/data/bookmarks");
  const result = await sync.verifyCloudCopy("user-a");
  assert.ok(result);
  assert.deepEqual(result!.unreadable, ["bookmarks"]);
  assert.equal(result!.complete, false);
  const localAfter = JSON.stringify(memoryStorage.keys().filter((k) => !k.includes("cloud-verification")).map((k) => [k, memoryStorage.getItem(k)]));
  assert.equal(localAfter, localBefore, "local data unchanged");

  failReads.add("users");
  assert.equal(await sync.verifyCloudCopy("user-a"), null, "offline: verification simply does not run");
});

test("certificates: local-only ones are uploaded, existing cloud certificates are never replaced", async () => {
  store.set("users/user-a/data/certificates", { "1984": { id: "RH-CLOUD", bookId: "1984" } });
  const local = { "1984": { id: "RH-LOCAL", bookId: "1984" }, "jane-eyre": { id: "RH-JANE", bookId: "jane-eyre" } };
  const cloud = await sync.backfillCertificatesToCloud("user-a", local);
  assert.equal(cloud!["1984"].id, "RH-CLOUD");
  assert.equal(store.get("users/user-a/data/certificates")!["1984"].id, "RH-CLOUD");
  assert.equal(store.get("users/user-a/data/certificates")!["jane-eyre"].id, "RH-JANE");

  failReads.add("users/user-a/data/certificates");
  writeCount = 0;
  assert.equal(await sync.backfillCertificatesToCloud("user-a", { x: { bookId: "x" } }), null);
  assert.equal(writeCount, 0, "no blind writes when the cloud copy is unknown");
  assert.ok(typeof certs.getStoredCertificates === "function");
});
