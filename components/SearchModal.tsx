"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { BOOKS } from "@/data/books";
import { useLibrary } from "@/context/LibraryContext";
import { FIELD_LABELS, getSearchSuggestions, searchCatalog } from "@/lib/search/catalog-search";
import Highlight from "./search/Highlight";

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const MAX_RESULTS = 8;

export default function SearchModal({ isOpen, onClose }: SearchModalProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mounted, setMounted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { readingHistory, favorites } = useLibrary();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // Find most recently read book
  const lastReadBook = useMemo(() => {
    if (!readingHistory || readingHistory.length === 0) return null;
    const sorted = [...readingHistory].sort((a, b) => (b.lastReadAt || 0) - (a.lastReadAt || 0));
    const last = sorted[0];
    return BOOKS.find((b) => b.id === last.bookId) || null;
  }, [readingHistory]);

  // Quick Command Palette actions
  const quickActions = useMemo(() => {
    const actions = [
      ...(lastReadBook
        ? [
            {
              id: "action-continue",
              title: `Continue Reading: ${lastReadBook.title}`,
              subtitle: `Resume from Page ${readingHistory[0]?.page || 1}`,
              icon: "📖",
              href: `/book/${lastReadBook.id}`,
            },
          ]
        : []),
      {
        id: "action-library",
        title: "Browse Complete Library",
        subtitle: `Explore all ${BOOKS.length} masterworks`,
        icon: "📚",
        href: "/library",
      },
      {
        id: "action-shelf",
        title: "My Shelf & Favorites",
        subtitle: `${favorites.length} saved volumes`,
        icon: "🔖",
        href: "/favorites",
      },
      {
        id: "action-offline",
        title: "Offline Books Manager",
        subtitle: "View cached reading material",
        icon: "📦",
        href: "/favorites?tab=offline",
      },
      {
        id: "action-stats",
        title: "Reading Habits & Diwali Diya",
        subtitle: "Track daily streak & stats",
        icon: "🪔",
        href: "/favorites?tab=stats",
      },
      {
        id: "action-contact",
        title: "Contact & Reader Feedback",
        subtitle: "Send recommendations or feedback to Aman",
        icon: "✉️",
        href: "/contact",
      },
    ];
    return actions;
  }, [lastReadBook, readingHistory, favorites]);

  // Instant suggestions from real authors, categories and topics
  const suggestedKeywords = useMemo(() => getSearchSuggestions(query, 3).map((s) => s.value), [query]);

  // Same ranked, typo-tolerant engine as the library page
  const search = useMemo(() => (query.trim() ? searchCatalog(query) : null), [query]);
  const results = useMemo(() => (search ? search.hits.slice(0, MAX_RESULTS).map((h) => h.book) : BOOKS.slice(0, 6)), [search]);
  const matchedFieldById = useMemo(
    () => new Map((search?.hits || []).slice(0, MAX_RESULTS).map((h) => [h.book.id, h.matchedField])),
    [search]
  );
  const tokens = search?.tokens || [];

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setSelectedIndex(0);
    } else {
      setQuery("");
    }
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Combined navigable items
  const totalNavigableCount = query.trim() === "" ? quickActions.length + results.length : results.length;

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev < totalNavigableCount - 1 ? prev + 1 : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : totalNavigableCount - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (query.trim() === "") {
          if (selectedIndex < quickActions.length) {
            router.push(quickActions[selectedIndex].href);
            onClose();
          } else {
            const bookIdx = selectedIndex - quickActions.length;
            if (results[bookIdx]) {
              router.push(`/book/${results[bookIdx].id}`);
              onClose();
            }
          }
        } else if (results[selectedIndex]) {
          router.push(`/book/${results[selectedIndex].id}`);
          onClose();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, results, selectedIndex, router, onClose, query, quickActions, totalNavigableCount]);

  if (!isOpen || !mounted) return null;

  const modalContent = (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-16 sm:pt-20 px-3 sm:px-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-md transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal Container */}
      <div className="relative w-full max-w-2xl bg-[var(--card)] border border-[var(--border)] rounded-3xl shadow-2xl overflow-hidden z-10 animate-scale-up text-left">
        {/* Search Header */}
        <div className="flex items-center px-4 sm:px-5 py-4 border-b border-[var(--border)] bg-[var(--card)]/90 backdrop-blur-xl">
          <svg
            className="w-5 h-5 text-[var(--accent)] mr-3 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search books, authors, philosophy, Hindi classics or commands..."
            className="w-full bg-transparent text-[var(--foreground)] placeholder-[var(--text-secondary)] text-sm sm:text-base focus:outline-none"
            aria-label="Search books"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="text-[var(--text-secondary)] hover:text-[var(--foreground)] text-xs px-2.5 py-1 rounded-lg bg-[var(--secondary)] cursor-pointer"
            >
              Clear
            </button>
          )}
          <button
            onClick={onClose}
            className="ml-3 text-[var(--text-secondary)] hover:text-[var(--foreground)] text-xs px-2.5 py-1 rounded-lg border border-[var(--border)] cursor-pointer"
          >
            Esc
          </button>
        </div>

        {/* Instant Suggestions Bar */}
        {suggestedKeywords.length > 0 && (
          <div className="px-4 py-2 bg-[var(--secondary)]/60 border-b border-[var(--border)] flex items-center gap-2 text-xs overflow-x-auto">
            <span className="text-[var(--text-secondary)] font-medium">Suggestions:</span>
            {suggestedKeywords.map((s) => (
              <button
                key={s}
                onClick={() => setQuery(s)}
                className="px-2.5 py-0.5 rounded-md bg-[var(--card)] hover:bg-[var(--accent)] hover:text-[var(--primary-foreground)] text-[var(--foreground)] text-[11px] font-semibold transition-all border border-[var(--border)] cursor-pointer"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Results List */}
        <div className="max-h-[60vh] overflow-y-auto p-3 divide-y divide-[var(--border)]/40">
          {/* Quick Actions (when query is empty) */}
          {query.trim() === "" && (
            <div className="pb-3 space-y-1">
              <div className="px-3 py-1 text-[10px] font-bold text-[var(--accent)] uppercase tracking-wider">
                ⚡ Quick Command Navigation
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {quickActions.map((action, actIdx) => {
                  const isSelected = selectedIndex === actIdx;
                  return (
                    <Link
                      key={action.id}
                      href={action.href}
                      onClick={onClose}
                      className={`flex items-center gap-3 p-2.5 rounded-xl border transition-all ${
                        isSelected
                          ? "bg-[var(--accent)]/15 border-[var(--accent)] text-[var(--foreground)] shadow-xs"
                          : "bg-[var(--background)]/70 border-[var(--border)] hover:bg-[var(--secondary)] text-[var(--text-secondary)]"
                      }`}
                    >
                      <span className="text-xl flex-shrink-0">{action.icon}</span>
                      <div className="min-w-0 flex-1">
                        <h5 className="font-semibold text-xs text-[var(--foreground)] truncate">
                          {action.title}
                        </h5>
                        <p className="text-[10px] text-[var(--text-secondary)] truncate">
                          {action.subtitle}
                        </p>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          <div className="px-3 py-1.5 text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider pt-2">
            {!search
              ? "✨ Featured Masterworks"
              : search.partial
              ? `Closest matches (no book matched every word)`
              : `Found ${search.hits.length} Matching Book${search.hits.length === 1 ? "" : "s"}`}
          </div>

          {search?.didYouMean && (
            <div className="px-3 py-2 text-xs text-[var(--foreground)]">
              Did you mean{" "}
              <button type="button" onClick={() => setQuery(search.didYouMean!)} className="font-semibold text-[var(--accent)] hover:underline cursor-pointer">
                “{search.didYouMean}”
              </button>
              ?
            </div>
          )}

          {results.length === 0 ? (
            <div className="text-center py-12 px-4 space-y-3">
              <div className="text-4xl">📖</div>
              <h3 className="text-[var(--foreground)] font-bold font-serif text-base">
                No books found
              </h3>
              <p className="text-[var(--text-secondary)] text-xs max-w-sm mx-auto leading-relaxed">
                We couldn&apos;t find any books matching &quot;{query}&quot;. Try searching for &quot;Osho&quot;, &quot;Premchand&quot;, &quot;Plato&quot;, or &quot;Atomic Habits&quot;.
              </p>
              <button
                onClick={() => setQuery("")}
                className="text-xs text-[var(--accent)] hover:underline font-semibold cursor-pointer"
              >
                Clear Search Query
              </button>
            </div>
          ) : (
            results.map((book, index) => {
              const itemIdx = query.trim() === "" ? quickActions.length + index : index;
              const isSelected = itemIdx === selectedIndex;
              return (
                <Link
                  key={book.id}
                  href={`/book/${book.id}`}
                  onClick={onClose}
                  className={`flex items-center gap-4 p-3 rounded-2xl transition-all ${
                    isSelected
                      ? "bg-[var(--accent)]/15 border border-[var(--accent)] text-[var(--foreground)] shadow-sm"
                      : "hover:bg-[var(--secondary)]/60 text-[var(--text-secondary)]"
                  }`}
                >
                  <div className="relative w-12 h-16 flex-shrink-0 rounded-lg overflow-hidden book-shadow bg-[var(--background)]">
                    <Image
                      src={book.cover}
                      alt={book.title}
                      fill
                      sizes="48px"
                      className="object-cover"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="font-serif font-bold text-sm text-[var(--foreground)] truncate">
                        <Highlight text={book.title} tokens={tokens} />
                      </h4>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--secondary)] text-[var(--accent)] font-semibold border border-[var(--border)]">
                        {book.category}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--text-secondary)] truncate mt-0.5 font-medium">
                      by <Highlight text={book.author} tokens={tokens} /> • {book.year} • {book.language}
                      {matchedFieldById.get(book.id) && !["title", "author"].includes(matchedFieldById.get(book.id)!) && (
                        <> • matched {FIELD_LABELS[matchedFieldById.get(book.id)!]}</>
                      )}
                    </p>
                    <p className="text-[11px] text-[var(--text-secondary)]/80 truncate mt-0.5">
                      {book.excerpt || book.description}
                    </p>
                  </div>
                  <div className="flex items-center text-xs text-[var(--accent)] font-bold px-3 py-1.5 rounded-xl bg-[var(--accent)]/10 border border-[var(--accent)]/20 shadow-xs">
                    Read →
                  </div>
                </Link>
              );
            })
          )}

          {search && search.hits.length > MAX_RESULTS && (
            <Link
              href={`/library?q=${encodeURIComponent(query.trim())}`}
              onClick={onClose}
              className="block px-3 py-3 text-center text-xs font-semibold text-[var(--accent)] hover:underline"
            >
              See all {search.hits.length} results in the library →
            </Link>
          )}
        </div>

        {/* Footer Shortcuts */}
        <div className="px-4 py-2.5 bg-[var(--background)] border-t border-[var(--border)] flex items-center justify-between text-[11px] text-[var(--text-secondary)]">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="px-1.5 py-0.5 bg-[var(--card)] border border-[var(--border)] rounded text-[var(--foreground)] text-[10px]">
                ↑
              </kbd>{" "}
              <kbd className="px-1.5 py-0.5 bg-[var(--card)] border border-[var(--border)] rounded text-[var(--foreground)] text-[10px]">
                ↓
              </kbd>{" "}
              navigate
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 bg-[var(--card)] border border-[var(--border)] rounded text-[var(--foreground)] text-[10px]">
                Enter
              </kbd>{" "}
              open
            </span>
          </div>
          <span>Reader&apos;s HUB Command Palette 2.0</span>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
