"use client";

import React from "react";
import Image from "next/image";
import Link from "next/link";
import { Book, BOOKS } from "@/data/books";

export interface SlideProps {
  active: boolean;
  reducedMotion: boolean;
  onNext: () => void;
  onAuth: () => void;
  onReplay: () => void;
}

const byId = (id: string) => BOOKS.find((b) => b.id === id);

/** Real catalog books with clean cover paths, used across the slides. */
export function pickBooks(ids: string[]): Book[] {
  return ids.map(byId).filter((b): b is Book => Boolean(b));
}

export const FEATURED_BOOK: Book = byId("1984") ?? BOOKS[0];

export const CATALOG_STATS = {
  books: BOOKS.length,
  categories: new Set(BOOKS.map((b) => b.category)).size,
  languages: new Set(BOOKS.map((b) => b.language)).size,
};

export function Cover({
  book,
  sizes,
  className = "",
  href,
  tabIndex,
}: {
  book: Book;
  sizes: string;
  className?: string;
  href?: string;
  tabIndex?: number;
}) {
  const img = <Image src={book.cover} alt={book.title} fill sizes={sizes} className="object-cover" draggable={false} />;
  const base = `relative block overflow-hidden rounded-[6px] bg-[var(--secondary)] ${className}`;
  if (href) {
    return (
      <Link href={href} className={base} tabIndex={tabIndex} aria-label={`${book.title} by ${book.author}`}>
        {img}
      </Link>
    );
  }
  return <div className={base}>{img}</div>;
}

export function Eyebrow({ index, children }: { index: number; children: React.ReactNode }) {
  return (
    <div className="rh-rise flex items-center gap-3 text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--accent)]">
      <span className="font-mono">{String(index).padStart(2, "0")}</span>
      <span className="h-px w-8 bg-[var(--accent)]/50" />
      <span>{children}</span>
    </div>
  );
}

export function SlideTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="rh-rise mt-4 font-serif font-bold tracking-tight text-[var(--foreground)] text-[clamp(2rem,4.2vw,3.6rem)] leading-[1.05]"
      style={{ ["--d" as string]: "80ms" }}
    >
      {children}
    </h2>
  );
}

export function Lede({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="rh-rise mt-4 max-w-xl text-sm sm:text-base leading-relaxed text-[var(--text-secondary)]"
      style={{ ["--d" as string]: "160ms" }}
    >
      {children}
    </p>
  );
}

export function IllustrativeTag({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--card)]/85 px-2.5 py-1 text-[10px] font-medium text-[var(--text-secondary)] backdrop-blur ${className}`}
    >
      Illustrative example
    </span>
  );
}

/** Wrapper that shifts its children with the pointer (CSS vars --px/--py are set on the landing root). */
export function Parallax({
  depth,
  className = "",
  style,
  children,
}: {
  depth: number;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <div
      className={className}
      style={{
        ...style,
        // `translate` composes with transform-based animations on the same element (e.g. .rh-rise)
        translate: `calc(var(--px, 0) * ${depth}px) calc(var(--py, 0) * ${depth * 0.7}px)`,
        transition: "translate 450ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      {children}
    </div>
  );
}

/** Paper page with ruled "text" lines (deterministic widths, no randomness during render). */
export function PageLines({ count, seed = 0, tone }: { count: number; seed?: number; tone?: string }) {
  const widths = [94, 86, 97, 72, 90, 83, 96, 64, 88, 79, 92, 70];
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="mb-[6%] h-[4px] rounded-full sm:h-[5px]"
          style={{
            width: `${widths[(i + seed) % widths.length]}%`,
            background: tone || "color-mix(in srgb, var(--foreground) 13%, transparent)",
          }}
        />
      ))}
    </>
  );
}

export const primaryBtn =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[var(--primary)] to-[var(--accent-secondary)] px-6 py-3 text-sm font-bold text-[var(--primary-foreground)] shadow-[0_14px_30px_-14px_rgba(180,83,9,0.65)] transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_36px_-14px_rgba(180,83,9,0.75)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)] cursor-pointer";

export const secondaryBtn =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-6 py-3 text-sm font-semibold text-[var(--foreground)] shadow-sm transition-all hover:-translate-y-0.5 hover:border-[var(--accent)]/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] cursor-pointer";
