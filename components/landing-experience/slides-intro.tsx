"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { getBooksByCategory } from "@/data/books";
import {
  CATALOG_STATS,
  Cover,
  Eyebrow,
  FEATURED_BOOK,
  IllustrativeTag,
  Lede,
  PageLines,
  Parallax,
  SlideProps,
  SlideTitle,
  pickBooks,
  primaryBtn,
  secondaryBtn,
} from "./shared";

// ---------------------------------------------------------------------------
// 01 — Welcome
// ---------------------------------------------------------------------------

const HERO_BOOKS = pickBooks(["godan", "the-great-gatsby", "madhushala", "pride-and-prejudice", "crime-and-punishment", "kamayani"]);

const FLOATING_SLOTS = [
  { left: "2%", top: "8%", rot: -9, w: "w-[70px] sm:w-[92px]", delay: "0s", depth: 26, mobile: true },
  { left: "78%", top: "2%", rot: 8, w: "w-[64px] sm:w-[84px]", delay: "-2s", depth: 34, mobile: true },
  { left: "86%", top: "58%", rot: -6, w: "w-[70px] sm:w-[96px]", delay: "-4s", depth: 22, mobile: false },
  { left: "-2%", top: "64%", rot: 7, w: "w-[64px] sm:w-[86px]", delay: "-1s", depth: 30, mobile: false },
  { left: "44%", top: "-6%", rot: -3, w: "w-[56px] sm:w-[70px]", delay: "-3s", depth: 40, mobile: false },
  { left: "40%", top: "84%", rot: 5, w: "w-[56px] sm:w-[72px]", delay: "-5s", depth: 18, mobile: false },
];

const PARTICLES = Array.from({ length: 16 }, (_, i) => ({
  left: `${(i * 37) % 100}%`,
  top: `${55 + ((i * 23) % 40)}%`,
  size: 3 + (i % 3),
  dur: `${8 + (i % 5) * 1.6}s`,
  delay: `${-(i * 0.9)}s`,
  dx: `${((i % 7) - 3) * 12}px`,
}));

