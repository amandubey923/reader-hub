import { NextRequest, NextResponse } from "next/server";
import { isSafeBookId } from "@/lib/reading-merge";
import { getGeminiKeyPool } from "@/lib/gemini-rotator";
import { guardAiRequest } from "@/lib/server/ai-guard";
import { getVerifiedCaller } from "@/lib/server/auth";
import { catalogBookExists } from "@/lib/companion/catalog-tools";
import { getBookContentPolicy } from "@/lib/companion/content-policy";
import { geminiEmbed } from "@/lib/companion/gemini";

export const runtime = "nodejs";

const MAX_TEXTS = 32;
const MAX_TEXT_CHARS = 2000;

/**
 * POST /api/companion/embed — embeddings for semantic whole-book search.
 * Signed-in readers only, rights-cleared titles only, and budgeted per account per day.
 */
export async function POST(req: NextRequest) {
  try {
    const caller = await getVerifiedCaller(req.headers.get("authorization"));
    if (!caller) {
      return NextResponse.json({ error: "Please sign in to turn on semantic search." }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const bookId = typeof body?.bookId === "string" ? body.bookId : "";
    const kind = body?.kind === "query" ? "query" : "document";
    const texts: unknown = body?.texts;

    if (!isSafeBookId(bookId) || !catalogBookExists(bookId)) {
      return NextResponse.json({ error: "Unknown book." }, { status: 400 });
    }
    if (!getBookContentPolicy(bookId).bookWideAllowed) {
      return NextResponse.json({ error: "Whole-book processing is not permitted for this title." }, { status: 403 });
    }
    if (
      !Array.isArray(texts) ||
      texts.length === 0 ||
      texts.length > MAX_TEXTS ||
      texts.some((t) => typeof t !== "string" || !t.trim() || t.length > MAX_TEXT_CHARS)
    ) {
      return NextResponse.json({ error: `Send 1-${MAX_TEXTS} non-empty texts of up to ${MAX_TEXT_CHARS} characters.` }, { status: 400 });
    }

    const guard = await guardAiRequest(req.headers, "embed", { cost: texts.length, caller });
    if (!guard.allowed) {
      return NextResponse.json(
        { error: guard.message },
        { status: guard.status, headers: { "Retry-After": String(guard.retryAfterSeconds) } }
      );
    }

    if (getGeminiKeyPool().length === 0) {
      return NextResponse.json({ error: "Semantic search is not configured on this server." }, { status: 503 });
    }

    const vectors = await geminiEmbed(texts as string[], kind);
    return NextResponse.json({ vectors });
  } catch (err: any) {
    console.warn("[Companion Embed] Failure:", err?.message || err);
    return NextResponse.json({ error: "Semantic search is temporarily unavailable." }, { status: 503 });
  }
}
