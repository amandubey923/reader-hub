import crypto from "crypto";
import { getPlanConfig, PlanId } from "./monetization-config";

/**
 * Razorpay Server Configuration & Security
 * Never expose RAZORPAY_KEY_SECRET or RAZORPAY_WEBHOOK_SECRET to client code.
 */

export function getRazorpayKeys() {
  const keyId =
    process.env.RAZORPAY_KEY_ID ||
    process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID ||
    "rzp_test_placeholder";
  const keySecret = process.env.RAZORPAY_KEY_SECRET || "rzp_secret_placeholder";
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || "rzp_webhook_placeholder";

  const isConfigured = Boolean(
    keyId &&
    keySecret &&
    keyId !== "rzp_test_placeholder" &&
    keySecret !== "rzp_secret_placeholder"
  );

  return { keyId, keySecret, webhookSecret, isConfigured };
}

export interface CreateOrderParams {
  planId: PlanId;
  userId?: string;
  userEmail?: string;
  userName?: string;
}

export interface RazorpayOrderResult {
  orderId: string;
  amount: number; // in paise
  currency: string;
  planId: PlanId;
  receipt: string;
}

/**
 * Server-side order creation strictly using server-defined plan amounts
 */
export async function createRazorpayOrder({
  planId,
  userId,
  userEmail,
  userName,
}: CreateOrderParams): Promise<RazorpayOrderResult> {
  const plan = getPlanConfig(planId);
  if (!plan || plan.amountPaise <= 0) {
    throw new Error("Invalid or free plan selected. Cannot create order.");
  }

  const { keyId, keySecret, isConfigured } = getRazorpayKeys();

  const receipt = `rec_${planId.toLowerCase()}_${Date.now().toString().slice(-8)}`;

  // If keys are not configured, only fall back to simulated order if in dev and using placeholder keys
  if (!isConfigured) {
    if (keyId === "rzp_test_placeholder" && process.env.NODE_ENV !== "production") {
      console.warn("[Razorpay] Using simulated test order (placeholder credentials in dev)");
      return {
        orderId: `order_test_${Date.now()}`,
        amount: plan.amountPaise,
        currency: "INR",
        planId,
        receipt,
      };
    }
    throw new Error("Razorpay gateway is not fully configured (missing RAZORPAY_KEY_SECRET or key ID in environment variables).");
  }

  const authHeader = Buffer.from(`${keyId}:${keySecret}`).toString("base64");

  const orderPayload = {
    amount: plan.amountPaise,
    currency: "INR",
    receipt,
    notes: {
      planId,
      userId: userId || "anonymous",
      userEmail: userEmail || "",
      userName: userName || "",
      billingType: plan.billingType,
    },
  };

  const response = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${authHeader}`,
    },
    body: JSON.stringify(orderPayload),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    console.error("[Razorpay] Order creation failed:", errorData);
    throw new Error(
      errorData?.error?.description || "Failed to create Razorpay payment order."
    );
  }

  const order = await response.json();

  return {
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    planId,
    receipt: order.receipt || receipt,
  };
}

/**
 * Verify payment signature using HMAC SHA256
 */
export function verifyPaymentSignature(
  orderId: string,
  paymentId: string,
  signature: string
): boolean {
  if (!orderId || !paymentId || !signature) return false;

  const { keySecret, isConfigured } = getRazorpayKeys();

  // Test mode simulation verification
  if (!isConfigured && orderId.startsWith("order_test_")) {
    return signature.startsWith("sig_test_") || signature.length >= 10;
  }

  try {
    const expectedSignature = crypto
      .createHmac("sha256", keySecret)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");

    const expectedBuffer = Buffer.from(expectedSignature, "utf8");
    const signatureBuffer = Buffer.from(signature, "utf8");

    if (expectedBuffer.length !== signatureBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
  } catch (err) {
    console.error("[Razorpay] Signature verification error:", err);
    return false;
  }
}

/**
 * Verify Razorpay webhook signature
 */
export function verifyWebhookSignature(
  rawBody: string,
  webhookSignature: string
): boolean {
  if (!rawBody || !webhookSignature) return false;

  const { webhookSecret, isConfigured } = getRazorpayKeys();

  if (!isConfigured) {
    return true;
  }

  try {
    const expectedSignature = crypto
      .createHmac("sha256", webhookSecret)
      .update(rawBody)
      .digest("hex");

    const expectedBuffer = Buffer.from(expectedSignature, "utf8");
    const signatureBuffer = Buffer.from(webhookSignature, "utf8");

    if (expectedBuffer.length !== signatureBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
  } catch (err) {
    console.error("[Razorpay] Webhook signature verification error:", err);
    return false;
  }
}
