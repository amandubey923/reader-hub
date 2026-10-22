import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/razorpay";
import { constructPurchasedEntitlement } from "@/lib/entitlements";
import { PlanId } from "@/lib/monetization-config";
import { getFirebaseAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

const processedWebhookEvents = new Set<string>();

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const webhookSignature = req.headers.get("x-razorpay-signature") || "";

    const isValid = verifyWebhookSignature(rawBody, webhookSignature);
    if (!isValid) {
      console.warn("[Payment Webhook] Invalid webhook signature.");
      return NextResponse.json({ error: "Invalid webhook signature" }, { status: 400 });
    }

    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const eventId = payload?.event_id || payload?.id;
    if (eventId && processedWebhookEvents.has(eventId)) {
      return NextResponse.json({ status: "already_processed" });
    }

    const eventType = payload?.event;
    const paymentEntity = payload?.payload?.payment?.entity;
    const orderEntity = payload?.payload?.order?.entity;

    if (eventType === "payment.captured" || eventType === "order.paid") {
      const planId = (paymentEntity?.notes?.planId || orderEntity?.notes?.planId) as PlanId;
      const orderId = paymentEntity?.order_id || orderEntity?.id;
      const paymentId = paymentEntity?.id || "webhook_captured";
      const targetUserId = paymentEntity?.notes?.userId || orderEntity?.notes?.userId;

      if (planId && orderId) {
        const entitlement = constructPurchasedEntitlement(planId, orderId, paymentId);
        console.log(`[Payment Webhook] Processed event ${eventType} for plan ${planId}`);

        if (targetUserId && targetUserId !== "anonymous") {
          try {
            const adminDb = getFirebaseAdminDb();
            if (adminDb) {
              await adminDb
                .collection("users")
                .doc(targetUserId)
                .collection("data")
                .doc("entitlement")
                .set(entitlement, { merge: true });
              console.log(`[Payment Webhook] Server updated Firestore entitlement for user ${targetUserId}`);
            }
          } catch (dbErr) {
            console.warn("[Payment Webhook] Firestore update notice:", dbErr);
          }
        }
      }
    }

    if (eventId) {
      processedWebhookEvents.add(eventId);
      if (processedWebhookEvents.size > 2000) {
        const first = processedWebhookEvents.values().next().value;
        if (first) processedWebhookEvents.delete(first);
      }
    }

    return NextResponse.json({ status: "ok" });
  } catch (err: any) {
    console.error("[Payment Webhook] Error processing webhook:", err);
    return NextResponse.json({ error: "Webhook processing error" }, { status: 500 });
  }
}
