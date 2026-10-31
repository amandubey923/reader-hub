"use client";

import React from "react";
import { highlightMatches } from "@/lib/search/catalog-search";

/** Renders text with words matching the search tokens emphasised (safe: plain React text nodes). */
export default function Highlight({ text, tokens, className = "" }: { text: string; tokens: string[]; className?: string }) {
  if (!tokens.length) return <span className={className}>{text}</span>;
  return (
    <span className={className}>
      {highlightMatches(text, tokens).map((seg, i) =>
        seg.match ? (
          <mark key={i} className="rounded-sm bg-[var(--accent)]/20 px-0.5 text-inherit">
            {seg.text}
          </mark>
        ) : (
          <React.Fragment key={i}>{seg.text}</React.Fragment>
        )
      )}
    </span>
  );
}
