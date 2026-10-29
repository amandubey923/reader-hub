/**
 * Deterministic parser for short, unambiguous reader commands in English, Hinglish and Hindi.
 * These run without a model call (instant, free, works when AI is unavailable).
 * Anything that looks like a question is left to the model.
 */

import type { CompanionAction } from "./types";

const MAX_COMMAND_LENGTH = 48;

// Questions ("what happens on page 40?") must never be treated as navigation
const QUESTION_HINT = /\?|\b(what|why|how|who|when|where|which|explain|summari[sz]e|kya|kyun|kaise|kaun|kab|samjha|batao|bataiye)\b|क्या|क्यों|कैसे|समझा|बताओ/i;

const NEXT_PATTERNS = [
  /^(go\s+to\s+(the\s+)?)?next(\s+(page|spread|pg))?$/i,
  /^turn(\s+the)?\s+page$/i,
  /^(agla|agle|aage)(\s+(page|panna|pg|पेज))?(\s+(pe|par)?\s*(jao|chalo|karo))?$/i,
  /^अगला(\s+(पेज|पन्ना|पृष्ठ))?$/,
];

const PREVIOUS_PATTERNS = [
  /^(go\s+(back|to\s+(the\s+)?previous)(\s+(page|spread))?|previous(\s+(page|spread|pg))?|prev(\s+page)?|back)$/i,
  /^(pichla|pichle|peeche|piche)(\s+(page|panna|pg|पेज))?(\s+(pe|par)?\s*(jao|chalo|karo))?$/i,
  /^पिछला(\s+(पेज|पन्ना|पृष्ठ))?$/,
];

const PAGE_NUMBER_PATTERNS = [
  /^(?:please\s+)?(?:go|jump|move|take\s+me|skip|turn)?\s*(?:to\s+)?(?:page|pg|p\.)\s*(\d{1,5})$/i,
  /^(?:page|pg|panna|पेज|पृष्ठ)\s*(\d{1,5})\s*(?:pe|par|per|पर)?\s*(?:jao|chalo|le\s+chalo|kholo|जाओ|चलो|खोलो)?$/i,
  /^(\d{1,5})\s*(?:number\s+)?(?:page|pg|पेज)\s*(?:pe|par|पर)?\s*(?:jao|chalo|जाओ|चलो)$/i,
];

const BOOKMARK_PATTERNS = [
  /^(?:please\s+)?bookmark(?:\s+(?:this|this\s+page|it|the\s+page|current\s+page))?$/i,
  /^(?:is|ye|yeh)\s+page\s+(?:ko\s+)?bookmark\s+(?:karo|kar\s+do|kardo)$/i,
  /^bookmark\s+(?:karo|kar\s+do|kardo)$/i,
];

export function parseDirectCommand(input: string): CompanionAction | null {
  const text = input.trim().replace(/[.!।]+$/u, "").replace(/\s+/g, " ");
  if (!text || text.length > MAX_COMMAND_LENGTH || QUESTION_HINT.test(text)) return null;

  for (const re of PAGE_NUMBER_PATTERNS) {
    const m = text.match(re);
    if (m) return { name: "go_to_page", args: { page: Number(m[1]) } };
  }
  if (NEXT_PATTERNS.some((re) => re.test(text))) return { name: "next_page", args: {} };
  if (PREVIOUS_PATTERNS.some((re) => re.test(text))) return { name: "previous_page", args: {} };
  if (BOOKMARK_PATTERNS.some((re) => re.test(text))) return { name: "bookmark_page", args: {} };
  return null;
}
