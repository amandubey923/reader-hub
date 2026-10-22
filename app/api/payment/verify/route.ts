import { NextRequest, NextResponse } from "next/server";
import { verifyPaymentSignature } from "@/lib/razorpay";
import { getPlanConfig, PlanId } from "@/lib/monetization-config";
import { constructPurchasedEntitlement, verifyFirebaseIdToken } from "@/lib/entitlements";
import { getFirebaseAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, planId } = body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !planId) {
      return NextResponse.json({ error: "Incomplete payment verification payload." }, { status: 400 });
    }

    const plan = getPlanConfig(planId as PlanId);
    if (!plan) {
      return NextResponse.json({ error: "Invalid plan ID for verification." }, { status: 400 });
    }

    const isValid = verifyPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
    if (!isValid) {
      console.warn("[Payment API] Invalid signature for order:", razorpay_order_id);
      return NextResponse.json({ error: "Payment verification failed. Signature mismatch." }, { status: 400 });
    }

    const authHeader = req.headers.get("authorization") || "";
    let verifiedUid = "";
    if (authHeader.startsWith("Bearer ")) {
      const idToken = authHeader.slice(7).trim();
      const verified = await verifyFirebaseIdToken(idToken);
      if (verified) verifiedUid = verified.uid;
    }

    const entitlement = constructPurchasedEntitlement(planId as PlanId, razorpay_order_id, razorpay_payment_id);

    // Authoritative Server-Side Firestore Update
    if (verifiedUid) {
      try {
        const adminDb = getFirebaseAdminDb();
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
