"use client";

import React, { useState } from "react";
import Link from "next/link";
import { FREE_TIER_LIMITS, PRO_ENFORCEMENT_ENABLED } from "@/lib/monetization-config";
import { DAILY_READING_GOAL_SECONDS } from "@/lib/reader-storage";
import {
  CATALOG_STATS,
  Cover,
  Eyebrow,
  FEATURED_BOOK,
  IllustrativeTag,
  Lede,
  Parallax,
  SlideProps,
  SlideTitle,
  pickBooks,
  primaryBtn,
  secondaryBtn,
} from "./shared";

const GOAL_MINUTES = Math.round(DAILY_READING_GOAL_SECONDS / 60);

// ---------------------------------------------------------------------------
// 04 — Understand every page (annotations, bookmarks, AI translation)
// ---------------------------------------------------------------------------

// The 1984 excerpt is taken from the catalog; translations are illustrative examples of the output
const EXCERPT_SENTENCES = (FEATURED_BOOK.excerpt || "War is peace. Freedom is slavery. Ignorance is strength.")
  .split(/\.\s+/)
  .filter(Boolean)
  .map((s) => (s.endsWith(".") ? s : `${s}.`));

const TRANSLATIONS = {
  english: EXCERPT_SENTENCES.join(" "),
  hindi: "युद्ध ही शांति है। स्वतंत्रता ही गुलामी है। अज्ञान ही शक्ति है।",
  hinglish: "Yuddh hi shanti hai. Azaadi hi gulaami hai. Agyaan hi shakti hai.",
} as const;

type Lang = keyof typeof TRANSLATIONS;

// Highlight colours offered by the reader (HighlightItem["color"])
const HIGHLIGHTS = [
  { id: "amber", label: "Amber", color: "rgba(232,162,58,0.45)" },
  { id: "mint", label: "Mint", color: "rgba(52,211,153,0.35)" },
  { id: "cyan", label: "Cyan", color: "rgba(34,211,238,0.33)" },
  { id: "purple", label: "Purple", color: "rgba(167,139,250,0.38)" },
] as const;

