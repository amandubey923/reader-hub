"use client";

import React from "react";

const CITATION = /([([]\s*(?:pp?\.|pages?|pg\.?|पृष्ठ|पेज)\s*(\d{1,5})(?:\s*[–—-]\s*\d{1,5})?\s*[)\]])/gi;

function renderInline(text: string, onCite: (page: number) => void, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  text.split(/(\*\*[^*]+\*\*)/g).forEach((segment, si) => {
    if (segment.startsWith("**") && segment.endsWith("**") && segment.length > 4) {
      out.push(
        <strong key={`${keyBase}-b${si}`} className="font-semibold text-[var(--foreground)]">
          {segment.slice(2, -2)}
        </strong>
      );
      return;
    }
    let last = 0;
    segment.replace(CITATION, (match, _full, page, offset: number) => {
      if (offset > last) out.push(segment.slice(last, offset));
      out.push(
        <button
          key={`${keyBase}-c${si}-${offset}`}
          type="button"
          onClick={() => onCite(Number(page))}
          className="mx-0.5 inline-flex cursor-pointer items-center rounded-md bg-[var(--accent)]/10 px-1.5 py-0.5 align-baseline font-mono text-[11px] font-semibold text-[var(--accent)] hover:bg-[var(--accent)]/20"
          title={`Go to page ${page}`}
        >
          {match.replace(/[()[\]]/g, "")}
        </button>
      );
      last = offset + match.length;
      return match;
    });
    if (last < segment.length) out.push(segment.slice(last));
  });
  return out;
}

/** Safe light-markdown rendering (bold, bullet/numbered lists, paragraphs) with clickable page citations. */
export default function MessageText({ text, onCite }: { text: string; onCite: (page: number) => void }) {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flush = (key: string) => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(
      <Tag key={key} className={`my-1.5 space-y-1 pl-5 ${list.ordered ? "list-decimal" : "list-disc"}`}>
        {list.items.map((item, i) => (
          <li key={i}>{renderInline(item, onCite, `${key}-${i}`)}</li>
        ))}
      </Tag>
    );
    list = null;
  };

  lines.forEach((line, i) => {
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flush(`l${i}`);
      if (!list) list = { ordered, items: [] };
      list.items.push((bullet || numbered)![1]);
      return;
    }
    flush(`l${i}`);
    if (line.trim()) blocks.push(<p key={`p${i}`} className="my-1">{renderInline(line, onCite, `p${i}`)}</p>);
  });
  flush("end");

  return <div className="text-[15px] leading-relaxed">{blocks}</div>;
}
