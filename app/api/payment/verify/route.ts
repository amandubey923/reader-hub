import { NextRequest, NextResponse } from "next/server";
import { verifyPaymentSignature, fetchRazorpayOrder, isSimulatedPaymentModeAllowed } from "@/lib/razorpay";
import { getPlanConfig, PlanId, RAZORPAY_PAYMENTS_ENABLED, PRO_ENFORCEMENT_ENABLED } from "@/lib/monetization-config";
import { constructPurchasedEntitlement } from "@/lib/entitlements";
import { getFirebaseAdminFirestore } from "@/lib/firebase-admin";
import { getVerifiedCaller } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    if (!RAZORPAY_PAYMENTS_ENABLED || !PRO_ENFORCEMENT_ENABLED) {
      return NextResponse.json(
        { success: false, error: "Payment verification is unavailable while payments are disabled." },
        { status: 503 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, planId } = body;

    if (
      typeof razorpay_order_id !== "string" ||
      typeof razorpay_payment_id !== "string" ||
      typeof razorpay_signature !== "string" ||
      typeof planId !== "string"
    ) {
      return NextResponse.json({ error: "Incomplete payment verification payload." }, { status: 400 });
    }

    const plan = getPlanConfig(planId as PlanId);
    if (!plan || plan.amountPaise <= 0) {
      return NextResponse.json({ error: "Invalid plan ID for verification." }, { status: 400 });
    }

    const isValid = verifyPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
    if (!isValid) {
      console.warn("[Payment API] Invalid signature for order:", razorpay_order_id);
      return NextResponse.json({ error: "Payment verification failed. Signature mismatch." }, { status: 400 });
    }

    const caller = await getVerifiedCaller(req.headers.get("authorization"));
    const verifiedUid = caller?.uid || "";

    // The plan and amount come from the server-created order, never from the client payload
    let orderUserId = "";
    if (!isSimulatedPaymentModeAllowed()) {
      const order = await fetchRazorpayOrder(razorpay_order_id);
      if (!order) {
        return NextResponse.json({ error: "Unable to confirm this order with the payment gateway." }, { status: 502 });
      }
      if (order.notes.planId !== planId || order.amount !== plan.amountPaise) {
        console.warn("[Payment API] Plan/amount mismatch for order:", razorpay_order_id);
        return NextResponse.json({ error: "Payment does not match the selected plan." }, { status: 400 });
      }
      orderUserId = order.notes.userId || "";
    }

    // An order created for one account cannot be redeemed by another
    if (orderUserId && orderUserId !== "anonymous" && verifiedUid && orderUserId !== verifiedUid) {
      return NextResponse.json({ error: "This payment belongs to a different account." }, { status: 403 });
    }

    const entitlement = constructPurchasedEntitlement(planId as PlanId, razorpay_order_id, razorpay_payment_id);

    // Authoritative server-side entitlement write (clients cannot write this document)
    if (verifiedUid) {
      try {
        const adminDb = getFirebaseAdminFirestore();
        if (adminDb) {
          await adminDb.collection("users").doc(verifiedUid).collection("data").doc("entitlement").set(entitlement, { merge: true });
          console.log(`[Payment API] Server updated Firestore entitlement for user ${verifiedUid}`);
        }
      } catch (fErr) {
        console.warn("[Payment API] Server firestore update notice:", fErr);
      }
    }

    return NextResponse.json({
      success: true,
      message: plan.billingType === "one_time_support" ? "Thank you for supporting Reader's HUB! ✨" : "Welcome to Reader Pro ✨",
      entitlement,
      verifiedUid: verifiedUid || null,
    });
  } catch (error: any) {
    console.error("[Payment API] Verification error:", error);
    return NextResponse.json({ error: "An unexpected error occurred while verifying payment." }, { status: 500 });
  }
}
