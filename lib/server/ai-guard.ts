import { createRateLimiter, getClientIp } from "./rate-limit";
import { getVerifiedCaller } from "./auth";
import { FREE_TIER_LIMITS, PRO_ENFORCEMENT_ENABLED } from "@/lib/monetization-config";
import { isEntitlementActive, UserEntitlement } from "@/lib/entitlements";
import { getFirebaseAdminFirestore } from "@/lib/firebase-admin";

export type AiFeature = "chat" | "translate";

const DAY_MS = 24 * 60 * 60 * 1000;

// Anonymous callers are keyed by IP, which several readers may share (campus, office, mobile NAT)
const GUEST_IP_DAILY_MULTIPLIER = 3;

const FEATURE_LIMITS: Record<AiFeature, { burstPerMinute: number; freeDaily: number }> = {
  chat: { burstPerMinute: 12, freeDaily: FREE_TIER_LIMITS.DAILY_AI_QUERIES },
  translate: { burstPerMinute: 8, freeDaily: FREE_TIER_LIMITS.DAILY_TRANSLATION_SPREADS },
};

const burstLimiters: Record<AiFeature, ReturnType<typeof createRateLimiter>> = {
  chat: createRateLimiter({ windowMs: 60_000, max: FEATURE_LIMITS.chat.burstPerMinute }),
  translate: createRateLimiter({ windowMs: 60_000, max: FEATURE_LIMITS.translate.burstPerMinute }),
};

const dailyLimiters: Record<AiFeature, ReturnType<typeof createRateLimiter>> = {
  chat: createRateLimiter({ windowMs: DAY_MS, max: FEATURE_LIMITS.chat.freeDaily }),
  translate: createRateLimiter({ windowMs: DAY_MS, max: FEATURE_LIMITS.translate.freeDaily }),
};

const PRO_CACHE_TTL_MS = 5 * 60 * 1000;
const proStatusCache = new Map<string, { isPro: boolean; expiresAt: number }>();

async function isProUser(uid: string): Promise<boolean> {
  const cached = proStatusCache.get(uid);
  if (cached && cached.expiresAt > Date.now()) return cached.isPro;

  let isPro = false;
  try {
    const adminDb = getFirebaseAdminFirestore();
    if (adminDb) {
      const snap = await adminDb.collection("users").doc(uid).collection("data").doc("entitlement").get();
      const ent = snap.exists ? (snap.data() as UserEntitlement) : null;
      isPro = Boolean(ent && isEntitlementActive(ent) && ent.isPro);
    }
  } catch (err) {
    console.warn("[AI Guard] Entitlement lookup notice:", err);
  }

  if (proStatusCache.size > 5000) proStatusCache.clear();
  proStatusCache.set(uid, { isPro, expiresAt: Date.now() + PRO_CACHE_TTL_MS });
  return isPro;
}

export interface AiGuardResult {
  allowed: boolean;
  status: number;
  message: string;
  retryAfterSeconds: number;
}

/**
 * Server-side abuse protection for paid AI endpoints. Guests remain allowed (reading is login-free),
 * but every caller is burst-limited and, while Pro enforcement is on, held to the free daily allowance.
 */
export async function guardAiRequest(headers: Headers, feature: AiFeature): Promise<AiGuardResult> {
  const caller = await getVerifiedCaller(headers.get("authorization"));
  const identity = caller ? `uid:${caller.uid}` : `ip:${getClientIp(headers)}`;

  const burst = burstLimiters[feature].check(identity);
  if (!burst.allowed) {
    return {
      allowed: false,
      status: 429,
      message: "Too many requests. Please wait a moment and try again.",
      retryAfterSeconds: burst.retryAfterSeconds,
    };
  }

  if (PRO_ENFORCEMENT_ENABLED && !(caller && (await isProUser(caller.uid)))) {
    const limits = FEATURE_LIMITS[feature];
    const dailyMax = caller ? limits.freeDaily : limits.freeDaily * GUEST_IP_DAILY_MULTIPLIER;
    const daily = dailyLimiters[feature].check(identity, dailyMax);
    if (!daily.allowed) {
      return {
        allowed: false,
        status: 429,
        message:
          feature === "chat"
            ? "You have reached today's free limit for AI assistant questions."
            : "You have reached today's free limit for page translations.",
        retryAfterSeconds: daily.retryAfterSeconds,
      };
    }
  }

  return { allowed: true, status: 200, message: "", retryAfterSeconds: 0 };
}
