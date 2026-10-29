/**
 * Gemini adapters for the companion, built on the existing key-rotation engine (server-only).
 */

import { executeWithKeyRotation } from "@/lib/gemini-rotator";
import type { GenerateFn } from "./agent";

const CHAT_MODELS = [
  "gemini-3.1-flash-lite-preview",
  "gemini-3-flash-preview",
  "gemini-3.1-flash-lite",
  "gemini-3.6-flash",
  "gemini-3.7-flash",
  "gemini-2.5-flash",
];

const EMBEDDING_MODELS = ["gemini-embedding-001", "text-embedding-004"];
export const EMBEDDING_DIMENSIONS = 768;

export const geminiGenerate: GenerateFn = async ({ systemInstruction, contents, tools }) => {
  const { result } = await executeWithKeyRotation(
    async (ai, _key, model) => {
      const response = await ai.models.generateContent({
        model,
        contents: contents as any,
        config: {
          systemInstruction,
          tools: tools as any,
          temperature: 0.4,
          maxOutputTokens: 1400,
        },
      });
      return {
        text: response.text || "",
        functionCalls: (response.functionCalls || []).map((c) => ({ name: c.name, args: c.args, id: c.id })),
        content: response.candidates?.[0]?.content,
      };
    },
    { models: CHAT_MODELS, perAttemptTimeoutMs: 15000, logPrefix: "[Companion API]" }
  );
  return result;
};

export async function geminiEmbed(texts: string[], kind: "document" | "query"): Promise<number[][]> {
  const { result } = await executeWithKeyRotation(
    async (ai, _key, model) => {
      const response = await ai.models.embedContent({
        model,
        contents: texts,
        config: {
          outputDimensionality: EMBEDDING_DIMENSIONS,
          taskType: kind === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT",
        },
      });
      const vectors = (response.embeddings || []).map((e) => e.values || []);
      if (vectors.length !== texts.length || vectors.some((v) => v.length === 0)) {
        throw new Error("Embedding response did not match the request.");
      }
      return vectors;
    },
    { models: EMBEDDING_MODELS, perAttemptTimeoutMs: 20000, logPrefix: "[Companion Embed]" }
  );
  return result;
}
