/**
 * Bodhi regressions: one utterance → one request → one reply, duplicate book cards, clear "open <book>"
 * requests, and the server-enforced free allowance (5 messages, Pro unlimited, duplicates never counted).
 */
import { test, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createUtteranceCollector, joinTranscripts } from "../lib/companion/voice-utterance";
import { decideSubmission, uniqueBooks, EMPTY_SUBMISSION_STATE, DUPLICATE_WINDOW_MS } from "../lib/companion/submission";
import { resolveBookRequest } from "../lib/companion/book-request";
import { applyConsume, applyRefund, createMemoryQuotaStore, quotaDay } from "../lib/server/companion-quota";

// ---------------------------------------------------------------- Voice: incremental transcripts

const result = (transcript: string, isFinal = true) => Object.assign([{ transcript }], { isFinal });
const list = (...results: ReturnType<typeof result>[]) => Object.assign([...results], { length: results.length });

test("Android-style growing transcripts produce one utterance, delivered once", () => {
  const c = createUtteranceCollector();
  for (const t of ["Open", "Open kam", "Open kamayani", "Open kamayani book", "Open kamayani book of Jaishankar Prasad"]) {
    c.addResults(list(result(t)));
  }
  assert.equal(c.finish(), "Open kamayani book of Jaishankar Prasad");
  assert.equal(c.finish(), null, "never delivered twice");
});

test("cumulative fragments inside one result list are merged, not stacked", () => {
  const c = createUtteranceCollector();
  c.addResults(list(result("Open"), result("Open kamayani"), result("Open kamayani book")));
  assert.equal(c.finish(), "Open kamayani book");
  assert.equal(joinTranscripts(["next", "page"]), "next page", "genuinely separate phrases still join");
});

test("interim results are never sent while final ones exist; aborted sessions send nothing", () => {
  const c = createUtteranceCollector();
  c.addResults(list(result("Open kama", false)));
  c.addResults(list(result("Open kamayani", true)));
  c.addResults(list(result("Open kamayani", true), result("bo", false)));
  assert.equal(c.finish(), "Open kamayani");

  const silent = createUtteranceCollector();
  assert.equal(silent.finish(), null, "nothing heard");

  const aborted = createUtteranceCollector();
  aborted.addResults(list(result("Open kamayani")));
  aborted.cancel();
  assert.equal(aborted.finish(), null);
});

// ---------------------------------------------------------------- Duplicate submissions

test("duplicate events while answering are dropped; different messages are queued, not lost", () => {
  const busy = { ...EMPTY_SUBMISSION_STATE, inFlight: "open kamayani", lastText: "open kamayani", lastAt: 1000 };
  assert.equal(decideSubmission("Open Kamayani!", busy, 1100), "drop", "same words, different case/punctuation");
  assert.equal(decideSubmission("Who wrote it?", busy, 1100), "queue");
  assert.equal(decideSubmission("Who wrote it?", { ...busy, queued: ["who wrote it"] }, 1100), "drop", "not queued twice");
  assert.equal(decideSubmission("   ", EMPTY_SUBMISSION_STATE, 0), "drop");
});

test("double click / repeated Enter right after sending is dropped; normal follow-ups go through", () => {
  const sent = { ...EMPTY_SUBMISSION_STATE, lastText: "explain this page simply", lastAt: 10_000 };
  assert.equal(decideSubmission("Explain this page simply", sent, 10_500), "drop");
  assert.equal(decideSubmission("Explain this page simply", sent, 10_000 + DUPLICATE_WINDOW_MS + 1), "send", "asking again later is fine");
  assert.equal(decideSubmission("And the next one?", sent, 10_500), "send", "a follow-up is never blocked");
});

test("repeated book results become one card each", () => {
  const card = (id: string) => ({ id, title: id, author: "A", cover: "/c.jpg", category: "C", language: "Hindi" });
  assert.deepEqual(uniqueBooks([card("kamayani"), card("kamayani"), card("godan"), card("kamayani")]).map((b) => b.id), ["kamayani", "godan"]);
  assert.deepEqual(uniqueBooks(undefined), []);
});

// ---------------------------------------------------------------- Clear book-opening commands

test("a clear open-book command resolves to exactly one catalogue book", () => {
  for (const q of ["Open Kamayani book by Jaishankar Prasad", "Open kamayani book of Jasankar", "open kamayani", "kamayani kholo"]) {
    assert.equal(resolveBookRequest(q)?.book.id, "kamayani", q);
  }
  assert.equal(resolveBookRequest("open 1984")?.book.id, "1984");
  assert.equal(resolveBookRequest("open crime and punishment by dostoevsky")?.book.author, "Fyodor Dostoevsky");
});

test("fragments, questions, reader commands and ambiguous names go to the conversation instead", () => {
  for (const q of ["Open", "Open kam", "what is kamayani about?", "open next page", "open chapters", "open osho", "Tell me about Kamayani"]) {
    assert.equal(resolveBookRequest(q), null, q);
  }
});

// ---------------------------------------------------------------- Free allowance (pure rule)

test("five free messages per day, the sixth is blocked, a new day resets", () => {
  const day = "2026-10-31";
  let state = null as ReturnType<typeof applyConsume>["next"] | null;
  for (let i = 1; i <= 5; i++) {
    const d = applyConsume(state, day, `req-${i}-abcdef`, 5);
    assert.ok(d.allowed, `message ${i}`);
    assert.equal(d.used, i);
    state = d.next;
  }
  const sixth = applyConsume(state, day, "req-6-abcdef", 5);
  assert.equal(sixth.allowed, false);
  assert.equal(sixth.duplicate, false);
  assert.ok(applyConsume(state, "2026-11-01", "req-7-abcdef", 5).allowed, "resets the next day");
});

