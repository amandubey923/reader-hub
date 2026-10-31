"use client";

import React, { memo } from "react";
import Link from "next/link";
import Image from "next/image";
import { Book } from "@/data/books";
import { useLibrary } from "@/context/LibraryContext";
import CardTilt from "./visual/CardTilt";
import Highlight from "./search/Highlight";

interface BookCardFavoriteButtonProps {
  bookId: string;
  bookTitle: string;
  isFavorited?: boolean;
  onToggleFavorite?: (bookId: string) => void;
}

const BookCardFavoriteButton = memo(function BookCardFavoriteButton({
  bookId,
  bookTitle,
  isFavorited,
  onToggleFavorite,
}: BookCardFavoriteButtonProps) {
  const library = useLibrary();
  const favorited = isFavorited !== undefined ? isFavorited : library.isFavorite(bookId);
  const toggle = onToggleFavorite || library.toggleFavorite;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle(bookId);
      }}
      className={`p-1 sm:p-1.5 rounded-full border transition-all cursor-pointer shrink-0 ${
        favorited
          ? "bg-rose-500/20 text-rose-400 border-rose-500/40 shadow-[0_0_10px_rgba(244,63,94,0.3)]"
          : "bg-[var(--card)] text-[var(--text-secondary)] border-[var(--border)] hover:text-[var(--foreground)] hover:border-[var(--accent)]/50"
      }`}
      aria-label={favorited ? `Remove ${bookTitle} from favorites` : `Add ${bookTitle} to favorites`}
    >
      <svg
        className="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-current transition-transform active:scale-125"
        viewBox="0 0 24 24"
      >
        {favorited ? (
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
        ) : (
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
          />
        )}
      </svg>
    </button>
  );
});

export interface BookCardProps {
  book: Book;
  compact?: boolean;
  onDismiss?: () => void;
  dismissAriaLabel?: string;
  isFavorited?: boolean;
  onToggleFavorite?: (bookId: string) => void;
  /** Search tokens to highlight in the title and author (optional). */
  highlightTokens?: string[];
  /** Short explanation shown under the card, e.g. why it is recommended (optional). */
  reason?: string;
}