export function UnderstandSlide({ active }: SlideProps) {
  const [tool, setTool] = useState<(typeof HIGHLIGHTS)[number]["id"]>("amber");
  const [marks, setMarks] = useState<Record<number, string>>({ 0: "amber" });
  const [bookmarked, setBookmarked] = useState(true);
  const [lang, setLang] = useState<Lang>("hindi");

  const toggleMark = (i: number) =>
    setMarks((prev) => {
      const next = { ...prev };
      if (next[i] === tool) delete next[i];
      else next[i] = tool;
      return next;
    });

  const tab = (selected: boolean) =>
    `cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
      selected ? "bg-[#141b2d] text-[#f7f4ec]" : "text-[var(--text-secondary)] hover:text-[var(--foreground)]"
    }`;

  return (
    <div className="mx-auto grid min-h-full max-w-7xl grid-cols-1 items-center gap-10 px-5 pb-28 pt-24 sm:px-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:pt-20">
      <div>
        <Eyebrow index={4}>Study tools</Eyebrow>
        <SlideTitle>
          Understand <span className="text-gold-gradient italic">every page.</span>
        </SlideTitle>
        <Lede>
          Highlight in four colours, keep notes beside the text, sketch with pen, shapes and text boxes, and bookmark the pages
          you return to. When a page is in another language, AI can translate the pages you have open into Hindi, Hinglish or
          English.
        </Lede>
        <p className="rh-rise mt-4 text-xs leading-relaxed text-[var(--text-secondary)]" style={{ ["--d" as string]: "240ms" }}>
          {PRO_ENFORCEMENT_ENABLED
            ? `Free readers get ${FREE_TIER_LIMITS.DAILY_TRANSLATION_SPREADS} translated spreads and ${FREE_TIER_LIMITS.DAILY_AI_QUERIES} Library Assistant questions a day. `
            : ""}
          The Library Assistant answers questions about books in the catalog.
        </p>
      </div>

      <div className="relative grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {/* Annotatable page */}
        <Parallax depth={12}>
          <div
            className="rh-rise relative rounded-xl border border-[var(--border)] p-6 shadow-[0_40px_70px_-36px_rgba(20,27,45,0.55)]"
            style={{ ["--d" as string]: "100ms", background: "linear-gradient(180deg, #fffdf8, #f8f2e5)" }}
          >
            <button
              type="button"
              onClick={() => setBookmarked((b) => !b)}
              aria-pressed={bookmarked}
              aria-label={bookmarked ? "Remove bookmark" : "Bookmark this page"}
              className="absolute -top-1 right-6 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              <span
                className="block h-12 w-7 transition-all duration-500"
                style={{
                  background: bookmarked ? "linear-gradient(180deg,#e8a23a,#b45309)" : "color-mix(in srgb, #141b2d 14%, transparent)",
                  clipPath: "polygon(0 0,100% 0,100% 100%,50% 78%,0 100%)",
                  transform: bookmarked ? "translateY(0)" : "translateY(-10px)",
                }}
              />
            </button>
            <div className="font-serif text-xs font-bold uppercase tracking-[0.2em] text-[#a95c0a]">{FEATURED_BOOK.title}</div>
            <div className="mt-4 space-y-2 font-serif text-lg leading-relaxed text-[#141b2d] sm:text-xl">
              {EXCERPT_SENTENCES.map((s, i) => {
                const mark = HIGHLIGHTS.find((h) => h.id === marks[i]);
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => toggleMark(i)}
                    className="block cursor-pointer rounded px-1 text-left transition-colors duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                    style={{ background: mark ? mark.color : "transparent" }}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
            <div className="mt-5 flex items-center gap-2" role="radiogroup" aria-label="Highlight colour">
              {HIGHLIGHTS.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  role="radio"
                  aria-checked={tool === h.id}
                  aria-label={`${h.label} highlighter`}
                  onClick={() => setTool(h.id)}
                  className={`h-6 w-6 cursor-pointer rounded-full border-2 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                    tool === h.id ? "scale-110 border-[#141b2d]" : "border-transparent hover:scale-105"
                  }`}
                  style={{ background: h.color }}
                />
              ))}
              <span className="ml-2 text-[11px] text-[#566074]">Pick a colour, tap a sentence</span>
            </div>
            <div
              className="absolute -top-12 left-1/3 hidden w-44 rotate-2 rounded-lg border border-[#e8a23a]/50 bg-[#fffaf0] p-3 shadow-lg sm:block"
              aria-hidden="true"
            >
              <div className="text-[9px] font-bold uppercase tracking-wider text-[#a95c0a]">Note</div>
              <div className="mt-1 text-[11px] leading-snug text-[#141b2d]">The Party&apos;s slogans contradict themselves on purpose.</div>
            </div>
          </div>
        </Parallax>

        {/* Translation panel */}
        <Parallax depth={22}>
          <div
            className="rh-rise mt-6 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-[0_30px_60px_-34px_rgba(20,27,45,0.5)] sm:mt-14"
            style={{ ["--d" as string]: "220ms" }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--accent)]">Translate spread</span>
              <IllustrativeTag />
            </div>
            <div className="mt-3 flex gap-1 rounded-xl border border-[var(--border)] bg-[var(--background)] p-1" role="tablist" aria-label="Translation language">
              {(["hindi", "hinglish", "english"] as Lang[]).map((l) => (
                <button key={l} type="button" role="tab" aria-selected={lang === l} className={tab(lang === l)} onClick={() => setLang(l)}>
                  {l === "hindi" ? "हिन्दी" : l === "hinglish" ? "Hinglish" : "English"}
                </button>
              ))}
            </div>
            <p key={lang} className="rh-fade mt-4 min-h-[5.5rem] font-serif text-base leading-relaxed text-[var(--foreground)]" lang={lang === "hindi" ? "hi" : "en"}>
              {TRANSLATIONS[lang]}
            </p>
          </div>
        </Parallax>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 05 — Remember your reading journey
// ---------------------------------------------------------------------------

const PROGRESS_DEMO = pickBooks(["the-great-gatsby", "godan", "crime-and-punishment"]).map((book, i) => ({
  book,
  percent: [72, 38, 15][i],
}));

const COLLECTION_DEMO = pickBooks(["kamayani", "madhushala", "godan"]);

function ProgressRing({ percent, active, reducedMotion }: { percent: number; active: boolean; reducedMotion: boolean }) {
  const r = 26;
  const circ = 2 * Math.PI * r;
  const shown = active ? percent : 0;
  return (
    <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90" aria-hidden="true">
      <circle cx="32" cy="32" r={r} fill="none" stroke="color-mix(in srgb, var(--foreground) 10%, transparent)" strokeWidth="6" />
      <circle
        cx="32"
        cy="32"
        r={r}
        fill="none"
        stroke="url(#rhGold)"
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={circ * (1 - shown / 100)}
        style={{ transition: reducedMotion ? "none" : "stroke-dashoffset 1400ms cubic-bezier(0.22,1,0.36,1) 300ms" }}
      />
    </svg>
  );
}

export function JourneySlide({ active, reducedMotion }: SlideProps) {
  const card = "rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-[0_30px_60px_-36px_rgba(20,27,45,0.45)]";
  return (
    <div className="mx-auto flex min-h-full max-w-7xl flex-col justify-center px-5 pb-28 pt-24 sm:px-8 lg:pt-20">
      <svg width="0" height="0" className="absolute" aria-hidden="true">
        <defs>
          <linearGradient id="rhGold" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#e8a23a" />
            <stop offset="100%" stopColor="#b45309" />
          </linearGradient>
        </defs>
      </svg>

      <div className="grid grid-cols-1 items-end gap-6 lg:grid-cols-2">
        <div>
          <Eyebrow index={5}>Your journey</Eyebrow>
          <SlideTitle>
            Remember your <span className="text-gold-gradient italic">reading journey.</span>
          </SlideTitle>
        </div>
        <Lede>
          Pick up where you left off, keep a daily streak, gather books into collections and look back on every session. Sign in and
          it follows you across devices.
        </Lede>
      </div>

      <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-[1.25fr_1fr_1fr]">
        <Parallax depth={8} className="rh-rise lg:row-span-2" style={{ ["--d" as string]: "120ms" }}>
          <div className={`${card} h-full`}>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--accent)]">Continue reading</span>
              <IllustrativeTag />
            </div>
            <ul className="mt-4 space-y-4">
              {PROGRESS_DEMO.map(({ book, percent }) => (
                <li key={book.id} className="flex items-center gap-4">
                  <Cover book={book} sizes="48px" className="aspect-[2/3] w-12 shrink-0 shadow-md" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-serif text-sm font-bold text-[var(--foreground)]">{book.title}</div>
                    <div className="truncate text-xs text-[var(--text-secondary)]">{book.author}</div>
                  </div>
                  <div className="relative">
                    <ProgressRing percent={percent} active={active} reducedMotion={reducedMotion} />
                    <span className="absolute inset-0 flex items-center justify-center font-mono text-[11px] font-bold text-[var(--foreground)]">
                      {percent}%
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </Parallax>

        <Parallax depth={14} className="rh-rise" style={{ ["--d" as string]: "200ms" }}>
          <div className={card}>
            <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--accent)]">Daily streak</span>
            <div className="mt-3 flex items-end gap-1.5" aria-label="Five of the last seven days reached the daily goal">
              {Array.from({ length: 7 }).map((_, d) => {
                const lit = d < 5;
                return (
                  <div key={d} className="flex flex-1 flex-col items-center gap-1.5">
                    <span
                      className="block w-full rounded-md transition-all duration-700"
                      style={{
                        height: active ? `${lit ? 28 + ((d * 7) % 20) : 10}px` : "6px",
                        transitionDelay: `${300 + d * 70}ms`,
                        background: lit ? "linear-gradient(180deg,#e8a23a,#b45309)" : "color-mix(in srgb, var(--foreground) 10%, transparent)",
                      }}
                    />
                    <span className="text-[9px] text-[var(--text-secondary)]">{"MTWTFSS"[d]}</span>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-[var(--text-secondary)]">
              {`Read actively for ${GOAL_MINUTES} minutes to light the day's diya 🪔`}
            </p>
          </div>
        </Parallax>

        <Parallax depth={20} className="rh-rise" style={{ ["--d" as string]: "260ms" }}>
          <div className={card}>
            <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--accent)]">Collections</span>
            <div className="relative mt-3 h-24" style={{ perspective: "800px" }}>
              {COLLECTION_DEMO.map((book, i) => (
                <div
                  key={book.id}
                  className="absolute top-0 transition-transform duration-500 hover:-translate-y-2"
                  style={{ left: `${i * 26}%`, transform: `rotateY(-18deg) translateZ(${-i * 12}px)`, zIndex: 3 - i }}
                >
                  <Cover book={book} sizes="64px" className="aspect-[2/3] w-16 shadow-lg" />
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-[var(--text-secondary)]">Group books into your own named shelves.</p>
          </div>
        </Parallax>

        <Parallax depth={12} className="rh-rise" style={{ ["--d" as string]: "320ms" }}>
          <div className={card}>
            <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--accent)]">Reading memory</span>
            <ol className="mt-3 space-y-2 border-l border-[var(--border)] pl-4">
              {[
                ["Today", "24 min · pages 112–131"],
                ["Yesterday", "16 min · pages 96–111"],
                ["Mon", "31 min · pages 64–95"],
              ].map(([day, detail]) => (
                <li key={day} className="relative text-xs">
                  <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-[var(--accent-glow)]" />
                  <span className="font-semibold text-[var(--foreground)]">{day}</span>
                  <span className="text-[var(--text-secondary)]"> · {detail}</span>
                </li>
              ))}
            </ol>
          </div>
        </Parallax>

        <Parallax depth={18} className="rh-rise" style={{ ["--d" as string]: "380ms" }}>
          <div className="rounded-2xl p-[2px] shadow-[0_30px_60px_-36px_rgba(180,83,9,0.6)]" style={{ background: "linear-gradient(135deg,#e8a23a,#d97706,#b45309)" }}>
            <div className="rounded-[14px] bg-[var(--card)] p-5 text-center">
              <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--accent)]">Certificate of completion</div>
              <div className="mt-2 font-serif text-lg font-bold text-[var(--foreground)]">Finish a book, keep the proof</div>
              <div className="mt-1 text-xs text-[var(--text-secondary)]">Download your certificate as a PDF</div>
            </div>
          </div>
        </Parallax>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 06 — Begin
// ---------------------------------------------------------------------------

const SHELF_BOOKS = pickBooks([
  "1984",
  "the-great-gatsby",
  "godan",
  "crime-and-punishment",
  "madhushala",
  "pride-and-prejudice",
  "kamayani",
  "one-hundred-years-of-solitude",
  "the-lord-of-the-rings",
  "complete-works-of-swami-ji",
]);

export function BeginSlide({ active, onAuth, onReplay }: SlideProps) {
  const shelves = [SHELF_BOOKS.slice(0, 5), SHELF_BOOKS.slice(5, 10)];
  return (
    <div className="mx-auto grid min-h-full max-w-7xl grid-cols-1 items-center gap-12 px-5 pb-28 pt-24 sm:px-8 lg:grid-cols-2 lg:pt-20">
      {/* 3D bookshelf */}
      <Parallax depth={14} className="order-2 lg:order-1">
        <div className="rh-rise mx-auto w-full max-w-[520px]" style={{ perspective: "1300px", ["--d" as string]: "80ms" }}>
          <div style={{ transform: "rotateY(14deg) rotateX(4deg)", transformStyle: "preserve-3d" }}>
            {shelves.map((row, r) => (
              <div key={r} className="relative mb-8">
                <div className="flex items-end gap-2 px-4">
                  {row.map((book, i) => (
                    <Link
                      key={book.id}
                      href={`/book/${book.id}`}
                      aria-label={`${book.title} by ${book.author}`}
                      className="group relative block flex-1 focus:outline-none"
                      style={{ transformStyle: "preserve-3d" }}
                    >
                      <Cover
                        book={book}
                        sizes="110px"
                        className={`aspect-[2/3] w-full shadow-[0_24px_36px_-20px_rgba(20,27,45,0.7)] transition-transform duration-500 group-hover:-translate-y-4 group-focus-visible:-translate-y-4 group-focus-visible:ring-2 group-focus-visible:ring-[var(--accent)] ${
                          (i + r) % 2 ? "rotate-[1.5deg]" : "-rotate-[1deg]"
                        }`}
                      />
                    </Link>
                  ))}
                </div>
                <div
                  className="h-4 rounded-sm"
                  style={{
                    background: "linear-gradient(180deg,#2a3654,#141b2d)",
                    boxShadow: "inset 0 2px 0 rgba(232,162,58,0.7), 0 22px 30px -18px rgba(20,27,45,0.7)",
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      </Parallax>

      <div className="order-1 lg:order-2">
        <Eyebrow index={6}>Begin</Eyebrow>
        <SlideTitle>
          Begin your <span className="text-gold-gradient italic">reading journey.</span>
        </SlideTitle>
        <Lede>
          Sign in to sync your progress, notes, bookmarks and streak across devices, or keep reading as a guest. All{" "}
          {CATALOG_STATS.books} books are free to read either way.
        </Lede>
        <div className="rh-rise mt-8 flex flex-wrap items-center gap-3" style={{ ["--d" as string]: "240ms" }}>
          <button type="button" onClick={onAuth} className={secondaryBtn}>
            Log in
          </button>
          <button type="button" onClick={onAuth} className={primaryBtn}>
            Create account
          </button>
        </div>
        <p className="rh-rise mt-3 text-xs text-[var(--text-secondary)]" style={{ ["--d" as string]: "300ms" }}>
          Both continue with Google sign-in. New readers get an account automatically.
        </p>
        <div className="rh-rise mt-8 flex flex-wrap items-center gap-5 text-sm" style={{ ["--d" as string]: "360ms" }}>
          <Link href="/library" className="font-semibold text-[var(--accent)] underline-offset-4 hover:underline">
            Continue as a guest →
          </Link>
          <button
            type="button"
            onClick={onReplay}
            className="cursor-pointer font-semibold text-[var(--text-secondary)] underline-offset-4 hover:text-[var(--foreground)] hover:underline"
          >
            ↑ Back to the top
          </button>
        </div>
      </div>
    </div>
  );
}
