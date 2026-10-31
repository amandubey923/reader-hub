/**
 * Bodhi's free daily message allowance, enforced on the server.
 *
 * - Signed-in readers: counted in Firestore (`ai_usage/{uid}`), written only by the server through the Admin SDK
 *   (clients are denied by the catch-all rule), so the count is the same on every device and survives refreshes
 *   and server restarts. Falls back to the in-memory counter if the Admin SDK is not configured.
 * - Guests: the existing per-IP in-memory counter (reading stays login-free).
 * - Each reader message carries a request ID; a repeated ID is rejected as a duplicate and never counted twice.
 * - Pro readers are never limited (checked by the caller with the existing entitlement lookup).
 */

import { FREE_TIER_LIMITS } from "@/lib/monetization-config";
import { getFirebaseAdminFirestore } from "@/lib/firebase-admin";

/** Same allowance as the other free AI features (Library Assistant): messages per day. */
export const COMPANION_FREE_DAILY_MESSAGES = FREE_TIER_LIMITS.DAILY_AI_QUERIES;
const RECENT_IDS = 30;

export interface QuotaState {
  day: string;
  count: number;
  requestIds: string[];
}

export interface QuotaDecision {
  allowed: boolean;
  /** The request ID was already used: the same message is being (or was) answered. */
  duplicate: boolean;
  used: number;
  limit: number;
  next: QuotaState;
}

/** Calendar day in India (the library's audience), so "today" matches the reader's clock. */
export function quotaDay(now: number = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
}

/** Pure rule shared by both stores. */
export function applyConsume(state: QuotaState | null | undefined, day: string, requestId: string | undefined, limit: number): QuotaDecision {
  const current: QuotaState = state && state.day === day ? { day, count: state.count || 0, requestIds: [...(state.requestIds || [])] } : { day, count: 0, requestIds: [] };
  if (requestId && current.requestIds.includes(requestId)) {
    return { allowed: false, duplicate: true, used: current.count, limit, next: current };
  }
  if (current.count >= limit) {
    return { allowed: false, duplicate: false, used: current.count, limit, next: current };
  }
  const next: QuotaState = {
    day,
    count: current.count + 1,
    requestIds: requestId ? [...current.requestIds, requestId].slice(-RECENT_IDS) : current.requestIds,
  };
  return { allowed: true, duplicate: false, used: next.count, limit, next };
}

/** Gives a message back when the AI could not answer it (the ID stays recorded so it is still not repeatable). */
export function applyRefund(state: QuotaState | null | undefined, day: string): QuotaState | null {
  if (!state || state.day !== day || state.count <= 0) return state ?? null;
  return { ...state, count: state.count - 1 };
}

export interface QuotaStore {
  consume(key: string, requestId: string | undefined, limit: number, now?: number): Promise<QuotaDecision>;
  refund(key: string, now?: number): Promise<void>;
}

export function createMemoryQuotaStore(maxKeys = 10000): QuotaStore {
  const states = new Map<string, QuotaState>();
  return {
    async consume(key, requestId, limit, now = Date.now()) {
      const decision = applyConsume(states.get(key), quotaDay(now), requestId, limit);
      if (!states.has(key) && states.size >= maxKeys) states.delete(states.keys().next().value as string);
      states.set(key, decision.next);
      return decision;
    },
    async refund(key, now = Date.now()) {
      const next = applyRefund(states.get(key), quotaDay(now));
      if (next) states.set(key, next);
    },
  };
}

export function createFirestoreQuotaStore(): QuotaStore | null {
  const db = getFirebaseAdminFirestore();
  if (!db) return null;
  const ref = (uid: string) => db.collection("ai_usage").doc(uid);
  return {
    async consume(uid, requestId, limit, now = Date.now()) {
      // A transaction so two devices sending at the same moment cannot both use the last message
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref(uid));
        const decision = applyConsume((snap.data()?.companion as QuotaState) || null, quotaDay(now), requestId, limit);
        if (decision.allowed) tx.set(ref(uid), { companion: decision.next, updatedAt: now }, { merge: true });
        return decision;
      });
    },
    async refund(uid, now = Date.now()) {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref(uid));
        const next = applyRefund((snap.data()?.companion as QuotaState) || null, quotaDay(now));
        if (next) tx.set(ref(uid), { companion: next, updatedAt: now }, { merge: true });
      });
    },
  };
}

const memoryStore = createMemoryQuotaStore();
let firestoreStore: QuotaStore | null | undefined;

/** Signed-in readers use the shared Firestore counter when available; guests (and fallback) use memory. */
export function quotaStoreFor(uid: string | null): QuotaStore {
  if (uid) {
    if (firestoreStore === undefined) firestoreStore = createFirestoreQuotaStore();
    if (firestoreStore) return firestoreStore;
  }
  return memoryStore;
}

export interface CompanionAllowance {
  decision: QuotaDecision;
  /** Gives the message back if the AI could not answer it. */
  refund: () => Promise<void>;
}

/**
 * Counts one reader message against the free allowance. Signed-in readers are keyed by UID (shared across devices);
 * guests by IP with the given (larger, shared-network) limit. If the shared store fails, the in-memory counter
 * still enforces the limit rather than letting the request through uncounted.
 */
export async function consumeCompanionMessage(
  uid: string | null,
  ip: string,
  requestId: string | undefined,
  limit: number,
  now: number = Date.now()
): Promise<CompanionAllowance> {
  const key = uid ? `uid:${uid}` : `ip:${ip}`;
  let store = quotaStoreFor(uid);
  let storeKey = uid && store !== memoryStore ? uid : key;
  let decision: QuotaDecision;
  try {
    decision = await store.consume(storeKey, requestId, limit, now);
  } catch (err) {
    console.warn("[Companion quota] Shared counter unavailable, using this server's counter:", err);
    store = memoryStore;
    storeKey = key;
    decision = await store.consume(storeKey, requestId, limit, now);
  }
  return { decision, refund: () => store.refund(storeKey, now).catch(() => {}) };
}

/** Test hook: route signed-in readers to a given store (e.g. an in-memory fake of Firestore). */
export function __setSharedQuotaStoreForTests(store: QuotaStore | null | undefined) {
  firestoreStore = store;
}