function BookCardComponent({
  book,
  compact = false,
  onDismiss,
  dismissAriaLabel,
  isFavorited,
  onToggleFavorite,
  highlightTokens,
  reason,
}: BookCardProps) {
  return (
    <CardTilt className="h-full">
      <article className="group relative flex flex-col h-full glass-card rounded-xl sm:rounded-2xl p-2.5 sm:p-4 glass-card-hover overflow-hidden transition-all duration-300 border border-[var(--border)] hover:border-[var(--accent)]/50 hover:shadow-2xl [content-visibility:auto] [contain-intrinsic-size:280px_420px]">
        {/* Subtle Light Sweep Gradient on Hover */}
        <div
          className="absolute -inset-full bg-gradient-to-r from-transparent via-[var(--accent)]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none group-hover:translate-x-full ease-in-out"
          style={{ transitionDuration: "1000ms" }}
        />

        {/* Category Pill & Favorite / Dismiss Button Bar */}
        <div className="flex items-center justify-between gap-1 sm:gap-2 mb-2 sm:mb-3 relative z-10">
          <div className="flex items-center gap-1 sm:gap-1.5 min-w-0 flex-1">
            <span className="text-[8.5px] sm:text-[10px] font-bold uppercase tracking-wider px-1.5 sm:px-2 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20 truncate">
              {book.category}
            </span>
            {book.resourceType && book.resourceType !== "Book" && (
              <span className="text-[8px] sm:text-[9px] font-bold uppercase tracking-wider px-1 sm:px-1.5 py-0.5 rounded-full bg-[var(--primary)]/15 text-[var(--primary)] border border-[var(--primary)]/30 shrink-0">
                {book.resourceType === "HandwrittenNotes"
                  ? "Handwritten"
                  : book.resourceType === "InterviewPrep"
                  ? "Interview"
                  : book.resourceType === "CheatSheet"
                  ? "Cheat Sheet"
                  : book.resourceType}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {onDismiss && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onDismiss();
                }}
                className="w-5.5 h-5.5 sm:w-6 sm:h-6 rounded-full bg-[var(--card)]/80 hover:bg-rose-500/20 text-[var(--text-secondary)] hover:text-rose-400 border border-[var(--border)] hover:border-rose-500/40 flex items-center justify-center text-xs sm:text-sm font-bold transition-all cursor-pointer shadow-xs focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                aria-label={dismissAriaLabel || `Remove ${book.title} from shelf`}
                title="Remove from shelf view"
              >
                ×
              </button>
            )}
            <BookCardFavoriteButton
              bookId={book.id}
              bookTitle={book.title}
              isFavorited={isFavorited}
              onToggleFavorite={onToggleFavorite}
            />
          </div>
        </div>

        {/* Book Cover Container */}
        <Link
          href={`/book/${book.id}`}
          className="relative w-full aspect-[2/3] rounded-lg sm:rounded-xl overflow-hidden mb-2.5 sm:mb-3.5 book-shadow bg-[var(--background)] block group/cover"
        >
          <Image
            src={book.cover}
            alt={`Cover of ${book.title}`}
            fill
            loading="lazy"
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 23vw"
            className="object-contain transition-transform duration-500 ease-out"
          />

          {/* Quick Read Overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent opacity-0 group-hover/cover:opacity-100 transition-opacity duration-300 flex items-end p-2 sm:p-3">
            <span className="w-full py-2 sm:py-2.5 rounded-lg sm:rounded-xl bg-gradient-to-r from-[var(--primary)] to-[var(--accent)] text-[var(--primary-foreground)] text-center text-xs sm:text-[13px] font-extrabold shadow-xl flex items-center justify-center gap-1.5 hover:scale-[1.02] transition-transform">
              <span>Read Now</span>
              <span>→</span>
            </span>
          </div>
        </Link>

        {/* Book Details */}
        <div className="flex-1 flex flex-col justify-between relative z-10">
          <div>
            <Link
              href={`/book/${book.id}`}
              className="block group/title"
            >
              <h3 className="font-serif font-black text-[13px] sm:text-[16px] text-[var(--foreground)] group-hover/title:text-[var(--accent)] transition-colors line-clamp-1 leading-snug">
                {highlightTokens?.length ? <Highlight text={book.title} tokens={highlightTokens} /> : book.title}
              </h3>
            </Link>
            <p className="text-[11px] sm:text-xs text-[var(--text-secondary)] font-semibold mt-1 line-clamp-1">
              by{" "}
              <span className="text-[var(--foreground)] font-bold">
                {highlightTokens?.length ? <Highlight text={book.author} tokens={highlightTokens} /> : book.author}
              </span>
            </p>
            {reason && (
              <p className="mt-1.5 line-clamp-2 text-[10px] sm:text-[11px] font-medium leading-snug text-[var(--accent)]" title={reason}>
                {reason}
              </p>
            )}

            {!compact && (
              <p className="hidden sm:block text-[12px] text-[var(--text-secondary)] mt-2 line-clamp-2 leading-relaxed font-normal">
                {book.excerpt || book.description}
              </p>
            )}
          </div>

          {/* Meta Bar & CTA */}
          <div className="mt-3 sm:mt-4 pt-2 sm:pt-3 border-t border-[var(--border)] flex items-center justify-between gap-1.5 flex-nowrap">
            <div className="flex items-center gap-1 text-[11px] sm:text-xs text-[var(--accent)] font-bold truncate">
              <span>★</span>
              <span className="text-[var(--foreground)] font-extrabold">{book.rating.toFixed(1)}</span>
              <span className="text-[var(--text-secondary)] font-medium text-[10px] sm:text-[11px]">({book.year})</span>
            </div>

            <Link
              href={`/book/${book.id}`}
              className="px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-lg sm:rounded-xl bg-gradient-to-r from-[var(--primary)] to-[var(--accent)] hover:opacity-95 text-[var(--primary-foreground)] font-bold text-[11px] sm:text-xs transition-all shadow-sm hover:shadow-md hover:scale-105 shrink-0 flex items-center gap-1"
            >
              <span>Read</span>
              <span>↗</span>
            </Link>
          </div>
        </div>
      </article>
    </CardTilt>
  );
}

const BookCard = memo(BookCardComponent);
export default BookCard;
