"use client";

import React, { useState, useMemo, useDeferredValue, useRef } from "react";
import Link from "next/link";
import { BOOKS, Category, getBooksByCategory, searchBooks, isTechnicalBook, matchesTechnicalSubcategory, matchesPhilosophySubcategory } from "@/data/books";
import HeroVideo from "@/components/HeroVideo";
import ContinueReading from "@/components/ContinueReading";
import FeaturedCarousel from "@/components/FeaturedCarousel";
import ReadingUniverse from "@/components/visual/ReadingUniverse";
import CategoryPills from "@/components/CategoryPills";
import BookCard from "@/components/BookCard";
import SmartRecommendations from "@/components/recommendations/SmartRecommendations";
import ReadingJourney3D from "@/components/landing/ReadingJourney3D";
import ReaderFaq from "@/components/landing/ReaderFaq";

export default function HomePage() {
  const [selectedCategory, setSelectedCategory] = useState<Category>("All");
  const [selectedSubcategory, setSelectedSubcategory] = useState<string>("All Technical");
  const [selectedPhilosophySubcategory, setSelectedPhilosophySubcategory] = useState<string>("All Philosophy");
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [displayLimit, setDisplayLimit] = useState(20);
  const librarySectionRef = useRef<HTMLDivElement>(null);

  const filteredBooks = useMemo(() => {
    let result = getBooksByCategory(
      selectedCategory,
      selectedCategory === "Technical Knowledge"
        ? selectedSubcategory
        : selectedCategory === "Philosophy & Spirituality"
        ? selectedPhilosophySubcategory
        : undefined
    );
    if (deferredSearchQuery.trim()) {
      result = searchBooks(deferredSearchQuery).filter((b) => {
        if (selectedCategory === "All") return true;
        if (selectedCategory === "Technical Knowledge") {
          if (selectedSubcategory !== "All Technical") {
            return matchesTechnicalSubcategory(b, selectedSubcategory);
          }
          return isTechnicalBook(b);
        }
        if (selectedCategory === "Philosophy & Spirituality") {
          if (selectedPhilosophySubcategory !== "All Philosophy") {
            return matchesPhilosophySubcategory(b, selectedPhilosophySubcategory);
          }
          return b.category === "Philosophy & Spirituality";
        }
        return b.category === selectedCategory;
      });
    }
    return result;
  }, [selectedCategory, selectedSubcategory, selectedPhilosophySubcategory, deferredSearchQuery]);

  const handleCategoryChange = (cat: Category) => {
    setSelectedCategory(cat);
    setSelectedSubcategory("All Technical");
    setSelectedPhilosophySubcategory("All Philosophy");
    setDisplayLimit(20);
  };

  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    setDisplayLimit(20);
  };

  const visibleBooks = useMemo(() => {
    return filteredBooks.slice(0, displayLimit);
  }, [filteredBooks, displayLimit]);

  const scrollToLibrary = () => {
    librarySectionRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <main className="flex-1">
      {/* 1. Cinematic Hero with Video Background & 3D Floating Books */}
      <HeroVideo onExploreClick={scrollToLibrary} />

      {/* 1b. Interactive 3D Reading Workflow */}
      <ReadingJourney3D />

      {/* 2. Continue Reading (synced with localStorage) */}
      <ContinueReading />

      {/* 3. Featured Editorial Spotlight */}
      <FeaturedCarousel />

      {/* 4. Interactive Reading Universe (Constellation Genre Explorer) */}
      <ReadingUniverse />

      {/* 5. Main Library Collection Grid */}
      <section ref={librarySectionRef} id="library" className="py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header & Controls */}
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold text-[var(--accent)] uppercase tracking-widest mb-1.5">
                <span>📚</span>
                <span>Open Digital Collection</span>
              </div>
              <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold font-serif text-[var(--foreground)] tracking-tight">
                Explore the Library
              </h2>
              <p className="text-sm text-[var(--text-secondary)] mt-1">
                Browse our complete collection of {BOOKS.length} curated masterworks.
              </p>
            </div>

            {/* Quick in-page Search filter */}
            <div className="relative w-full md:w-72">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="Filter by title, author..."
                className="w-full bg-[var(--card)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-xs text-[var(--foreground)] placeholder-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent)]/50 shadow-inner"
              />
              {searchQuery ? (
                <button
                  onClick={() => handleSearchChange("")}
                  className="absolute right-3 top-2.5 text-[var(--text-secondary)] hover:text-[var(--foreground)] text-xs cursor-pointer"
                >
                  ✕
                </button>
              ) : (
                <span className="absolute right-3 top-2.5 text-[var(--text-secondary)] text-xs">
                  🔍
                </span>
              )}
            </div>
          </div>

          {/* Category Filter Pills */}
          <div className="mb-8">
            <CategoryPills
              activeCategory={selectedCategory}
              onSelectCategory={handleCategoryChange}
              activeSubcategory={selectedSubcategory}
              onSelectSubcategory={setSelectedSubcategory}
              activePhilosophySubcategory={selectedPhilosophySubcategory}
              onSelectPhilosophySubcategory={setSelectedPhilosophySubcategory}
            />
          </div>

          {/* Active Filter State Notice */}
          {(selectedCategory !== "All" || searchQuery) && (
            <div className="flex items-center justify-between mb-6 px-4 py-2.5 rounded-xl bg-[var(--accent)]/10 border border-[var(--accent)]/20 text-xs text-[var(--accent)]">
              <span>
                Showing <strong>{filteredBooks.length}</strong> book{filteredBooks.length === 1 ? "" : "s"}
                {selectedCategory !== "All" && ` in "${selectedCategory}"`}
                {searchQuery && ` matching "${searchQuery}"`}
              </span>
              <button
                onClick={() => {
                  setSelectedCategory("All");
                  setSearchQuery("");
                  setDisplayLimit(20);
                }}
                className="underline hover:opacity-80 font-semibold cursor-pointer"
              >
                Reset Filters
              </button>
            </div>
          )}

          {/* Books Responsive Grid */}
          {filteredBooks.length === 0 ? (
            <div className="text-center py-16 px-4 glass-card rounded-2xl border border-[var(--border)] bg-[var(--card)]">
              <div className="text-4xl mb-3">🔍</div>
              <h3 className="text-lg font-bold text-[var(--foreground)] font-serif mb-1">
                No matching books found
              </h3>
              <p className="text-sm text-[var(--text-secondary)] max-w-md mx-auto mb-6">
                Try searching with a different keyword or select another genre.
              </p>
              <button
                onClick={() => {
                  setSelectedCategory("All");
                  setSearchQuery("");
                  setDisplayLimit(20);
                }}
                className="px-5 py-2.5 rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-bold shadow-md hover:opacity-90 transition-all cursor-pointer"
              >
                View All {BOOKS.length} Books
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-6">
                {visibleBooks.map((book) => (
                  <BookCard key={book.id} book={book} />
                ))}
              </div>

              {/* Progressive Load More / Expand Controls */}
              {displayLimit < filteredBooks.length && (
                <div className="mt-12 flex flex-col sm:flex-row items-center justify-center gap-3">
                  <button
                    onClick={() => setDisplayLimit((prev) => prev + 20)}
                    className="px-6 py-3 rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] font-bold text-xs shadow-md hover:opacity-90 transition-all cursor-pointer flex items-center gap-2"
                  >
                    <span>Load More Books ({filteredBooks.length - displayLimit} remaining)</span>
                    <span>↓</span>
                  </button>
                  <button
                    onClick={() => setDisplayLimit(filteredBooks.length)}
                    className="px-5 py-3 rounded-xl bg-[var(--secondary)] hover:bg-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--foreground)] font-semibold text-xs border border-[var(--border)] transition-all cursor-pointer"
                  >
                    Show All ({filteredBooks.length})
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {/* 6. Smart Personalized Recommendations Rail */}
      <section className="py-12 border-t border-[var(--border)]/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SmartRecommendations maxSections={3} />
        </div>
      </section>

      {/* 7. Why Reader's HUB / Mission Section */}
      <section className="py-16 border-t border-[var(--border)]/80 bg-[var(--background)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold font-serif text-[var(--foreground)] tracking-tight">
              Designed for Pure Reading Delight
            </h2>
            <p className="text-sm text-[var(--text-secondary)] mt-2">
              Reader&apos;s HUB is crafted without paywalls, noisy ads, or login requirements. Pure literature at your fingertips.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="glass-card rounded-2xl p-6 border border-[var(--border)] hover:border-[var(--accent)]/30 transition-all bg-[var(--card)]">
              <div className="w-12 h-12 rounded-xl bg-[var(--accent)]/10 border border-[var(--accent)]/20 flex items-center justify-center text-2xl mb-4 text-[var(--accent)]">
                ⚡
              </div>
              <h3 className="text-base font-bold text-[var(--foreground)] font-serif mb-2">
                Instant &amp; Barrier-Free
              </h3>
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                Click any book and start reading immediately. No mandatory accounts, email verifications, or passwords to remember.
              </p>
            </div>

            <div className="glass-card rounded-2xl p-6 border border-[var(--border)] hover:border-[var(--accent)]/30 transition-all bg-[var(--card)]">
              <div className="w-12 h-12 rounded-xl bg-[var(--accent)]/10 border border-[var(--accent)]/20 flex items-center justify-center text-2xl mb-4 text-[var(--accent)]">
                📖
              </div>
              <h3 className="text-base font-bold text-[var(--foreground)] font-serif mb-2">
                Distraction-Free PDF Reader
              </h3>
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                Read comfortably inside an integrated fullscreen viewer or save books for instant offline reading on any device.
              </p>
            </div>

            <div className="glass-card rounded-2xl p-6 border border-[var(--border)] hover:border-[var(--accent)]/30 transition-all bg-[var(--card)]">
              <div className="w-12 h-12 rounded-xl bg-[var(--accent)]/10 border border-[var(--accent)]/20 flex items-center justify-center text-2xl mb-4 text-[var(--accent)]">
                🔒
              </div>
              <h3 className="text-base font-bold text-[var(--foreground)] font-serif mb-2">
                Privacy &amp; Local Sync
              </h3>
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                Your bookmarks and reading history stay in your browser. Sign in only if you want them synced to your account across devices.
              </p>
            </div>
          </div>

          <div className="mt-12 text-center">
            <Link
              href="/about"
              className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--accent)] hover:underline transition-colors"
            >
              <span>Learn more about the Reader&apos;s HUB developer &amp; story</span>
              <span>→</span>
            </Link>
          </div>
        </div>
      </section>

      {/* 8. FAQ */}
      <ReaderFaq />
    </main>
  );
}