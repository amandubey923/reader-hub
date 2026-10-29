"use client";

import React, { useState, useMemo, useDeferredValue, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  BOOKS,
  CATEGORIES,
  Category,
  isTechnicalBook,
  TECHNICAL_SUBCATEGORIES,
  PHILOSOPHY_SUBCATEGORIES,
  ResourceType,
  matchesTechnicalSubcategory,
  matchesPhilosophySubcategory,
} from "@/data/books";
import BookCard from "@/components/BookCard";

// Precomputed static resource counts for zero-overhead filter rendering
const TECHNICAL_BOOKS_CACHE = BOOKS.filter((b) => isTechnicalBook(b));
const RESOURCE_TYPE_COUNTS: Record<string, number> = {
  All: TECHNICAL_BOOKS_CACHE.length,
  Book: TECHNICAL_BOOKS_CACHE.filter((b) => b.resourceType === "Book").length,
  Notes: TECHNICAL_BOOKS_CACHE.filter((b) => b.resourceType === "Notes").length,
  HandwrittenNotes: TECHNICAL_BOOKS_CACHE.filter((b) => b.resourceType === "HandwrittenNotes").length,
  CheatSheet: TECHNICAL_BOOKS_CACHE.filter((b) => b.resourceType === "CheatSheet").length,
  InterviewPrep: TECHNICAL_BOOKS_CACHE.filter((b) => b.resourceType === "InterviewPrep").length,
};

const TECHNICAL_SUBCATEGORY_COUNTS: Record<string, number> = {
  "All Technical": TECHNICAL_BOOKS_CACHE.length,
  "DSA & Problem Solving": TECHNICAL_BOOKS_CACHE.filter((b) => matchesTechnicalSubcategory(b, "DSA & Problem Solving")).length,
  "Computer Science & Systems": TECHNICAL_BOOKS_CACHE.filter((b) => matchesTechnicalSubcategory(b, "Computer Science & Systems")).length,
  "Web & Backend Development": TECHNICAL_BOOKS_CACHE.filter((b) => matchesTechnicalSubcategory(b, "Web & Backend Development")).length,
  "DBMS & SQL": TECHNICAL_BOOKS_CACHE.filter((b) => matchesTechnicalSubcategory(b, "DBMS & SQL")).length,
  "OOP & Software Design": TECHNICAL_BOOKS_CACHE.filter((b) => matchesTechnicalSubcategory(b, "OOP & Software Design")).length,
  "System Design & DevOps": TECHNICAL_BOOKS_CACHE.filter((b) => matchesTechnicalSubcategory(b, "System Design & DevOps")).length,
  "Programming Languages": TECHNICAL_BOOKS_CACHE.filter((b) => matchesTechnicalSubcategory(b, "Programming Languages")).length,
};

const PHILOSOPHY_BOOKS_CACHE = BOOKS.filter((b) => b.category === "Philosophy & Spirituality");
const PHILOSOPHY_SUBCATEGORY_COUNTS: Record<string, number> = {
  "All Philosophy": PHILOSOPHY_BOOKS_CACHE.length,
  "Osho": PHILOSOPHY_BOOKS_CACHE.filter((b) => matchesPhilosophySubcategory(b, "Osho")).length,
  "Jiddu Krishnamurti": PHILOSOPHY_BOOKS_CACHE.filter((b) => matchesPhilosophySubcategory(b, "Jiddu Krishnamurti")).length,
  "Acharya Prashant": PHILOSOPHY_BOOKS_CACHE.filter((b) => matchesPhilosophySubcategory(b, "Acharya Prashant")).length,
  "Buddhism & Dhamma": PHILOSOPHY_BOOKS_CACHE.filter((b) => matchesPhilosophySubcategory(b, "Buddhism & Dhamma")).length,
  "Stoicism": PHILOSOPHY_BOOKS_CACHE.filter((b) => matchesPhilosophySubcategory(b, "Stoicism")).length,
  "Western Philosophy": PHILOSOPHY_BOOKS_CACHE.filter((b) => matchesPhilosophySubcategory(b, "Western Philosophy")).length,
  "Indian Philosophy & Vedanta": PHILOSOPHY_BOOKS_CACHE.filter((b) => matchesPhilosophySubcategory(b, "Indian Philosophy & Vedanta")).length,
  "Existentialism": PHILOSOPHY_BOOKS_CACHE.filter((b) => matchesPhilosophySubcategory(b, "Existentialism")).length,
  "Taoism & Eastern Wisdom": PHILOSOPHY_BOOKS_CACHE.filter((b) => matchesPhilosophySubcategory(b, "Taoism & Eastern Wisdom")).length,
};

