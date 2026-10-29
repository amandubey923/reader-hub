import { NextRequest, NextResponse } from "next/server";
import { getGeminiKeyPool } from "@/lib/gemini-rotator";
import { guardAiRequest } from "@/lib/server/ai-guard";
import { validateCompanionRequest } from "@/lib/companion/validate";
import { runCompanionAgent } from "@/lib/companion/agent";
import { geminiGenerate } from "@/lib/companion/gemini";
import type { CompanionResponse } from "@/lib/companion/types";

export const runtime = "nodejs";

const degraded = (reply: string, status = 200) =>
  NextResponse.json<CompanionResponse>({ reply, actions: [], sources: [], books: [], degraded: true }, { status });

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const validation = validateCompanionRequest(body);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const guard = await guardAiRequest(req.headers, "companion");
    if (!guard.allowed) {
      return NextResponse.json(
        { error: guard.message },
        { status: guard.status, headers: { "Retry-After": String(guard.retryAfterSeconds) } }
      );
    }

    if (getGeminiKeyPool().length === 0) {
      return degraded(
        "My AI connection isn't configured yet, so I can't explain pages right now. I can still turn pages for you: try \"next page\" or \"page 40\"."
      );
    }

    try {
      const response = await runCompanionAgent(validation.value, geminiGenerate);
      return NextResponse.json<CompanionResponse>(response);
    } catch (err: any) {
      console.warn("[Companion API] Agent failure:", err?.message || err);
      return degraded("I'm having trouble reaching my AI service right now. Please try again in a moment.");
    }
  } catch (error: any) {
    console.error("[Companion API] Unexpected error:", error?.message || error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
