import { NextRequest, NextResponse } from "next/server";
import { executeWithKeyRotation, getGeminiKeyPool } from "@/lib/gemini-rotator";
import { guardAiRequest } from "@/lib/server/ai-guard";

export const runtime = "nodejs";

export interface PagePayload {
  pageNum: number;
  text: string;
}

export type TranslationTarget = "hindi" | "hinglish" | "english";

const VALID_TARGETS: TranslationTarget[] = ["hindi", "hinglish", "english"];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const pages: unknown = body?.pages;
    const requestedTarget = body?.targetLanguage ?? "hindi";

    if (!VALID_TARGETS.includes(requestedTarget)) {
      return NextResponse.json({ success: false, error: "Unsupported translation language." }, { status: 400 });
    }
    const targetLanguage: TranslationTarget = requestedTarget;

    if (!Array.isArray(pages) || pages.length === 0) {
      return NextResponse.json(
        { success: false, error: "No page text provided to translate." },
        { status: 400 }
      );
    }

    // Limit to max 2 pages per request (current reading spread); page numbers are interpolated into the prompt
    const activePages: PagePayload[] = pages
      .slice(0, 2)
      .filter(
        (p: any): p is PagePayload =>
          p &&
          Number.isInteger(p.pageNum) &&
          p.pageNum > 0 &&
          p.pageNum < 100000 &&
          typeof p.text === "string" &&
          p.text.trim().length > 0
      );

    if (activePages.length === 0) {
      return NextResponse.json(
        { success: false, error: "This page does not contain selectable text." },
        { status: 400 }
      );
    }

    const guard = await guardAiRequest(req.headers, "translate");
    if (!guard.allowed) {
      return NextResponse.json(
        { success: false, error: guard.message },
        { status: guard.status, headers: { "Retry-After": String(guard.retryAfterSeconds) } }
      );
    }

    const keyPool = getGeminiKeyPool();
    if (keyPool.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Translation service is not configured. Please add GEMINI_API_KEY in environment variables.",
        },
        { status: 503 }
      );
    }

    const targetDesc =
      targetLanguage === "hindi"
        ? "Hindi (Devanagari script)"
        : targetLanguage === "hinglish"
        ? "Hinglish (Natural conversational Hindi written in Roman / Latin script, e.g. 'Yeh jeevan vartamaan mein hi ghatit ho raha hai')"
        : "English";

    const promptText = activePages
      .map((p) => `--- PAGE ${p.pageNum} ---\n${p.text.slice(0, 4000)}`)
      .join("\n\n");

    const systemInstruction = `
You are an expert literary and educational translator for the "Reader's HUB" digital library.
Your task is to translate the provided book page text into ${targetDesc}.

CRITICAL TRANSLATION GUIDELINES:
1. Target language: ${targetDesc}.
2. If target is "hinglish": Produce natural, conversational, and culturally authentic Hindi written in English/Latin letters (Roman Hindi). Do NOT invent bizarre slang. Keep it clear, eloquent, and easy to read.
3. If target is "hindi": Produce grammatically correct, natural Hindi in Devanagari script.
4. If target is "english": Produce fluent, articulate English.
5. Preserve paragraph structures and line breaks where appropriate.
6. Return your translation strictly formatted as a valid JSON object where keys are the page numbers as strings and values are the translated text for that page:
{
  "${activePages[0].pageNum}": "translated text for page ${activePages[0].pageNum}..."${
      activePages.length > 1
        ? `,\n  "${activePages[1].pageNum}": "translated text for page ${activePages[1].pageNum}..."`
        : ""
    }
}
`;

    const { result: rawOutput, keyUsed, modelUsed } = await executeWithKeyRotation(
      async (ai, keyEntry, model) => {
        const response = await ai.models.generateContent({
          model,
          contents: [
            {
              role: "user",
              parts: [{ text: promptText }],
            },
          ],
          config: {
            systemInstruction,
            temperature: 0.3,
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
        perAttemptTimeoutMs: 7500,
        logPrefix: "[Translate API]",
      }
    );

    if (!rawOutput) {
      return NextResponse.json(
        { success: false, error: "Translation service temporarily unavailable. Please try again." },
        { status: 502 }
      );
    }

    try {
      const cleaned = rawOutput
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
      const parsedTranslations = JSON.parse(cleaned);
      const formattedResult: Record<number, string> = {};

      for (const p of activePages) {
        formattedResult[p.pageNum] =
          parsedTranslations[String(p.pageNum)] ||
          parsedTranslations[p.pageNum] ||
          parsedTranslations[`PAGE ${p.pageNum}`] ||
          "";
      }

      return NextResponse.json({
        success: true,
        targetLanguage,
        translations: formattedResult,
      });
    } catch {
      // Fallback if model returned plain string
      const formattedResult: Record<number, string> = {};
      formattedResult[activePages[0].pageNum] = rawOutput.replace(/```json|```/g, "").trim();
      return NextResponse.json({
        success: true,
        targetLanguage,
        translations: formattedResult,
      });
    }
  } catch (error: any) {
    console.error("[Translate API] Unexpected error:", error?.message || error);
    return NextResponse.json(
      { success: false, error: "Translation service temporarily unavailable. Please try again." },
      { status: 503 }
    );
  }
}
