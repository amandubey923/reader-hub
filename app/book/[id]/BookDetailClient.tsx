"use client";

import React, { useEffect, useRef, useState, useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import { Book, BOOKS } from "@/data/books";
import { useLibrary } from "@/context/LibraryContext";
import dynamic from "next/dynamic";
import BookCard from "@/components/BookCard";
import AddToCollectionModal from "@/components/collections/AddToCollectionModal";
import BookReflectionModal from "@/components/reader/BookReflectionModal";
import { getRelatedBooks } from "@/lib/recommendations";
import { getBookAnnotations } from "@/lib/reader-storage";
import type { AffiliateLinkInfo } from "@/lib/affiliate-config";
import AdPlaceholder from "@/components/monetization/AdPlaceholder";
import { getFirebaseDb, db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";

const PdfReader = dynamic(() => import("@/components/PdfReader"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[780px] rounded-3xl border border-[var(--border)] bg-[#0e1017] shadow-2xl flex flex-col items-center justify-center p-8 text-center animate-pulse">
      <div className="w-14 h-14 rounded-2xl bg-[var(--accent)]/15 border border-[var(--accent)]/30 text-3xl flex items-center justify-center text-[var(--accent)] mb-3">
        📖
      </div>
      <h3 className="text-sm font-bold font-serif text-[var(--foreground)]">
        Opening Digital Book...
      </h3>
      <p className="text-xs text-[var(--text-secondary)] mt-1">
        Preparing realistic reading environment
      </p>
    </div>
  ),
});

const BookReadingMemory = dynamic(() => import("@/components/memory/BookReadingMemory"), {
  ssr: false,
});


interface BookDetailClientProps {
  book: Book;
  relatedBooks: Book[];
  // Resolved on the server so the content-rights audit data never ships in the client bundle
  affiliateInfo: AffiliateLinkInfo | null;
}

export default function BookDetailClient({
  book,
  relatedBooks,
  affiliateInfo,
}: BookDetailClientProps) {
  const {
    isFavorite,
    toggleFavorite,
    recordReading,
    getReadingProgress,
    checkOfflineStatus,
    saveBookOffline,
    removeBookOffline,
    showToast,
    getReflection,
  } = useLibrary();

  const favorited = isFavorite(book.id);
  const readerRef = useRef<HTMLDivElement>(null);
  const [isMemoryOpen, setIsMemoryOpen] = useState(false);
  const [isOfflineSaved, setIsOfflineSaved] = useState(false);
  const [isCollectionModalOpen, setIsCollectionModalOpen] = useState(false);
  const [isReflectionModalOpen, setIsReflectionModalOpen] = useState(false);
  const [isBookDeleted, setIsBookDeleted] = useState(false);
  const [metaOverride, setMetaOverride] = useState<{
    title?: string;
    author?: string;
    category?: string;
    description?: string;
  }>({});

  useEffect(() => {
    const currentDb = getFirebaseDb() || db;
    if (!currentDb || !book.id) return;
    const ref = doc(currentDb, "catalog_overrides", book.id);
    getDoc(ref)
      .then((snap) => {
        if (snap.exists()) {
          const d = snap.data();
          if (d.isDeleted) {
            setIsBookDeleted(true);
          }
          if (d.titleOverride || d.authorOverride || d.categoryOverride || d.descriptionOverride) {
            setMetaOverride({
              title: d.titleOverride,
              author: d.authorOverride,
              category: d.categoryOverride,
              description: d.descriptionOverride,
            });
          }
        }
      })
      .catch((err) => {
        console.warn("[BookDetail] Override check note:", err);
      });
  }, [book.id]);

  const progress = getReadingProgress(book.id);
  const annotations = useMemo(() => getBookAnnotations(book.id), [book.id]);
  const userReflection = getReflection(book.id);
  const smartRelatedBooks = useMemo(() => {
    if (relatedBooks && relatedBooks.length > 0) return relatedBooks;
    return getRelatedBooks(book, BOOKS, 4);
  }, [book, relatedBooks]);

  useEffect(() => {
    recordReading(book.id);
    if (book.pdf) {
      checkOfflineStatus(book.id, book.pdf).then(setIsOfflineSaved);
    }
  }, [book.id, book.pdf, recordReading, checkOfflineStatus]);

  const handleScrollToReader = () => {
    readerRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleToggleOffline = async () => {
    if (!book.pdf) return;
    if (isOfflineSaved) {
      await removeBookOffline(book.id, book.pdf);
      setIsOfflineSaved(false);
    } else {
      const ok = await saveBookOffline(book.id, book.pdf);
      if (ok) setIsOfflineSaved(true);
    }
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${book.title} — Reader's HUB`,
          text: `Read "${book.title}" by ${book.author} for free on Reader's HUB!`,
          url: window.location.href,
        });
      } catch {
        // User cancelled
      }
    } else {
      try {
        await navigator.clipboard.writeText(window.location.href);
        showToast("Link copied to clipboard! 📋");
      } catch {
        showToast("Could not copy link");
      }
    }
  };

  // Find other books by the same author if present
  const authorBooks = useMemo(
    () => BOOKS.filter((b) => b.author === book.author && b.id !== book.id).slice(0, 4),
    [book.author, book.id]
  );

  const highlightsCount = annotations.highlights?.length || 0;
  const notesCount = annotations.notes?.length || 0;
  const bookmarksCount = annotations.bookmarks?.length || 0;
  const hasPriorInteractions = Boolean((progress && progress.page > 1) || highlightsCount > 0 || notesCount > 0 || bookmarksCount > 0);

  const displayTitle = metaOverride.title || book.title;
  const displayAuthor = metaOverride.author || book.author;
  const displayCategory = metaOverride.category || book.category;
  const displayDescription = metaOverride.description || book.description;

  if (isBookDeleted) {
    return (
      <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)] pt-24 pb-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-xl mx-auto text-center space-y-6 py-16">
          <div className="w-20 h-20 rounded-3xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-4xl mx-auto shadow-inner">
            📖
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl sm:text-3xl font-bold font-serif text-[var(--foreground)]">
              This title is currently unavailable in Reader Hub.
            </h1>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              The volume &ldquo;{displayTitle}&rdquo; has been removed or temporarily set inactive by administrators. Your reading progress, bookmarks, and notes for this title remain preserved in your personal shelf.
            </p>
          </div>
          <div className="pt-2 flex justify-center gap-3">
            <Link
              href="/library"
              className="py-3 px-6 rounded-xl font-bold text-xs bg-[var(--foreground)] text-[var(--background)] hover:opacity-90 shadow-md transition-all"
            >
              ← Return to Library
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="w-full max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-12 text-left min-w-0 overflow-x-hidden">
      {/* Breadcrumb Bar */}
      <nav className="w-full max-w-full min-w-0 flex items-center gap-2 text-xs text-[var(--text-secondary)] mb-6 sm:mb-8 overflow-x-auto whitespace-nowrap scrollbar-none">
        <Link href="/" className="hover:text-[var(--accent)] transition-colors">
          Home
        </Link>
        <span>/</span>
        <Link href="/library" className="hover:text-[var(--accent)] transition-colors">
          Library
        </Link>
        <span>/</span>
        <Link
          href={`/library?category=${encodeURIComponent(book.category)}`}
          className="hover:text-[var(--accent)] transition-colors"
        >
          {book.category}
        </Link>
        <span>/</span>
        <span className="text-[var(--foreground)] font-semibold truncate">{book.title}</span>
      </nav>

      {/* Book Hero / Overview Card */}
      <div className="w-full glass-card rounded-2xl sm:rounded-3xl p-4 sm:p-10 border border-[var(--border)] bg-[var(--card)] mb-8 sm:mb-12 shadow-2xl relative overflow-hidden min-w-0">
        {/* Soft Ambient Background Glow */}
        <div
          className="absolute -top-24 -right-24 w-80 h-80 rounded-full blur-[100px] opacity-20 pointer-events-none"
          style={{ background: "var(--accent)" }}
        />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8 lg:gap-12 items-start relative z-10">
          {/* Left Column: Book Cover with 3D Depth & Actions */}
          <div className="lg:col-span-4 flex flex-col items-center">
            <div className="relative w-48 sm:w-64 aspect-[2/3] rounded-2xl overflow-hidden book-shadow-lg border border-[var(--border)] bg-[var(--background)] mb-4 sm:mb-6 group">
              <Image
                src={book.cover}
                alt={book.title}
                fill
                priority
                sizes="(max-width: 768px) 200px, 300px"
                className="object-cover group-hover:scale-105 transition-transform duration-500"
              />
            </div>

            {/* Quick Action Buttons Under Cover */}
            <div className="w-full max-w-sm flex flex-col gap-2 sm:gap-2.5">
              <button
                onClick={handleScrollToReader}
                className="w-full py-3 px-4 rounded-xl sm:rounded-2xl bg-gradient-to-r from-[var(--primary)] to-[var(--accent)] text-[var(--primary-foreground)] text-xs sm:text-[13px] font-extrabold text-center shadow-lg hover:shadow-[0_0_20px_var(--theme-glow)] hover:scale-[1.02] transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>Read in Embedded Viewer</span>
                <span>↓</span>
              </button>

              <div className="flex gap-2">
                <button
                  onClick={handleToggleOffline}
                  className={`flex-1 py-2.5 px-3 rounded-xl border text-[11px] sm:text-xs font-bold text-center transition-all flex items-center justify-center gap-1.5 shadow-xs cursor-pointer truncate ${
                    isOfflineSaved
                      ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/35 shadow-xs"
                      : "bg-[var(--secondary)] hover:bg-[var(--secondary)]/80 text-[var(--foreground)] border-[var(--border)] hover:border-[var(--accent)]/40"
                  }`}
                >
                  <span>{isOfflineSaved ? "✓" : "📦"}</span>
                  <span className="truncate">{isOfflineSaved ? "Offline Ready" : "Save Offline"}</span>
                </button>

                <button
                  onClick={() => setIsMemoryOpen(true)}
                  className="flex-1 py-2.5 px-3 rounded-xl bg-[var(--secondary)] hover:bg-[var(--secondary)]/80 text-[var(--foreground)] border border-[var(--border)] hover:border-[var(--accent)]/40 text-[11px] sm:text-xs font-bold text-center transition-all flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
                >
                  <span>🧠</span>
                  <span>Memory</span>
                </button>
              </div>

              <div className="flex gap-2">
                <a
                  href={book.pdf}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 py-2 px-3 rounded-xl bg-[var(--secondary)] hover:bg-[var(--secondary)]/80 text-[var(--text-secondary)] hover:text-[var(--foreground)] border border-[var(--border)] text-[11px] sm:text-xs font-semibold text-center transition-all flex items-center justify-center gap-1 shadow-xs"
                >
                  <span>Open PDF</span>
                  <span>↗</span>
                </a>

                <a
                  href={book.pdf}
                  download={`${book.title.replace(/\s+/g, "_")}.pdf`}
                  className="flex-1 py-2 px-3 rounded-xl bg-[var(--secondary)] hover:bg-[var(--secondary)]/80 text-[var(--text-secondary)] hover:text-[var(--foreground)] border border-[var(--border)] text-[11px] sm:text-xs font-semibold text-center transition-all flex items-center justify-center gap-1 shadow-xs"
                >
                  <span>Download</span>
                  <span>↓</span>
                </a>
              </div>

              {/* Add to Collection & Log Reflection Buttons */}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setIsCollectionModalOpen(true)}
                  className="flex-1 py-2.5 px-3 rounded-xl bg-[var(--secondary)] hover:bg-[var(--secondary)]/80 text-[var(--foreground)] border border-[var(--border)] hover:border-[var(--accent)]/40 text-[11px] sm:text-xs font-bold text-center transition-all flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
                >
                  <span>📚</span>
                  <span>Collection</span>
                </button>

                <button
                  onClick={() => setIsReflectionModalOpen(true)}
                  className="flex-1 py-2.5 px-3 rounded-xl bg-[var(--secondary)] hover:bg-[var(--secondary)]/80 text-[var(--foreground)] border border-[var(--border)] hover:border-[var(--accent)]/40 text-[11px] sm:text-xs font-bold text-center transition-all flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
                >
                  <span>✍️</span>
                  <span>Reflect</span>
                </button>
              </div>
            </div>
          </div>

          {/* Right Column: Book Metadata & Summary */}
          <div className="lg:col-span-8 flex flex-col justify-between">
            <div>
              {/* Category, Rating, and Action Row */}
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-2">
                  <span className="px-3 py-1 rounded-full bg-[var(--accent)]/15 text-[var(--accent)] border border-[var(--accent)]/30 text-[11px] font-extrabold uppercase tracking-wider">
                    {book.category}
                  </span>
                  <span className="text-xs text-[var(--text-secondary)] font-medium">
                    {book.language === "hi" ? "हिंदी" : "English"}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 sm:gap-2">
                  <button
                    onClick={() => toggleFavorite(book.id)}
                    className={`px-3.5 py-1.5 rounded-xl border text-[11px] sm:text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                      favorited
                        ? "bg-rose-500/20 text-rose-400 border-rose-500/40 shadow-[0_0_12px_rgba(244,63,94,0.3)]"
                        : "bg-[var(--card)] text-[var(--text-secondary)] hover:text-[var(--foreground)] border-[var(--border)] hover:border-[var(--accent)]/40 shadow-xs"
                    }`}
                  >
                    <svg
                      className={`w-3.5 h-3.5 ${favorited ? "fill-current text-rose-400" : ""}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
                      />
                    </svg>
                    <span>{favorited ? "Saved to Shelf" : "Add to Shelf"}</span>
                  </button>

                  <button
                    onClick={handleShare}
                    className="p-1 px-3 py-1.5 rounded-xl bg-[var(--card)] text-[var(--text-secondary)] hover:text-[var(--foreground)] border border-[var(--border)] hover:border-[var(--accent)]/40 text-[11px] sm:text-xs font-bold transition-all cursor-pointer flex items-center gap-1 shadow-xs"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                    </svg>
                    <span>Share</span>
                  </button>
                </div>
              </div>

              {/* Title & Author */}
              <h1 className="text-2xl sm:text-4xl lg:text-5xl font-bold font-serif text-[var(--foreground)] tracking-tight">
                {book.title}
              </h1>
              <p className="text-base sm:text-lg text-[var(--accent)] font-medium mt-0.5 sm:mt-1">
                by <span className="text-[var(--foreground)]">{book.author}</span>
              </p>

              {/* Smart Continue Reading Banner (when user has prior interactions) */}
              {hasPriorInteractions && (
                <div className="my-4 sm:my-5 p-3.5 sm:p-4 rounded-2xl bg-gradient-to-r from-[var(--secondary)] to-[var(--accent)]/10 border border-[var(--accent)]/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-fade-in">
                  <div className="flex items-center gap-3">
                    <span className="text-xl sm:text-2xl">🔖</span>
                    <div className="min-w-0">
                      <h4 className="text-xs font-bold text-[var(--foreground)]">
                        Continue from Page {progress?.page || 1}
                      </h4>
                      <p className="text-[10px] sm:text-[11px] text-[var(--text-secondary)] truncate">
                        {progress?.progress || 0}% completed
                        {highlightsCount > 0 && ` • ${highlightsCount} highlights`}
                        {notesCount > 0 && ` • ${notesCount} notes`}
                        {bookmarksCount > 0 && ` • ${bookmarksCount} bookmarks`}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={handleScrollToReader}
                    className="px-3.5 sm:px-4 py-1.5 rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-bold hover:scale-105 transition-transform cursor-pointer whitespace-nowrap self-start sm:self-auto"
                  >
                    Resume Reading →
                  </button>
                </div>
              )}

              {/* Quick Specs Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 my-4 sm:my-6 p-3.5 sm:p-4 rounded-2xl bg-[var(--secondary)] border border-[var(--border)] text-xs">
                <div>
                  <span className="text-[var(--text-secondary)] block font-medium text-[10px] sm:text-xs">Rating</span>
                  <span className="text-[var(--accent)] font-bold text-xs sm:text-sm">★ {book.rating.toFixed(1)} / 5.0</span>
                </div>
                <div>
                  <span className="text-[var(--text-secondary)] block font-medium text-[10px] sm:text-xs">Published</span>
                  <span className="text-[var(--foreground)] font-semibold text-xs sm:text-sm">{book.year}</span>
                </div>
                <div>
                  <span className="text-[var(--text-secondary)] block font-medium text-[10px] sm:text-xs">Pages</span>
                  <span className="text-[var(--foreground)] font-semibold text-xs sm:text-sm">{book.pages}</span>
                </div>
                <div>
                  <span className="text-[var(--text-secondary)] block font-medium text-[10px] sm:text-xs">Access</span>
                  <span className="text-emerald-400 font-bold text-xs sm:text-sm">100% Free</span>
                </div>
              </div>

              {/* Synopsis */}
              <div className="space-y-1.5 sm:space-y-2">
                <h3 className="text-xs sm:text-sm font-semibold uppercase tracking-wider text-[var(--text-secondary)] font-serif">
                  Synopsis
                </h3>
                <p className="text-xs sm:text-sm text-[var(--text-secondary)] leading-relaxed font-normal">
                  {book.description}
                </p>
              </div>

              {/* Excerpt Section */}
              {book.excerpt && (
                <div className="mt-4 sm:mt-6 p-3.5 sm:p-5 rounded-2xl bg-[var(--secondary)]/60 border-l-4 border-[var(--accent)] text-xs sm:text-sm text-[var(--foreground)] italic font-serif leading-relaxed">
                  &ldquo;{book.excerpt}&rdquo;
                </div>
              )}

              {/* Personal Reflection Quote if written */}
              {userReflection && (
                <div className="mt-4 sm:mt-6 p-4 rounded-2xl bg-violet-500/10 border border-violet-500/25 space-y-1.5 animate-fade-in">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-violet-400 uppercase tracking-wider flex items-center gap-1.5">
                      <span>📝</span>
                      <span>Your Reflection &amp; Realization</span>
                    </span>
                    <span className="text-amber-400 font-bold">
                      {"★".repeat(userReflection.rating || 5)}
                    </span>
                  </div>
                  <p className="text-xs sm:text-sm text-[var(--foreground)] italic font-serif leading-relaxed">
                    &ldquo;{userReflection.reflection}&rdquo;
                  </p>
                </div>
              )}

              {/* Physical Copy Affiliate Card (Only for verified eligible titles) */}
              {affiliateInfo && (
                <div className="mt-4 sm:mt-6 p-4 rounded-2xl bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-fade-in">
                  <div className="space-y-0.5 min-w-0">
                    <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                      <span>📦</span>
                      <span>Physical Edition</span>
                    </span>
                    <h4 className="text-xs sm:text-sm font-bold text-[var(--foreground)]">
                      Want a physical printed copy?
                    </h4>
                    <p className="text-[10px] sm:text-[11px] text-[var(--text-secondary)]">
                      {affiliateInfo.disclosure}
                    </p>
                  </div>

                  <a
                    href={affiliateInfo.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="px-4 py-2 rounded-xl bg-[var(--card)] hover:bg-[var(--secondary)] text-[var(--foreground)] border border-amber-500/40 hover:border-amber-500 text-xs font-bold shadow-xs transition-all flex items-center justify-center gap-2 whitespace-nowrap self-start sm:self-auto active:scale-95"
                  >
                    <span>{affiliateInfo.label}</span>
                    <span>↗</span>
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Strict Policy-Compliant Ad Unit Placeholder (renders null when ADS_ENABLED=false) */}
      <AdPlaceholder bookId={book.id} className="max-w-4xl mx-auto" />

      {/* Embedded 3D PDF Book Reader Section */}
      <section ref={readerRef} className="mb-12 sm:mb-16 scroll-mt-20 w-full min-w-0">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 mb-4 sm:mb-6">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold text-[var(--accent)] uppercase tracking-wider mb-1">
              <span>📖</span>
              <span>Interactive Reading View</span>
            </div>
            <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold font-serif text-[var(--foreground)]">
              Read &ldquo;{book.title}&rdquo;
            </h2>
            <p className="text-[11px] sm:text-xs text-[var(--text-secondary)] mt-0.5">
              Featuring Focus Mode (Z), Search in Book (Ctrl+F), vector diagrams, notes, and offline availability.
            </p>
          </div>
        </div>

        <PdfReader book={book} />
      </section>

      {/* Author More Works Section */}
      {authorBooks.length > 0 && (
        <section className="mb-12 sm:mb-16 w-full min-w-0">
          <div className="flex items-center justify-between mb-4 sm:mb-6">
            <h3 className="text-lg sm:text-xl md:text-2xl font-bold font-serif text-[var(--foreground)]">
              More by {book.author}
            </h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-6 w-full min-w-0">
            {authorBooks.map((b) => (
              <BookCard key={b.id} book={b} />
            ))}
          </div>
        </section>
      )}

      {/* Related Books Section */}
      {smartRelatedBooks.length > 0 && (
        <section className="w-full min-w-0">
          <div className="flex items-center justify-between mb-4 sm:mb-6">
            <h3 className="text-lg sm:text-xl md:text-2xl font-bold font-serif text-[var(--foreground)]">
              Readers Also Explored
            </h3>
            <Link
              href={`/library?category=${encodeURIComponent(book.category)}`}
              className="text-xs font-semibold text-[var(--accent)] hover:underline"
            >
              View all {book.category} →
            </Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-6 w-full min-w-0">
            {smartRelatedBooks.map((b) => (
              <BookCard key={b.id} book={b} />
            ))}
          </div>
        </section>
      )}

      {/* Book Reading Memory Modal */}
      {/* Add To Collection Modal */}
      <AddToCollectionModal
        book={book}
        isOpen={isCollectionModalOpen}
        onClose={() => setIsCollectionModalOpen(false)}
      />

      {/* Book Reflection Modal */}
      <BookReflectionModal
        book={book}
        isOpen={isReflectionModalOpen}
        onClose={() => setIsReflectionModalOpen(false)}
      />

      <BookReadingMemory
        book={book}
        isOpen={isMemoryOpen}
        onClose={() => setIsMemoryOpen(false)}
        onJumpToPage={handleScrollToReader}
      />
    </main>
  );
}