export function WelcomeSlide({ active, onNext }: SlideProps) {
  const [turns, setTurns] = useState(0);
  const [turning, setTurning] = useState(false);

  const turnPage = () => {
    if (turning) return;
    setTurning(true);
    setTurns((t) => t + 1);
  };

  return (
    <div className="mx-auto grid min-h-full max-w-7xl grid-cols-1 items-center gap-10 px-5 pb-28 pt-24 sm:px-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-6 lg:pt-20">
      <div className="relative z-10 max-w-xl">
        <div className="rh-rise inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)]/80 px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--accent)] shadow-sm backdrop-blur">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-glow)]" />
          Reader&apos;s HUB · Free digital library
        </div>
        <h1
          className="rh-rise mt-6 font-serif font-bold tracking-tight text-[var(--foreground)] text-[clamp(2.6rem,6vw,5.2rem)] leading-[0.98]"
          style={{ ["--d" as string]: "90ms" }}
        >
          Your Next <span className="text-gold-gradient italic">Great Read</span> Starts Here.
        </h1>
        <Lede>
          {CATALOG_STATS.books} books across {CATALOG_STATS.categories} categories, from world classics and Hindi literature to
          philosophy and technical notes. Open any of them in your browser and start reading.
        </Lede>
        <div className="rh-rise mt-8 flex flex-wrap items-center gap-3" style={{ ["--d" as string]: "240ms" }}>
          <Link href="/library" className={primaryBtn}>
            Start Reading
            <span aria-hidden="true">→</span>
          </Link>
          <button type="button" onClick={onNext} className={secondaryBtn}>
            Explore the experience
          </button>
        </div>
        <dl className="rh-rise mt-10 grid max-w-md grid-cols-3 gap-4 border-t border-[var(--border)] pt-6" style={{ ["--d" as string]: "320ms" }}>
          {[
            [CATALOG_STATS.books, "Books"],
            [CATALOG_STATS.categories, "Categories"],
            [CATALOG_STATS.languages, "Languages"],
          ].map(([value, label]) => (
            <div key={label as string}>
              <dt className="text-[11px] uppercase tracking-wider text-[var(--text-secondary)]">{label}</dt>
              <dd className="mt-1 font-serif text-2xl font-bold text-[var(--foreground)] sm:text-3xl">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* 3D scene */}
      <div className="relative mx-auto aspect-square w-full max-w-[560px]" style={{ perspective: "1400px" }}>
        {PARTICLES.map((p, i) => (
          <span
            key={i}
            aria-hidden="true"
            className="rh-particle absolute rounded-full bg-[var(--accent-glow)]"
            style={{
              left: p.left,
              top: p.top,
              width: p.size,
              height: p.size,
              opacity: 0,
              ["--dur" as string]: p.dur,
              ["--delay" as string]: p.delay,
              ["--dx" as string]: p.dx,
            }}
          />
        ))}

        {/* Floating covers */}
        {FLOATING_SLOTS.map((slot, i) => {
          const book = HERO_BOOKS[i % HERO_BOOKS.length];
          return (
            <Parallax
              key={slot.left + slot.top}
              depth={slot.depth}
              className={`absolute z-20 ${slot.mobile ? "" : "hidden sm:block"}`}
              style={{ left: slot.left, top: slot.top }}
            >
              <div className="rh-float" style={{ ["--rot" as string]: `${slot.rot}deg`, animationDelay: slot.delay }}>
                <Cover
                  book={book}
                  href={`/book/${book.id}`}
                  tabIndex={active ? 0 : -1}
                  sizes="96px"
                  className={`${slot.w} aspect-[2/3] shadow-[0_22px_40px_-18px_rgba(20,27,45,0.55)] ring-1 ring-black/5 transition-transform duration-300 hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]`}
                />
              </div>
            </Parallax>
          );
        })}

        {/* Open book */}
        <Parallax depth={12} className="absolute inset-0 z-10 flex items-center justify-center">
          <button
            type="button"
            onClick={turnPage}
            tabIndex={active ? 0 : -1}
            aria-label={`Turn a page of ${FEATURED_BOOK.title}`}
            className="group relative w-[78%] cursor-pointer focus:outline-none"
            style={{ transformStyle: "preserve-3d", transform: "rotateX(24deg) rotateZ(-5deg)" }}
          >
            {/* Hard cover */}
            <div
              className="absolute -inset-[3%] rounded-[10px]"
              style={{
                transform: "translateZ(-14px)",
                background: "linear-gradient(140deg, #1d2a44, #141b2d 60%, #0e1424)",
                boxShadow: "0 50px 80px -30px rgba(20,27,45,0.55), inset 0 0 0 2px rgba(232,162,58,0.55)",
              }}
            />
            <div className="relative flex aspect-[1.55] overflow-visible rounded-[4px]" style={{ transformStyle: "preserve-3d" }}>
              <div
                className="relative flex-1 rounded-l-[4px] p-[7%] text-left"
                style={{ background: "linear-gradient(90deg, #fffdf8 78%, #ece3d0)" }}
              >
                <div className="truncate font-serif text-[10px] font-bold text-[#141b2d] sm:text-sm">{FEATURED_BOOK.title}</div>
                <div className="mb-[8%] truncate text-[8px] text-[#566074] sm:text-[11px]">{FEATURED_BOOK.author}</div>
                <PageLines count={7} />
              </div>
              <div
                className="relative flex-1 rounded-r-[4px] p-[7%]"
                style={{ background: "linear-gradient(270deg, #fffdf8 78%, #ece3d0)" }}
              >
                <PageLines count={9} seed={3} />
                {turning && (
                  <div
                    key={turns}
                    className="rh-page-turn absolute inset-0 rounded-r-[4px] p-[7%]"
                    style={{ background: "linear-gradient(270deg, #fffdf8 70%, #e7dcc6)", backfaceVisibility: "hidden" }}
                    onAnimationEnd={() => setTurning(false)}
                  >
                    <PageLines count={9} seed={turns} />
                  </div>
                )}
              </div>
              <div className="pointer-events-none absolute inset-y-0 left-1/2 w-6 -translate-x-1/2 bg-gradient-to-r from-transparent via-black/10 to-transparent" />
            </div>
            <span className="absolute -bottom-10 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-[var(--card)]/90 px-3 py-1 text-[11px] font-semibold text-[var(--text-secondary)] opacity-80 shadow-sm transition-opacity group-hover:opacity-100">
              Tap the book to turn a page
            </span>
          </button>
        </Parallax>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 02 — Discover
// ---------------------------------------------------------------------------

const DISCOVER_CATEGORIES = [
  "Philosophy & Spirituality",
  "Hindi Literature",
  "Classics & Literature",
  "Psychology & Self-Development",
  "Science & Physics",
  "Technical Knowledge",
] as const;

export function DiscoverSlide({ active }: SlideProps) {
  const [category, setCategory] = useState<(typeof DISCOVER_CATEGORIES)[number]>("Hindi Literature");

  const counts = useMemo(
    () => Object.fromEntries(DISCOVER_CATEGORIES.map((c) => [c, getBooksByCategory(c).length])),
    []
  );
  const books = useMemo(() => getBooksByCategory(category).slice(0, 6), [category]);

  return (
    <div className="mx-auto flex min-h-full max-w-7xl flex-col justify-center px-5 pb-28 pt-24 sm:px-8 lg:pt-20">
      <div className="grid grid-cols-1 items-end gap-6 lg:grid-cols-2">
        <div>
          <Eyebrow index={2}>The library</Eyebrow>
          <SlideTitle>
            Discover your <span className="text-gold-gradient italic">next book.</span>
          </SlideTitle>
        </div>
        <Lede>
          Browse by category, philosophical tradition or technical track, or search the whole catalog by title, author and tag.
          Every cover below is a real book you can open right now.
        </Lede>
      </div>

      <div
        className="rh-rise -mx-5 mt-8 flex gap-2 overflow-x-auto px-5 pb-2 sm:mx-0 sm:flex-wrap sm:px-0"
        style={{ ["--d" as string]: "200ms" }}
        role="tablist"
        aria-label="Book categories"
      >
        {DISCOVER_CATEGORIES.map((c) => {
          const selected = c === category;
          return (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={active ? 0 : -1}
              onClick={() => setCategory(c)}
              className={`shrink-0 cursor-pointer rounded-full border px-4 py-2 text-xs font-semibold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                selected
                  ? "border-transparent bg-[#141b2d] text-[#f7f4ec] shadow-md"
                  : "border-[var(--border)] bg-[var(--card)] text-[var(--text-secondary)] hover:border-[var(--accent)]/50 hover:text-[var(--foreground)]"
              }`}
            >
              {c}
              <span className={`ml-2 font-mono ${selected ? "text-[var(--accent-glow)]" : "text-[var(--accent)]"}`}>{counts[c]}</span>
            </button>
          );
        })}
      </div>

      {/* Floating 3D book cards */}
      <div className="mt-10" style={{ perspective: "1600px" }}>
        <div key={category} className="grid grid-cols-3 gap-3 sm:gap-5 md:grid-cols-6">
          {books.map((book, i) => {
            const offset = i - (books.length - 1) / 2;
            return (
              <Parallax key={book.id} depth={10 + Math.abs(offset) * 4}>
                <Link
                  href={`/book/${book.id}`}
                  tabIndex={active ? 0 : -1}
                  className="rh-card-in group block focus:outline-none"
                  style={{ ["--d" as string]: `${i * 70}ms`, ["--tilt" as string]: `${offset * -6}deg` }}
                >
                  <div className="rh-card relative rounded-lg transition-transform duration-500">
                    <Cover
                      book={book}
                      sizes="(max-width: 768px) 30vw, 180px"
                      className="aspect-[2/3] w-full shadow-[0_26px_44px_-22px_rgba(20,27,45,0.6)] ring-1 ring-black/5 group-focus-visible:ring-2 group-focus-visible:ring-[var(--accent)]"
                    />
                    <div className="pointer-events-none absolute inset-0 rounded-[6px] bg-gradient-to-tr from-transparent via-white/0 to-white/25 opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
                  </div>
                  <div className="mt-3 min-w-0">
                    <div className="truncate font-serif text-xs font-bold text-[var(--foreground)] sm:text-sm">{book.title}</div>
                    <div className="truncate text-[10px] text-[var(--text-secondary)] sm:text-xs">
                      {book.author} · {book.language}
                    </div>
                  </div>
                </Link>
              </Parallax>
            );
          })}
        </div>
      </div>

      <div className="rh-rise mt-8" style={{ ["--d" as string]: "320ms" }}>
        <Link
          href={`/library?category=${encodeURIComponent(category)}`}
          tabIndex={active ? 0 : -1}
          className="text-sm font-semibold text-[var(--accent)] underline-offset-4 hover:underline"
        >
          Browse all {counts[category]} {category} books →
        </Link>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 03 — Reading experience
// ---------------------------------------------------------------------------

type ReadingMode = "default" | "sepia" | "dark" | "dim";

const MODE_STYLES: Record<ReadingMode, { page: string; edge: string; line: string; label: string }> = {
  default: { page: "#fffdf8", edge: "#ece3d0", line: "rgba(20,27,45,0.14)", label: "Default" },
  sepia: { page: "#f4ead5", edge: "#e2d2b0", line: "rgba(92,64,30,0.22)", label: "Sepia" },
  dark: { page: "#20242f", edge: "#151821", line: "rgba(240,236,226,0.2)", label: "Dark" },
  dim: { page: "#d8d2c4", edge: "#c4bca9", line: "rgba(20,27,45,0.18)", label: "Dim" },
};

const READER_FEATURES = [
  "Single or two-page spreads",
  "Default, sepia, dark and dim reading modes",
  "Zoom, focus mode and fullscreen",
  "Search inside the book",
  "Chapters from the PDF's own outline",
  "Your page is saved as you read",
];

export function ReaderSlide({ active }: SlideProps) {
  const [layout, setLayout] = useState<"double" | "single">("double");
  const [mode, setMode] = useState<ReadingMode>("default");
  const [zoom, setZoom] = useState(100);
  const [page, setPage] = useState(42);
  const [turnKey, setTurnKey] = useState(0);
  const [turning, setTurning] = useState(false);
  const totalPages = Number(FEATURED_BOOK.pages) || 300;
  const style = MODE_STYLES[mode];
  const step = layout === "double" ? 2 : 1;

  const turn = () => {
    if (turning || page + step > totalPages) return;
    setTurning(true);
    setTurnKey((k) => k + 1);
  };

  const control = (selected: boolean) =>
    `cursor-pointer rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
      selected ? "bg-[#141b2d] text-[#f7f4ec]" : "text-[var(--text-secondary)] hover:text-[var(--foreground)]"
    }`;

  return (
    <div className="mx-auto grid min-h-full max-w-7xl grid-cols-1 items-center gap-10 px-5 pb-28 pt-24 sm:px-8 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)] lg:pt-20">
      <div>
        <Eyebrow index={3}>The reader</Eyebrow>
        <SlideTitle>
          Your personal <span className="text-gold-gradient italic">reading room.</span>
        </SlideTitle>
        <Lede>Every book opens in a focused PDF reader that adapts to the way you like to read. Try the controls.</Lede>
        <ul className="rh-rise mt-6 space-y-2.5" style={{ ["--d" as string]: "240ms" }}>
          {READER_FEATURES.map((f) => (
            <li key={f} className="flex items-start gap-3 text-sm text-[var(--foreground)]">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rotate-45 bg-[var(--accent-glow)]" aria-hidden="true" />
              {f}
            </li>
          ))}
        </ul>
      </div>

      {/* Reader window mock */}
      <Parallax depth={10}>
        <div
          className="rh-rise overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-[0_50px_90px_-40px_rgba(20,27,45,0.5)]"
          style={{ ["--d" as string]: "120ms" }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-2.5">
            <div className="min-w-0">
              <div className="truncate font-serif text-sm font-bold text-[var(--foreground)]">{FEATURED_BOOK.title}</div>
              <div className="font-mono text-[10px] text-[var(--text-secondary)]">
                p. {page}
                {layout === "double" ? `–${Math.min(page + 1, totalPages)}` : ""} of {totalPages}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-lg border border-[var(--border)] bg-[var(--background)] p-0.5" role="group" aria-label="Page layout">
                <button type="button" tabIndex={active ? 0 : -1} className={control(layout === "single")} onClick={() => setLayout("single")}>
                  Single
                </button>
                <button type="button" tabIndex={active ? 0 : -1} className={control(layout === "double")} onClick={() => setLayout("double")}>
                  Spread
                </button>
              </div>
              <div className="flex rounded-lg border border-[var(--border)] bg-[var(--background)] p-0.5" role="group" aria-label="Reading mode">
                {(Object.keys(MODE_STYLES) as ReadingMode[]).map((m) => (
                  <button key={m} type="button" tabIndex={active ? 0 : -1} className={control(mode === m)} onClick={() => setMode(m)}>
                    {MODE_STYLES[m].label}
                  </button>
                ))}
              </div>
              <div className="flex items-center rounded-lg border border-[var(--border)] bg-[var(--background)] p-0.5" role="group" aria-label="Zoom">
                <button type="button" tabIndex={active ? 0 : -1} className={control(false)} onClick={() => setZoom((z) => Math.max(80, z - 10))} aria-label="Zoom out">
                  −
                </button>
                <span className="w-10 text-center font-mono text-[10px] text-[var(--text-secondary)]">{zoom}%</span>
                <button type="button" tabIndex={active ? 0 : -1} className={control(false)} onClick={() => setZoom((z) => Math.min(130, z + 10))} aria-label="Zoom in">
                  +
                </button>
              </div>
            </div>
          </div>

          <div
            className="flex items-center justify-center overflow-hidden px-4 py-8 transition-colors duration-500 sm:py-12"
            style={{ background: mode === "dark" ? "#12151d" : "color-mix(in srgb, var(--secondary) 70%, var(--background))", perspective: "1500px" }}
          >
            <button
              type="button"
              tabIndex={active ? 0 : -1}
              onClick={turn}
              aria-label="Turn page"
              className="relative flex cursor-pointer focus:outline-none"
              style={{
                width: layout === "double" ? "min(92%, 520px)" : "min(56%, 280px)",
                transform: `scale(${zoom / 100}) rotateX(8deg)`,
                transformStyle: "preserve-3d",
                transition: "width 600ms cubic-bezier(0.22,1,0.36,1), transform 400ms ease",
              }}
            >
              {(layout === "double" ? [0, 1] : [1]).map((side) => (
                <div
                  key={side}
                  className="relative aspect-[0.72] flex-1 p-[8%] transition-colors duration-500"
                  style={{
                    background:
                      side === 0
                        ? `linear-gradient(90deg, ${style.page} 82%, ${style.edge})`
                        : `linear-gradient(270deg, ${style.page} 82%, ${style.edge})`,
                    boxShadow: "0 30px 50px -28px rgba(20,27,45,0.6)",
                    transformStyle: "preserve-3d",
                  }}
                >
                  <PageLines count={15} seed={page + side} tone={style.line} />
                  <div className="absolute bottom-[4%] left-0 right-0 text-center font-mono text-[8px]" style={{ color: style.line }}>
                    {layout === "double" ? page + side : page}
                  </div>
                  {side === 1 && turning && (
                    <div
                      key={turnKey}
                      className="rh-page-turn absolute inset-0 p-[8%]"
                      style={{ background: `linear-gradient(270deg, ${style.page} 75%, ${style.edge})`, backfaceVisibility: "hidden" }}
                      onAnimationEnd={() => {
                        setTurning(false);
                        setPage((p) => Math.min(totalPages, p + step));
                      }}
                    >
                      <PageLines count={15} seed={page + 1} tone={style.line} />
                    </div>
                  )}
                </div>
              ))}
            </button>
          </div>
          <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-2.5 text-[11px] text-[var(--text-secondary)]">
            <span>Click the page to turn it</span>
            <IllustrativeTag />
          </div>
        </div>
      </Parallax>
    </div>
  );
}
