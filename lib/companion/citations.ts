/**
 * Page-citation guard: the companion may only cite pages whose text was actually supplied to the model.
 * Citations are written as "(p. 42)", "(pp. 42–43)", "[p. 42]" or "(page 42)".
 */

const CITATION = /[([]\s*(?:pp?\.|pages?|pg\.?|पृष्ठ|पेज)\s*(\d{1,5})(?:\s*[–—-]\s*(\d{1,5}))?\s*[)\]]/gi;

export interface CitationCheck {
  reply: string;
  citedPages: number[];
  removed: number;
}

export function enforceCitations(reply: string, supportedPages: Iterable<number>): CitationCheck {
  const supported = new Set(supportedPages);
  const cited = new Set<number>();
  let removed = 0;

  const cleaned = reply.replace(CITATION, (match, a: string, b?: string) => {
    const from = Number(a);
    const to = b ? Number(b) : from;
    const pages: number[] = [];
    for (let p = Math.min(from, to); p <= Math.max(from, to) && pages.length < 50; p++) pages.push(p);
    if (pages.length > 0 && pages.every((p) => supported.has(p))) {
      pages.forEach((p) => cited.add(p));
      return match;
    }
    removed++;
    return "";
  });

  return {
    reply: cleaned.replace(/[ \t]{2,}/g, " ").replace(/\s+([.,;:!?।])/g, "$1").trim(),
    citedPages: Array.from(cited).sort((x, y) => x - y),
    removed,
  };
}