test("a repeated request ID is rejected as a duplicate and never counted twice", () => {
  const first = applyConsume(null, "d", "same-id-123", 5);
  const again = applyConsume(first.next, "d", "same-id-123", 5);
  assert.equal(again.allowed, false);
  assert.equal(again.duplicate, true);
  assert.equal(again.used, 1);
  assert.equal(applyRefund(first.next, "d")!.count, 0, "an unanswered message is given back");
});

test("the day boundary follows India time", () => {
  assert.equal(quotaDay(Date.UTC(2026, 9, 30, 18, 29)), "2026-10-30"); // 23:59 IST
  assert.equal(quotaDay(Date.UTC(2026, 9, 30, 18, 31)), "2026-10-31"); // 00:01 IST
});

// ---------------------------------------------------------------- Route: server enforcement

const libUrl = (...p: string[]) => pathToFileURL(path.join(process.cwd(), "lib", ...p)).href;
let POST: (req: any) => Promise<Response>;
let NextRequestCtor: any;
let agentCalls = 0;
let quota: typeof import("../lib/server/companion-quota");

before(async () => {
  mock.module(libUrl("server", "auth.ts"), {
    namedExports: {
      // "Bearer <uid>" stands in for a verified Firebase ID token
      getVerifiedCaller: async (h: string | null) => (h?.startsWith("Bearer ") ? { uid: h.slice(7) } : null),
      extractBearerToken: (h: string | null) => h?.replace(/^Bearer /, "") || null,
      requireAdmin: async () => null,
    },
  });
  mock.module(libUrl("server", "ai-guard.ts"), {
    namedExports: {
      guardAiRequest: async () => ({ allowed: true, status: 200, message: "", retryAfterSeconds: 0 }),
      isProUser: async (uid: string) => uid === "pro-reader",
      GUEST_IP_DAILY_MULTIPLIER: 3,
    },
  });
  mock.module(libUrl("gemini-rotator.ts"), { namedExports: { getGeminiKeyPool: () => [{ key: "test" }] } });
  mock.module(libUrl("companion", "agent.ts"), {
    namedExports: {
      runCompanionAgent: async () => {
        agentCalls++;
        return { reply: "Here is your answer.", actions: [], sources: [], books: [] };
      },
    },
  });
  mock.module(libUrl("companion", "gemini.ts"), { namedExports: { geminiGenerate: async () => ({}) } });
  quota = await import("../lib/server/companion-quota");
  ({ POST } = await import("../app/api/companion/route"));
  ({ NextRequest: NextRequestCtor } = await import("next/server"));
});

let sharedStore: ReturnType<typeof createMemoryQuotaStore>;
beforeEach(() => {
  agentCalls = 0;
  // Stands in for the Firestore counter: one store shared by every device of an account
  sharedStore = createMemoryQuotaStore();
  quota.__setSharedQuotaStoreForTests(sharedStore);
});

let n = 0;
const ask = (opts: { uid?: string; requestId?: string; ip?: string } = {}) =>
  POST(
    new NextRequestCtor("http://localhost/api/companion", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": opts.ip || "203.0.113.7",
        ...(opts.uid ? { authorization: `Bearer ${opts.uid}` } : {}),
      },
      body: JSON.stringify({ messages: [{ role: "user", text: "Explain this" }], requestId: opts.requestId || `req-${++n}-xyz` }),
    })
  );

test("server: 5 messages per signed-in reader, then 429 with the upgrade code — across devices", async () => {
  for (let i = 1; i <= 5; i++) {
    const res = await ask({ uid: "reader-1" });
    assert.equal(res.status, 200, `message ${i}`);
    assert.deepEqual((await res.json()).usage, { used: i, limit: 5 });
  }
  // A second device of the same account shares the count
  const blocked = await ask({ uid: "reader-1", ip: "198.51.100.9" });
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).code, "companion_limit");
  assert.equal(agentCalls, 5, "the model never ran for the blocked message");
  assert.equal((await ask({ uid: "reader-2" })).status, 200, "other readers are unaffected");
});

test("server: a repeated request (refresh, retry, direct API replay) is not answered or counted again", async () => {
  const first = await ask({ uid: "reader-3", requestId: "fixed-id-001" });
  assert.equal(first.status, 200);
  const replay = await ask({ uid: "reader-3", requestId: "fixed-id-001" });
  assert.equal(replay.status, 409);
  assert.equal((await replay.json()).code, "duplicate");
  assert.equal(agentCalls, 1);
  const next = await ask({ uid: "reader-3" });
  assert.deepEqual((await next.json()).usage, { used: 2, limit: 5 }, "the replay did not use a message");
});

test("server: Pro readers are never limited", async () => {
  for (let i = 0; i < 8; i++) assert.equal((await ask({ uid: "pro-reader" })).status, 200);
  assert.equal(agentCalls, 8);
});

test("server: guests are limited per network with the existing shared-IP allowance", async () => {
  let ok = 0;
  for (let i = 0; i < 16; i++) if ((await ask({ ip: "192.0.2.44" })).status === 200) ok++;
  assert.equal(ok, 15, "5 × the existing shared-network multiplier of 3");
  assert.equal((await ask({ ip: "192.0.2.45" })).status, 200, "a different network is separate");
});

test("server: if the shared counter fails, this server's counter still enforces the limit", async () => {
  quota.__setSharedQuotaStoreForTests({
    consume: async () => {
      throw new Error("firestore unavailable");
    },
    refund: async () => {},
  });
  let ok = 0;
  for (let i = 0; i < 7; i++) if ((await ask({ uid: "reader-offline" })).status === 200) ok++;
  assert.equal(ok, 5);
});
