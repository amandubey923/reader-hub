import { NextRequest, NextResponse } from "next/server";
import { executeWithKeyRotation, getGeminiKeyPool } from "@/lib/gemini-rotator";
import { guardAiRequest } from "@/lib/server/ai-guard";
import {
  tryDeterministicQuery,
  getCompactCatalogSummary,
  findBooksByIds,
  simplifyAssistantResponse,
  AssistantResponse,
} from "@/lib/library-assistant";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const userMessage: string = typeof body?.message === "string" ? body.message.trim() : "";

    if (!userMessage) {
      return NextResponse.json(
        { reply: "Please enter a question about Reader's HUB books or library availability.", books: [] },
        { status: 400 }
      );
    }

    if (userMessage.length > 800) {
      return NextResponse.json(
        { reply: "Your question is too long. Please ask a more concise question about the library.", books: [] },
        { status: 400 }
      );
    }

    // -------------------------------------------------------------
    // Step 1: SEARCH FIRST (Deterministic fast path with zero AI latency)
    // -------------------------------------------------------------
    const deterministicResult = tryDeterministicQuery(userMessage);
    if (deterministicResult) {
      return NextResponse.json(simplifyAssistantResponse(deterministicResult));
    }

    // -------------------------------------------------------------
    // Step 2: GEMINI API GROUNDED INFERENCE (With Key Rotation)
    // -------------------------------------------------------------
    const guard = await guardAiRequest(req.headers, "chat");
    if (!guard.allowed) {
      return NextResponse.json(
        { reply: guard.message, books: [], suggestedActions: ["Browse categories", "What's available?"] },
        { status: guard.status, headers: { "Retry-After": String(guard.retryAfterSeconds) } }
      );
    }

    const keyPool = getGeminiKeyPool();
    if (keyPool.length === 0) {
      return NextResponse.json({
        reply: "I couldn't find a direct match. Try asking about a specific book title, author (e.g. Osho, Plato, Premchand), or genre category in Reader's HUB.",
        books: [],
        suggestedActions: ["Browse categories", "What's available?"],
      });
    }

    const catalogSummary = getCompactCatalogSummary();

    const systemInstruction = `
You are the "Reader's HUB Assistant", a simple, polite library helper for the Reader's HUB digital book platform.
You only do basic things: find books in the catalog, give basic book information, and make short suggestions.
Keep every answer brief: at most 2 short sentences. (Deeper reading help is handled by Bodhi, the reading companion.)

CRITICAL RULES (ABSOLUTE):
1. The catalog provided below is the ONLY source of truth for book availability in Reader's HUB.
2. NEVER invent books, authors, genres, ratings, or external URLs that do not exist in this catalog.
3. If a user asks for a book or author not in this catalog, state clearly that it is NOT currently available in Reader's HUB.
4. If a user asks an unrelated question (such as writing code, weather, general world facts, politics, jokes, math), do NOT answer it normally. Politely reply with:
   "I'm here specifically to help you explore the Reader's HUB library. Try asking me about a book, author, category, or availability."
5. Format your response strictly as a valid JSON object with the following structure:
{
  "reply": "A short, plain answer (at most 2 sentences).",
  "bookIds": ["up to 3 exact ids from the catalog"]
}

READER'S HUB LIBRARY CATALOG:
${catalogSummary}
`;

    let rawOutput = "";
    try {
      const { result } = await executeWithKeyRotation(
        async (ai, _keyEntry, model) => {
          const response = await ai.models.generateContent({
            model,
            contents: [
              {
                role: "user",
                parts: [{ text: userMessage }],
              },
            ],
            config: {
              systemInstruction,
              temperature: 0.2,
              responseMimeType: "application/json",
            },
          });
          return response.text || "";
        },
        {
          models: [
            "gemini-3.1-flash-lite-preview",
            "gemini-3-flash-preview",
            "gemini-3.1-flash-lite",
            "gemini-3.6-flash",
            "gemini-3.7-flash",
            "gemini-2.5-flash",
          ],
          perAttemptTimeoutMs: 8000,
          logPrefix: "[Chat API]",
        }
      );
      rawOutput = result;
    } catch (err: any) {
      console.warn("[Chat API] All keys and models failed in rotation:", err?.message || err);
    }

    if (rawOutput) {
      try {
        const parsed = JSON.parse(rawOutput);
        const matchingBooks = findBooksByIds(parsed.bookIds || []);

        const finalResponse: AssistantResponse = {
          reply: parsed.reply || "Here is what I found in the Reader's HUB library:",
          books: matchingBooks,
        };

        return NextResponse.json(simplifyAssistantResponse(finalResponse));
      } catch {
        // Fallback for non-json text response
        return NextResponse.json(simplifyAssistantResponse({ reply: rawOutput.replace(/```json|```/g, "").trim(), books: [] }));
      }
    }

    // Default graceful fallback
    return NextResponse.json({
      reply: "I'm having a brief connection issue with the AI service. You can browse all categories or search for specific books like 1984, Atomic Habits, or Meditations directly in Reader's HUB!",
      books: [],
      suggestedActions: ["What's available?", "Browse categories"],
    });
  } catch (error: any) {
    console.error("Chat API error:", error);
    return NextResponse.json(
      {
        reply: "I encountered an error processing your request. Please try asking about a specific book or category in Reader's HUB.",
        books: [],
      },
      { status: 500 }
    );
  }
}
