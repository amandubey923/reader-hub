import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { verifyPaymentSignature, verifyWebhookSignature } from "../lib/razorpay";
import { escapeHtml } from "../lib/server/escape-html";
import { createRateLimiter, getClientIp } from "../lib/server/rate-limit";
import { requireAdmin, extractBearerToken } from "../lib/server/auth";
import { ADMIN_EMAIL } from "../lib/admin";

const ORIGINAL_ENV = { ...process.env };
const originalFetch = globalThis.fetch;

function setEnv(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete (process.env as any)[k];
    else (process.env as any)[k] = v;
  }
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  globalThis.fetch = originalFetch;
});

// ---------------- Razorpay ----------------

test("simulated payments are rejected in production when Razorpay is unconfigured", () => {
  setEnv({ NODE_ENV: "production", RAZORPAY_KEY_ID: undefined, NEXT_PUBLIC_RAZORPAY_KEY_ID: undefined, RAZORPAY_KEY_SECRET: undefined });
  assert.equal(verifyPaymentSignature("order_test_123", "pay_1", "sig_test_anything"), false);
  assert.equal(verifyPaymentSignature("order_test_123", "pay_1", "xxxxxxxxxxxxxxxx"), false);
});

test("simulated payments only accept the explicit test signature in development", () => {
  setEnv({ NODE_ENV: "development", RAZORPAY_KEY_ID: undefined, NEXT_PUBLIC_RAZORPAY_KEY_ID: undefined, RAZORPAY_KEY_SECRET: undefined });
  assert.equal(verifyPaymentSignature("order_test_123", "pay_1", "sig_test_ok"), true);
  assert.equal(verifyPaymentSignature("order_test_123", "pay_1", "aaaaaaaaaaaa"), false);
});

test("real HMAC signatures verify; tampered ones do not", () => {
  setEnv({ RAZORPAY_KEY_ID: "rzp_live_abc", RAZORPAY_KEY_SECRET: "secret123" });
  const sig = crypto.createHmac("sha256", "secret123").update("order_1|pay_1").digest("hex");
  assert.equal(verifyPaymentSignature("order_1", "pay_1", sig), true);
  assert.equal(verifyPaymentSignature("order_1", "pay_2", sig), false);
  assert.equal(verifyPaymentSignature("order_test_1", "pay_1", "sig_test_x"), false);
});

test("webhook verification fails closed without a configured secret", () => {
  setEnv({ RAZORPAY_WEBHOOK_SECRET: undefined, RAZORPAY_KEY_ID: undefined, RAZORPAY_KEY_SECRET: undefined });
  assert.equal(verifyWebhookSignature('{"event":"payment.captured"}', "anything"), false);
});

test("webhook verification accepts only a correctly signed body", () => {
  setEnv({ RAZORPAY_WEBHOOK_SECRET: "whsec" });
  const body = '{"event":"order.paid"}';
  const sig = crypto.createHmac("sha256", "whsec").update(body).digest("hex");
  assert.equal(verifyWebhookSignature(body, sig), true);
  assert.equal(verifyWebhookSignature(body + " ", sig), false);
});

// ---------------- Admin authorization ----------------

function stubTokenLookup(email: string | null) {
  globalThis.fetch = (async () =>
    email === null
      ? new Response("{}", { status: 400 })
      : new Response(JSON.stringify({ users: [{ localId: "uid1", email }] }), { status: 200 })) as typeof fetch;
}

test("admin check rejects missing tokens without any network call", async () => {
  globalThis.fetch = (async () => {
    throw new Error("should not be called");
  }) as typeof fetch;
  const res = await requireAdmin(null);
  assert.deepEqual([res.ok, !res.ok && res.status], [false, 401]);
  assert.equal(extractBearerToken("Basic abc"), null);
});

test("admin check rejects invalid tokens and non-admin users", async () => {
  stubTokenLookup(null);
  const invalid = await requireAdmin("Bearer bad");
  assert.equal(invalid.ok, false);
  assert.equal(!invalid.ok && invalid.status, 403);

  stubTokenLookup("someone@example.com");
  const nonAdmin = await requireAdmin("Bearer token");
  assert.equal(nonAdmin.ok, false);
});

test("admin check accepts the configured administrator", async () => {
  stubTokenLookup(ADMIN_EMAIL.toUpperCase());
  const res = await requireAdmin("Bearer token");
  assert.equal(res.ok, true);
});

// ---------------- Misc hardening ----------------

test("escapeHtml neutralises markup", () => {
  assert.equal(escapeHtml(`<img src=x onerror="a('b')">&`), "&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;");
});

test("rate limiter enforces per-key windows and resets after the window", () => {
  const limiter = createRateLimiter({ windowMs: 1000, max: 2 });
  assert.equal(limiter.check("a", undefined, 0).allowed, true);
  assert.equal(limiter.check("a", undefined, 10).allowed, true);
  const blocked = limiter.check("a", undefined, 20);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 1);
  assert.equal(limiter.check("b", undefined, 20).allowed, true, "keys are independent");
  assert.equal(limiter.check("a", undefined, 1001).allowed, true, "window resets");
  assert.equal(limiter.check("c", 0, 0).allowed, false, "per-call limit override");
});

test("rate limiter memory stays bounded under many unique keys", () => {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 1, maxKeys: 10 });
  for (let i = 0; i < 100; i++) limiter.check(`k${i}`, undefined, 0);
  assert.equal(limiter.check("k99", undefined, 1).allowed, false, "recent key still tracked");
});

test("client IP comes from the first forwarded hop", () => {
  const h = new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" });
  assert.equal(getClientIp(h), "1.2.3.4");
  assert.equal(getClientIp(new Headers()), "unknown");
});