// Every language present in the catalog, most common first (a hard-coded list hid 20+ translated books)
const CATALOG_LANGUAGES: string[] = (() => {
  const counts = new Map<string, number>();
  BOOKS.forEach((b) => {
    if (b.language) counts.set(b.language, (counts.get(b.language) || 0) + 1);
  });
  return ["All", ...Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(([lang]) => lang)];
})();

function LibraryContent() {
  const searchParams = useSearchParams();
  const initialCategoryParam = searchParams.get("category");
  const initialSortParam = searchParams.get("sort");

  const [selectedCategory, setSelectedCategory] = useState<Category>(
    CATEGORIES.includes(initialCategoryParam as Category)
      ? (initialCategoryParam as Category)
      : "All"
  );
  const [selectedSubcategory, setSelectedSubcategory] = useState<string>("All Technical");
  const [selectedPhilosophySubcategory, setSelectedPhilosophySubcategory] = useState<string>("All Philosophy");
  const [selectedResourceType, setSelectedResourceType] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [selectedLanguage, setSelectedLanguage] = useState<string>("All");
  const [sortBy, setSortBy] = useState<"popular" | "newest" | "title" | "rating" | "pages">(
    (initialSortParam as any) || "popular"
  );
  const [displayLimit, setDisplayLimit] = useState(25);

  const languages = CATALOG_LANGUAGES;
  const resourceTypes: { label: string; value: string }[] = [
    { label: "All Types", value: "All" },
    { label: "Books", value: "Book" },
    { label: "Notes", value: "Notes" },
    { label: "Handwritten", value: "HandwrittenNotes" },
    { label: "Cheat Sheets", value: "CheatSheet" },
    { label: "Interview Prep", value: "InterviewPrep" },
  ];

  const filteredBooks = useMemo(() => {
    let result = [...BOOKS];

    // Filter by Category
    if (selectedCategory === "Technical Knowledge") {
      result = result.filter((b) => isTechnicalBook(b));

      if (selectedSubcategory !== "All Technical") {
        result = result.filter((b) => matchesTechnicalSubcategory(b, selectedSubcategory));
      }

      if (selectedResourceType !== "All") {
        result = result.filter((b) => b.resourceType === selectedResourceType);
      }
    } else if (selectedCategory === "Philosophy & Spirituality") {
      result = result.filter((b) => b.category === "Philosophy & Spirituality");
      if (selectedPhilosophySubcategory !== "All Philosophy") {
        result = result.filter((b) => matchesPhilosophySubcategory(b, selectedPhilosophySubcategory));
      }
    } else if (selectedCategory !== "All") {
      result = result.filter((b) => b.category === selectedCategory);
    }

    // Filter by Language
    if (selectedLanguage !== "All") {
      result = result.filter((b) => b.language === selectedLanguage);
    }

    // Filter by Search (using deferred query for 120 FPS fluid typing)
    if (deferredSearchQuery.trim()) {
      const q = deferredSearchQuery.toLowerCase().trim();
      result = result.filter(
        (b) =>
          b.title.toLowerCase().includes(q) ||
          b.author.toLowerCase().includes(q) ||
          b.category.toLowerCase().includes(q) ||
          (isTechnicalBook(b) && "technical knowledge".includes(q)) ||
          (b.resourceType && b.resourceType.toLowerCase().includes(q)) ||
          b.tags.some((t) => t.toLowerCase().includes(q))
      );
    }

    // Sort according to user preferences
    result.sort((a, b) => {
      if (sortBy === "popular") {
        if (a.featured && !b.featured) return -1;
        if (!a.featured && b.featured) return 1;
        return b.rating - a.rating;
      }
      if (sortBy === "newest") return Number(b.year) - Number(a.year);
      if (sortBy === "rating") return b.rating - a.rating;
      if (sortBy === "title") return a.title.localeCompare(b.title);
      if (sortBy === "pages") return Number(b.pages) - Number(a.pages);
      return 0;
    });

    return result;
  }, [selectedCategory, selectedSubcategory, selectedPhilosophySubcategory, selectedResourceType, selectedLanguage, deferredSearchQuery, sortBy]);

  const visibleBooks = useMemo(() => {
    return filteredBooks.slice(0, displayLimit);
  }, [filteredBooks, displayLimit]);

  const resetFilters = () => {
    setSelectedCategory("All");
    setSelectedSubcategory("All Technical");
    setSelectedPhilosophySubcategory("All Philosophy");
    setSelectedResourceType("All");
    setSelectedLanguage("All");
    setSearchQuery("");
    setSortBy("popular");
    setDisplayLimit(25);
  };

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      {/* Header */}
      <div className="mb-8 text-left">
        <div className="flex items-center gap-2 text-xs font-bold text-[var(--accent)] uppercase tracking-widest mb-1.5">
          <span>📖</span>
          <span>Catalog Explorer</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold font-serif text-[var(--foreground)] tracking-tight">
          Complete Library
        </h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1 font-normal">
          Explore all {BOOKS.length} literary volumes available for instant, barrier-free digital reading.
        </p>
      </div>

      {/* Filter & Controls Panel */}
      <div className="glass-card rounded-3xl p-5 sm:p-6 mb-8 border border-[var(--border)] space-y-4 bg-[var(--card)] shadow-xl text-left">
        {/* Row 1: Search & Sort Controls */}
        <div className="flex flex-col sm:flex-row gap-4 justify-between">
          <div className="relative flex-1">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setDisplayLimit(25);
              }}
              placeholder="Search by title, author, themes, or keywords..."
              className="w-full bg-[var(--background)] border border-[var(--border)] rounded-2xl px-4 py-2.5 text-xs text-[var(--foreground)] placeholder-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent)] transition-colors shadow-inner"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery("");
                  setDisplayLimit(25);
                }}
                className="absolute right-3 top-2.5 text-[var(--text-secondary)] hover:text-[var(--foreground)] text-xs cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            <label className="text-xs text-[var(--text-secondary)] whitespace-nowrap font-medium">
              Sort by:
            </label>
            <select
              value={sortBy}
              onChange={(e) => {
                setSortBy(e.target.value as typeof sortBy);
                setDisplayLimit(25);
              }}
              className="bg-[var(--background)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] cursor-pointer shadow-inner"
            >
              <option value="popular">Popular ★</option>
              <option value="newest">Newest</option>
              <option value="rating">Top Rated</option>
              <option value="title">A – Z</option>
              <option value="pages">Page Count</option>
            </select>
          </div>
        </div>

        {/* Row 2: Category Badges */}
        <div>
          <div className="text-xs text-[var(--text-secondary)] font-medium mb-2">Categories:</div>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((cat) => {
              const isActive = selectedCategory === cat;
              const catCount =
                cat === "All"
                  ? BOOKS.length
                  : cat === "Technical Knowledge"
                  ? BOOKS.filter((b) => isTechnicalBook(b)).length
                  : BOOKS.filter((b) => b.category === cat).length;
              return (
                <button
                  key={cat}
                  onClick={() => {
                    setSelectedCategory(cat);
                    setSelectedSubcategory("All Technical");
                    setSelectedPhilosophySubcategory("All Philosophy");
                    setSelectedResourceType("All");
                    setDisplayLimit(25);
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer flex items-center gap-1.5 ${
                    isActive
                      ? "bg-[var(--primary)] text-[var(--primary-foreground)] font-bold shadow-md scale-105"
                      : "bg-[var(--secondary)] text-[var(--text-secondary)] hover:text-[var(--foreground)] border border-[var(--border)]"
                  }`}
                >
                  <span>{cat}</span>
                  <span className="text-[10px] opacity-75">({catCount})</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Row 2b: Technical Knowledge Subcategories & Resource Types (Only when Technical Knowledge is selected) */}
        {selectedCategory === "Technical Knowledge" && (
          <div className="space-y-3 pt-3 border-t border-[var(--border)]/70 animate-fade-in">
            <div>
              <div className="text-xs text-[var(--accent)] font-semibold mb-2 flex items-center gap-1.5">
                <span>⚡</span>
                <span>Filter Technical Topic:</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {TECHNICAL_SUBCATEGORIES.map((subcat) => {
                  const isSubActive = selectedSubcategory === subcat;
                  const subCount = TECHNICAL_SUBCATEGORY_COUNTS[subcat] ?? 0;
                  return (
                    <button
                      key={subcat}
                      onClick={() => {
                        setSelectedSubcategory(subcat);
                        setDisplayLimit(25);
                      }}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer flex items-center gap-1 ${
                        isSubActive
                          ? "bg-[var(--accent)] text-[var(--background)] font-bold shadow-xs scale-105"
                          : "bg-[var(--background)] text-[var(--text-secondary)] hover:text-[var(--foreground)] border border-[var(--border)]"
                      }`}
                    >
                      <span>{subcat}</span>
                      <span className={`text-[10px] ${isSubActive ? "opacity-90 font-bold" : "opacity-60"}`}>
                        ({subCount})
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="text-xs text-[var(--text-secondary)] font-medium mb-1.5">Resource Format:</div>
              <div className="flex flex-wrap gap-1.5">
                {resourceTypes.map((rt) => {
                  const isRtActive = selectedResourceType === rt.value;
                  const rtCount = RESOURCE_TYPE_COUNTS[rt.value] ?? 0;
                  return (
                    <button
                      key={rt.value}
                      onClick={() => {
                        setSelectedResourceType(rt.value);
                        setDisplayLimit(25);
                      }}
                      className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition-all cursor-pointer ${
                        isRtActive
                          ? "bg-[var(--primary)] text-[var(--primary-foreground)] font-bold shadow-xs"
                          : "bg-[var(--secondary)]/70 text-[var(--text-secondary)] hover:text-[var(--foreground)] border border-[var(--border)]/60"
                      }`}
                    >
                      {rt.label} ({rtCount})
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Row 2c: Philosophy & Spirituality Subcategories (Only when Philosophy is selected) */}
        {selectedCategory === "Philosophy & Spirituality" && (
          <div className="space-y-3 pt-3 border-t border-[var(--border)]/70 animate-fade-in">
            <div>
              <div className="text-xs text-[var(--accent)] font-semibold mb-2 flex items-center gap-1.5">
                <span>🧘</span>
                <span>Filter by School of Thought:</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {PHILOSOPHY_SUBCATEGORIES.map((subcat) => {
                  const isSubActive = selectedPhilosophySubcategory === subcat;
                  const subCount = PHILOSOPHY_SUBCATEGORY_COUNTS[subcat] ?? 0;
                  return (
                    <button
                      key={subcat}
                      onClick={() => {
                        setSelectedPhilosophySubcategory(subcat);
                        setDisplayLimit(25);
                      }}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer flex items-center gap-1 ${
                        isSubActive
                          ? "bg-[var(--accent)] text-[var(--background)] font-bold shadow-xs scale-105"
                          : "bg-[var(--background)] text-[var(--text-secondary)] hover:text-[var(--foreground)] border border-[var(--border)]"
                      }`}
                    >
                      <span>{subcat}</span>
                      <span className={`text-[10px] ${isSubActive ? "opacity-90 font-bold" : "opacity-60"}`}>
                        ({subCount})
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Row 3: Language Badges */}
        <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-[var(--border)]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-[var(--text-secondary)] font-medium">Languages:</span>
            {languages.map((lang) => {
              const isActive = selectedLanguage === lang;
              return (
                <button
                  key={lang}
                  onClick={() => {
                    setSelectedLanguage(lang);
                    setDisplayLimit(25);
                  }}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer ${
                    isActive
                      ? "bg-[var(--accent)]/20 text-[var(--accent)] border border-[var(--accent)]/40 font-bold"
                      : "bg-[var(--secondary)] text-[var(--text-secondary)] hover:text-[var(--foreground)] border border-[var(--border)]"
                  }`}
                >
                  {lang}
                </button>
              );
            })}
          </div>

          {(selectedCategory !== "All" || selectedLanguage !== "All" || searchQuery || sortBy !== "popular") && (
            <button
              onClick={resetFilters}
              className="text-xs text-[var(--accent)] hover:underline font-semibold cursor-pointer"
            >
              Reset All Filters
            </button>
          )}
        </div>
      </div>

      {/* Results Header */}
      <div className="flex items-center justify-between mb-6 text-xs text-[var(--text-secondary)] px-1">
        <span>
          Showing <strong className="text-[var(--foreground)]">{visibleBooks.length}</strong> of{" "}
          <strong className="text-[var(--foreground)]">{filteredBooks.length}</strong> books
        </span>
      </div>

      {/* Grid */}
      {filteredBooks.length === 0 ? (
        <div className="text-center py-20 px-4 glass-card rounded-3xl border border-[var(--border)] bg-[var(--card)] shadow-xl">
          <div className="text-4xl mb-3">📚</div>
          <h3 className="text-lg font-bold text-[var(--foreground)] font-serif mb-1">
            No matching books found
          </h3>
          <p className="text-sm text-[var(--text-secondary)] max-w-md mx-auto mb-6">
            We couldn&apos;t find any books matching your selected filters. Try choosing another category below:
          </p>
          <div className="flex flex-wrap justify-center gap-2 max-w-lg mx-auto mb-6">
            {["Classics", "Philosophy & Spirituality", "Hindi Literature", "Self-Development"].map((c) => (
              <button
                key={c}
                onClick={() => {
                  setSelectedCategory(c as Category);
                  setSearchQuery("");
                  setDisplayLimit(25);
                }}
                className="px-3 py-1.5 rounded-xl bg-[var(--secondary)] border border-[var(--border)] text-xs text-[var(--foreground)] hover:border-[var(--accent)] transition-all cursor-pointer"
              >
                {c}
              </button>
            ))}
          </div>
          <button
            onClick={resetFilters}
            className="px-6 py-2.5 rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-bold shadow-md hover:opacity-90 transition-all cursor-pointer"
          >
            Clear All Filters
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-6">
            {visibleBooks.map((book) => (
              <BookCard key={book.id} book={book} />
            ))}
          </div>

          {displayLimit < filteredBooks.length && (
            <div className="mt-12 flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                onClick={() => setDisplayLimit((prev) => prev + 25)}
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
    </main>
  );
}

export default function LibraryPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-7xl mx-auto px-4 py-20 text-center text-[var(--text-secondary)]">
          Loading library catalog...
        </div>
      }
    >
      <LibraryContent />
    </Suspense>
  );
}
