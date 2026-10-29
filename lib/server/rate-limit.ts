/**
 * Fixed-window, in-memory rate limiter.
 *
 * NOTE: State lives in the memory of a single server instance. On serverless hosting each
 * instance keeps its own counters, so limits are best-effort abuse protection, not a billing guarantee.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

interface WindowEntry {
  count: number;
  resetAt: number;
}

export function createRateLimiter(options: { windowMs: number; max: number; maxKeys?: number }) {
  const { windowMs, max } = options;
  const maxKeys = options.maxKeys ?? 10000;
  const hits = new Map<string, WindowEntry>();

  const prune = (now: number) => {
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
    // Hard cap so a flood of unique keys cannot grow memory without bound
    while (hits.size >= maxKeys) {
      const oldest = hits.keys().next().value;
      if (oldest === undefined) break;
      hits.delete(oldest);
    }
  };

  return {
    check(key: string, limitOverride?: number, now: number = Date.now()): RateLimitResult {
      const limit = limitOverride ?? max;
      let entry = hits.get(key);
      if (!entry || entry.resetAt <= now) {
        if (!entry && hits.size >= maxKeys) prune(now);
        entry = { count: 0, resetAt: now + windowMs };
        hits.set(key, entry);
      }

      if (entry.count >= limit) {
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
        };
      }

      entry.count += 1;
      return { allowed: true, remaining: limit - entry.count, retryAfterSeconds: 0 };
    },
    reset() {
      hits.clear();
    },
  };
}

/**
 * Best-effort client IP from proxy headers (Vercel sets x-forwarded-for).
 */
export function getClientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}
