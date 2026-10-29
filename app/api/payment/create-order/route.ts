import { NextRequest, NextResponse } from "next/server";
import { createRazorpayOrder, getRazorpayKeys } from "@/lib/razorpay";
import { getPlanConfig, PlanId, RAZORPAY_PAYMENTS_ENABLED, PRO_ENFORCEMENT_ENABLED } from "@/lib/monetization-config";
import { verifyFirebaseIdToken } from "@/lib/entitlements";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    if (!RAZORPAY_PAYMENTS_ENABLED || !PRO_ENFORCEMENT_ENABLED) {
      return NextResponse.json(
        {
          success: false,
          error: "Razorpay payment processing is temporarily unavailable while verification is in progress.",
        },
        { status: 503 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const planId: PlanId = body?.planId;

    if (!planId) {
      return NextResponse.json({ error: "Plan ID is required." }, { status: 400 });
    }

    const plan = getPlanConfig(planId);
    if (!plan || plan.amountPaise <= 0) {
      return NextResponse.json({ error: "Invalid plan selected." }, { status: 400 });
    }

    const authHeader = req.headers.get("authorization") || "";
    let verifiedUser: { uid: string; email?: string } | null = null;
    if (authHeader.startsWith("Bearer ")) {
      const idToken = authHeader.slice(7).trim();
      verifiedUser = await verifyFirebaseIdToken(idToken);
    }

    const orderResult = await createRazorpayOrder({
      planId,
      // Order ownership is bound to the verified caller only; client-supplied IDs are ignored
      userId: verifiedUser?.uid || "anonymous",
      userEmail: verifiedUser?.email || "",
      userName: body?.userName || "",
    });

    const { keyId } = getRazorpayKeys();

    return NextResponse.json({
      success: true,
      orderId: orderResult.orderId,
      amount: orderResult.amount,
      currency: orderResult.currency,
      planId: orderResult.planId,
      keyId,
      planName: plan.name,
      billingLabel: plan.billingLabel,
    });
  } catch (error: any) {
    console.error("[Payment API] Create order error:", error);
    return NextResponse.json({ error: error?.message || "Failed to initiate payment order." }, { status: 500 });
  }
}