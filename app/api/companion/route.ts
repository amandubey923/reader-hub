import { NextRequest, NextResponse } from "next/server";
import { getGeminiKeyPool } from "@/lib/gemini-rotator";
import { GUEST_IP_DAILY_MULTIPLIER, guardAiRequest, isProUser } from "@/lib/server/ai-guard";
import { getVerifiedCaller } from "@/lib/server/auth";
import { getClientIp } from "@/lib/server/rate-limit";
import { COMPANION_FREE_DAILY_MESSAGES, consumeCompanionMessage } from "@/lib/server/companion-quota";
import { PRO_ENFORCEMENT_ENABLED } from "@/lib/monetization-config";
import { validateCompanionRequest } from "@/lib/companion/validate";
import { runCompanionAgent } from "@/lib/companion/agent";
import { geminiGenerate } from "@/lib/companion/gemini";
import type { CompanionResponse, CompanionUsage } from "@/lib/companion/types";

export const runtime = "nodejs";

const COMPANION_LIMIT_MESSAGE =
  "You've used today's free Bodhi messages. Upgrade to Reader Pro for unlimited conversations. Page commands like \"next page\" still work.";

const degraded = (reply: string, usage?: CompanionUsage, status = 200) =>
  NextResponse.json<CompanionResponse>({ reply, actions: [], sources: [], books: [], degraded: true, usage }, { status });

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const validation = validateCompanionRequest(body);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const caller = await getVerifiedCaller(req.headers.get("authorization"));
    // Burst protection for everyone; the daily allowance is counted below per account
    const guard = await guardAiRequest(req.headers, "companion", { caller, skipDaily: true });
    if (!guard.allowed) {
      return NextResponse.json(
        { error: guard.message },
        { status: guard.status, headers: { "Retry-After": String(guard.retryAfterSeconds) } }
      );
    }

    // Free allowance (Pro readers are unlimited). Counted before the model runs so parallel requests cannot overshoot.
    let usage: CompanionUsage | undefined;
    let refund: (() => Promise<void>) | undefined;
    if (PRO_ENFORCEMENT_ENABLED && !(caller && (await isProUser(caller.uid)))) {
      const limit = caller ? COMPANION_FREE_DAILY_MESSAGES : COMPANION_FREE_DAILY_MESSAGES * GUEST_IP_DAILY_MULTIPLIER;
      const allowance = await consumeCompanionMessage(caller?.uid ?? null, getClientIp(req.headers), validation.value.requestId, limit);
      const { decision } = allowance;
      // Guests share an IP-wide backstop; the per-reader number they see is the standard allowance
      const shownLimit = caller ? limit : COMPANION_FREE_DAILY_MESSAGES;
      if (decision.duplicate) {
        return NextResponse.json({ error: "This message is already being answered.", code: "duplicate" }, { status: 409 });
      }
      if (!decision.allowed) {
        return NextResponse.json(
          { error: COMPANION_LIMIT_MESSAGE, code: "companion_limit", usage: { used: shownLimit, limit: shownLimit } },
          { status: 429 }
        );
      }
      usage = { used: Math.min(decision.used, shownLimit), limit: shownLimit };
      refund = allowance.refund;
    }

    if (getGeminiKeyPool().length === 0) {
      await refund?.();
      return degraded(
        "My AI connection isn't configured yet, so I can't explain pages right now. I can still turn pages for you: try \"next page\" or \"page 40\"."
      );
    }

    try {
      const response = await runCompanionAgent(validation.value, geminiGenerate);
      return NextResponse.json<CompanionResponse>({ ...response, usage });
    } catch (err: any) {
      console.warn("[Companion API] Agent failure:", err?.message || err);
      // The reader did not get an answer, so the message is not counted
      await refund?.();
      return degraded("I'm having trouble reaching my AI service right now. Please try again in a moment.");
    }
  } catch (error: any) {
    console.error("[Companion API] Unexpected error:", error?.message || error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
