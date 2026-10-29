import { NextRequest, NextResponse } from "next/server";
import { isSafeBookId } from "@/lib/reading-merge";
import { catalogBookExists } from "@/lib/companion/catalog-tools";
import { getBookContentPolicy } from "@/lib/companion/content-policy";

export const runtime = "nodejs";

/**
 * GET /api/companion/policy?bookId=... — whether whole-book search may be offered for a title.
 * Public, read-only, derived from the content-rights audit.
 */
export async function GET(req: NextRequest) {
  const bookId = new URL(req.url).searchParams.get("bookId") || "";
  if (!isSafeBookId(bookId) || !catalogBookExists(bookId)) {
    return NextResponse.json({ error: "Unknown book." }, { status: 404 });
  }
  const policy = getBookContentPolicy(bookId);
  return NextResponse.json(
    { bookId, bookWideAllowed: policy.bookWideAllowed, reason: policy.reason },
    { headers: { "Cache-Control": "public, max-age=3600" } }
  );
}
