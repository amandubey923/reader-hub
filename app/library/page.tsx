"use client";

import React, { useState, useMemo, useDeferredValue, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BOOKS, CATEGORIES, PHILOSOPHY_SUBCATEGORIES, TECHNICAL_SUBCATEGORIES } from "@/data/books";
import BookCard from "@/components/BookCard";
import { getSearchSuggestions } from "@/lib/search/catalog-search";
import {
  CatalogFilters,
  FacetGroup,
  SORT_OPTIONS,
  SortKey,
  countActiveFilters,
  filtersFromParams,
  filtersToParams,
  queryCatalog,
} from "@/lib/search/catalog-filters";
import { ALL_AUTHORS, ALL_LANGUAGES, LENGTH_BUCKETS, RESOURCE_TYPE_LABELS } from "@/lib/search/book-meta";

const PAGE_SIZE = 25;
const CATEGORY_OPTIONS = CATEGORIES.filter((c) => c !== "All");
const TECH_TRACKS = TECHNICAL_SUBCATEGORIES.filter((s) => s !== "All Technical") as string[];
const TRADITIONS = PHILOSOPHY_SUBCATEGORIES.filter((s) => s !== "All Philosophy") as string[];

const GROUP_LABELS: Record<FacetGroup, string> = {
  categories: "Category",
  subgroups: "Topic",
  languages: "Language",
  authors: "Author",
  lengths: "Length",
  types: "Type",
};

const valueLabel = (group: FacetGroup, value: string) =>
  group === "lengths"
    ? LENGTH_BUCKETS.find((b) => b.id === value)?.label ?? value
    : group === "types"
    ? RESOURCE_TYPE_LABELS[value] ?? value
    : value;

// ---------------------------------------------------------------- Chip group

function FilterGroup({
  title,
  options,
  selected,
  onToggle,
  accent = false,
}: {
  title: React.ReactNode;
  options: { value: string; label: string; count: number; hint?: string }[];
  selected: string[];
  onToggle: (value: string) => void;
  accent?: boolean;
}) {
  return (
    <div>
      <div className={`text-xs font-medium mb-2 ${accent ? "text-[var(--accent)] font-semibold" : "text-[var(--text-secondary)]"}`}>{title}</div>
      <div className="flex flex-wrap gap-1.5" role="group">
        {options.map((o) => {
          const isActive = selected.includes(o.value);
          const disabled = !isActive && o.count === 0;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={isActive}
              disabled={disabled}
              title={o.hint}
              onClick={() => onToggle(o.value)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
                isActive
                  ? "bg-[var(--primary)] text-[var(--primary-foreground)] font-bold shadow-sm cursor-pointer"
                  : disabled
                  ? "bg-[var(--secondary)]/50 text-[var(--text-secondary)]/50 border border-[var(--border)]/50 cursor-not-allowed"
                  : "bg-[var(--secondary)] text-[var(--text-secondary)] hover:text-[var(--foreground)] border border-[var(--border)] cursor-pointer"
              }`}
            >
              {isActive && <span aria-hidden="true">✓</span>}
              <span>{o.label}</span>
              <span className="text-[10px] opacity-75">({o.count})</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Author picker

function AuthorFilter({
  facet,
  selected,
  onToggle,
}: {
  facet: Map<string, number>;
  selected: string[];
  onToggle: (value: string) => void;
}) {
  const [term, setTerm] = useState("");
  const options = useMemo(() => {
    const t = term.trim().toLowerCase();
    const list = ALL_AUTHORS.filter((a) => (t ? a.toLowerCase().includes(t) : true)).map((a) => ({ value: a, label: a, count: facet.get(a) || 0 }));
    return list
      .filter((o) => o.count > 0 || selected.includes(o.value))
      .sort((a, b) => Number(selected.includes(b.value)) - Number(selected.includes(a.value)) || b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, t ? 20 : 12);
  }, [term, facet, selected]);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className="text-xs text-[var(--text-secondary)] font-medium">Author</span>
        <input
          type="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Find an author…"
          aria-label="Find an author"
          className="w-40 sm:w-52 bg-[var(--background)] border border-[var(--border)] rounded-lg px-2.5 py-1 text-[11px] text-[var(--foreground)] placeholder-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent)]"
        />
      </div>
      <FilterGroup title={<span className="sr-only">Authors</span>} options={options} selected={selected} onToggle={onToggle} />
      {options.length === 0 && <p className="text-[11px] text-[var(--text-secondary)]">No authors match “{term}”.</p>}
    </div>
  );
}

// ---------------------------------------------------------------- Page

function LibraryContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [filters, setFilters] = useState<CatalogFilters>(() => filtersFromParams(new URLSearchParams(searchParams.toString())));
  const deferredQuery = useDeferredValue(filters.query);
  const [displayLimit, setDisplayLimit] = useState(PAGE_SIZE);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const firstSync = useRef(true);

  const result = useMemo(() => queryCatalog({ ...filters, query: deferredQuery }), [filters, deferredQuery]);
  const isStale = deferredQuery !== filters.query;

  // Keep the URL shareable (debounced, no scroll jump); existing ?category= / ?sort= links still load correctly
  useEffect(() => {
    if (firstSync.current) {
      firstSync.current = false;
      return;
    }
    const t = setTimeout(() => {
      const qs = filtersToParams(filters).toString();
      router.replace(qs ? `/library?${qs}` : "/library", { scroll: false });
    }, 300);
    return () => clearTimeout(t);
  }, [filters, router]);

  useEffect(() => {
    document.body.style.overflow = drawerOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [drawerOpen]);

  const update = (patch: Partial<CatalogFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setDisplayLimit(PAGE_SIZE);
  };

  const toggle = (group: FacetGroup, value: string) => {
    setFilters((prev) => {
      const current = prev[group] as string[];
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      const patch: Partial<CatalogFilters> = { [group]: next };
      // Topics only apply inside their parent category: drop orphaned ones when a parent is removed
      if (group === "categories") {
        const keepTech = next.includes("Technical Knowledge");
        const keepPhilo = next.includes("Philosophy & Spirituality");
        patch.subgroups = prev.subgroups.filter((s) => (TECH_TRACKS.includes(s) ? keepTech : TRADITIONS.includes(s) ? keepPhilo : true));
      }
      return { ...prev, ...patch };
    });
    setDisplayLimit(PAGE_SIZE);
  };

  const setQuery = (query: string) => {
    setFilters((prev) => ({
      ...prev,
      query,
      // Best match is the natural order while searching; return to Popular when the search is cleared
      sort: query.trim() && !prev.query.trim() && prev.sort === "popular" ? "relevance" : !query.trim() && prev.sort === "relevance" ? "popular" : prev.sort,
    }));
    setDisplayLimit(PAGE_SIZE);
  };

  const resetFilters = () => {
    setFilters({ query: "", categories: [], subgroups: [], languages: [], authors: [], lengths: [], types: [], sort: "popular" });
    setDisplayLimit(PAGE_SIZE);
  };

  const facet = (group: FacetGroup, value: string) => result.facets[group].get(value) || 0;
  const showTech = filters.categories.includes("Technical Knowledge") || filters.subgroups.some((s) => TECH_TRACKS.includes(s));
  const showPhilo = filters.categories.includes("Philosophy & Spirituality") || filters.subgroups.some((s) => TRADITIONS.includes(s));
  const activeCount = countActiveFilters(filters);
  const suggestions = searchFocused ? getSearchSuggestions(filters.query, 6) : [];
  const visibleBooks = result.books.slice(0, displayLimit);

  const activeChips: { group: FacetGroup; value: string }[] = (Object.keys(GROUP_LABELS) as FacetGroup[]).flatMap((g) =>
    (filters[g] as string[]).map((value) => ({ group: g, value }))
  );

  // For the empty state: which single filter, if removed, brings results back
  const rescueSuggestions = useMemo(() => {
    if (result.books.length > 0) return [];
    return activeChips
      .map((chip) => {
        const relaxed = { ...filters, query: deferredQuery, [chip.group]: (filters[chip.group] as string[]).filter((v) => v !== chip.value) };
        return { chip, count: queryCatalog(relaxed).books.length };
      })
      .filter((s) => s.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 4);
  }, [result.books.length, activeChips, filters, deferredQuery]);

  const filterGroups = (
    <div className="space-y-4">
      <FilterGroup
        title="Categories"
        options={CATEGORY_OPTIONS.map((c) => ({ value: c, label: c, count: facet("categories", c) }))}
        selected={filters.categories}
        onToggle={(v) => toggle("categories", v)}
      />
      {showTech && (
        <div className="pt-3 border-t border-[var(--border)]/70 animate-fade-in">
          <FilterGroup
            accent
            title={<span>⚡ Technical topic</span>}
            options={TECH_TRACKS.map((s) => ({ value: s, label: s, count: facet("subgroups", s) }))}
            selected={filters.subgroups}
            onToggle={(v) => toggle("subgroups", v)}
          />
        </div>
      )}
      {showPhilo && (
        <div className="pt-3 border-t border-[var(--border)]/70 animate-fade-in">
          <FilterGroup
            accent
            title={<span>🧘 School of thought</span>}
            options={TRADITIONS.map((s) => ({ value: s, label: s, count: facet("subgroups", s) }))}
            selected={filters.subgroups}
            onToggle={(v) => toggle("subgroups", v)}
          />
        </div>
      )}
      <div className="grid gap-4 pt-3 border-t border-[var(--border)] lg:grid-cols-2">
        <FilterGroup
          title="Language"
          options={ALL_LANGUAGES.map((l) => ({ value: l, label: l, count: facet("languages", l) }))}
          selected={filters.languages}
          onToggle={(v) => toggle("languages", v)}
        />
        <div className="space-y-4">
          <FilterGroup
            title="Length (measured from each PDF)"
            options={LENGTH_BUCKETS.map((b) => ({ value: b.id, label: b.label, count: facet("lengths", b.id), hint: b.hint }))}
            selected={filters.lengths}
            onToggle={(v) => toggle("lengths", v)}
          />
          <FilterGroup
            title="Type"
            options={Object.keys(RESOURCE_TYPE_LABELS).map((t) => ({ value: t, label: RESOURCE_TYPE_LABELS[t], count: facet("types", t) }))}
            selected={filters.types}
            onToggle={(v) => toggle("types", v)}
          />
        </div>
      </div>
      <div className="pt-3 border-t border-[var(--border)]">
        <AuthorFilter facet={result.facets.authors} selected={filters.authors} onToggle={(v) => toggle("authors", v)} />
      </div>
    </div>
  );

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      {/* Header */}
      <div className="mb-8 text-left">
        <div className="flex items-center gap-2 text-xs font-bold text-[var(--accent)] uppercase tracking-widest mb-1.5">
          <span>📖</span>
          <span>Catalog Explorer</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold font-serif text-[var(--foreground)] tracking-tight">Complete Library</h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1 font-normal">
          Explore all {BOOKS.length} literary volumes available for instant, barrier-free digital reading.
        </p>
      </div>

      {/* Filter & Controls Panel */}
      <div className="glass-card rounded-3xl p-5 sm:p-6 mb-6 border border-[var(--border)] space-y-4 bg-[var(--card)] shadow-xl text-left">
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-between">
          {/* Search with suggestions */}
          <div className="relative flex-1">
            <input
              type="search"
              value={filters.query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
              placeholder="Search titles, authors, topics, languages… (typos are OK)"
              aria-label="Search the library"
              className="w-full bg-[var(--background)] border border-[var(--border)] rounded-2xl pl-4 pr-9 py-2.5 text-xs text-[var(--foreground)] placeholder-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent)] transition-colors shadow-inner"
            />
            {filters.query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-3 top-2.5 text-[var(--text-secondary)] hover:text-[var(--foreground)] text-xs cursor-pointer"
              >
                ✕
              </button>
            )}
            {suggestions.length > 0 && (
              <ul className="absolute z-30 mt-1.5 w-full overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-xl" role="listbox" aria-label="Search suggestions">
                {suggestions.map((s) => (
                  <li key={`${s.kind}-${s.value}`}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        if (s.kind === "category") {
                          setQuery("");
                          if (!filters.categories.includes(s.value)) toggle("categories", s.value);
                        } else {
                          setQuery(s.value);
                        }
                        setSearchFocused(false);
                      }}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs text-[var(--foreground)] hover:bg-[var(--secondary)] cursor-pointer"
                    >
                      <span className="truncate">{s.label}</span>
                      <span className="shrink-0 text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">{s.kind}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <label htmlFor="library-sort" className="text-xs text-[var(--text-secondary)] whitespace-nowrap font-medium">
              Sort by:
            </label>
            <select
              id="library-sort"
              value={filters.sort}
              onChange={(e) => update({ sort: e.target.value as SortKey })}
              className="bg-[var(--background)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] cursor-pointer shadow-inner"
            >
              {SORT_OPTIONS.filter((o) => o.id !== "relevance" || filters.query.trim()).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="md:hidden ml-auto px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--secondary)] text-xs font-semibold text-[var(--foreground)] cursor-pointer"
              aria-haspopup="dialog"
            >
              Filters{activeCount - (filters.query.trim() ? 1 : 0) > 0 ? ` (${activeCount - (filters.query.trim() ? 1 : 0)})` : ""}
            </button>
          </div>
        </div>

        {/* Desktop filters */}
        <div className="hidden md:block">{filterGroups}</div>
      </div>

      {/* Active filters */}
      {(activeChips.length > 0 || filters.query.trim()) && (
        <div className="mb-5 flex flex-wrap items-center gap-2" aria-label="Active filters">
          {filters.query.trim() && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-3 py-1 text-xs text-[var(--foreground)]">
              Search: “{filters.query.trim()}”
              <button type="button" onClick={() => setQuery("")} aria-label="Remove search" className="cursor-pointer text-[var(--text-secondary)] hover:text-[var(--foreground)]">
                ✕
              </button>
            </span>
          )}
          {activeChips.map(({ group, value }) => (
            <span key={`${group}-${value}`} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-1 text-xs text-[var(--foreground)]">
              <span className="text-[var(--text-secondary)]">{GROUP_LABELS[group]}:</span> {valueLabel(group, value)}
              <button
                type="button"
                onClick={() => toggle(group, value)}
                aria-label={`Remove ${GROUP_LABELS[group]} ${valueLabel(group, value)}`}
                className="cursor-pointer text-[var(--text-secondary)] hover:text-[var(--foreground)]"
              >
                ✕
              </button>
            </span>
          ))}
          <button type="button" onClick={resetFilters} className="text-xs text-[var(--accent)] hover:underline font-semibold cursor-pointer">
            Clear all
          </button>
        </div>
      )}

      {/* Results Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-6 text-xs text-[var(--text-secondary)] px-1" aria-live="polite">
        <span>
          {result.books.length === BOOKS.length ? (
            <>
              Showing <strong className="text-[var(--foreground)]">{visibleBooks.length}</strong> of{" "}
              <strong className="text-[var(--foreground)]">{result.books.length}</strong> books
            </>
          ) : (
            <>
              <strong className="text-[var(--foreground)]">{result.books.length}</strong> matching book{result.books.length === 1 ? "" : "s"} of {BOOKS.length}
              {result.books.length > visibleBooks.length && <> · showing {visibleBooks.length}</>}
            </>
          )}
          {isStale && <span className="ml-2 animate-pulse">Updating…</span>}
        </span>
        {result.partial && result.books.length > 0 && (
          <span>No book matched every word, so these are the closest matches.</span>
        )}
      </div>

      {result.didYouMean && (
        <p className="mb-5 px-1 text-sm text-[var(--foreground)]">
          Did you mean{" "}
          <button type="button" onClick={() => setQuery(result.didYouMean!)} className="font-semibold text-[var(--accent)] hover:underline cursor-pointer">
            “{result.didYouMean}”
          </button>
          ?
        </p>
      )}

      {/* Grid */}
      {result.books.length === 0 ? (
        <div className="text-center py-16 px-4 glass-card rounded-3xl border border-[var(--border)] bg-[var(--card)] shadow-xl">
          <div className="text-4xl mb-3">📚</div>
          <h3 className="text-lg font-bold text-[var(--foreground)] font-serif mb-1">No matching books found</h3>
          <p className="text-sm text-[var(--text-secondary)] max-w-md mx-auto mb-5">
            {rescueSuggestions.length > 0
              ? "Removing one of these filters would bring results back:"
              : "Try a different word, or browse a category below."}
          </p>
          <div className="flex flex-wrap justify-center gap-2 max-w-xl mx-auto mb-6">
            {rescueSuggestions.length > 0
              ? rescueSuggestions.map(({ chip, count }) => (
                  <button
                    key={`${chip.group}-${chip.value}`}
                    type="button"
                    onClick={() => toggle(chip.group, chip.value)}
                    className="px-3 py-1.5 rounded-xl bg-[var(--secondary)] border border-[var(--border)] text-xs text-[var(--foreground)] hover:border-[var(--accent)] transition-all cursor-pointer"
                  >
                    Remove {GROUP_LABELS[chip.group].toLowerCase()} “{valueLabel(chip.group, chip.value)}” ({count})
                  </button>
                ))
              : ["Classics & Literature", "Philosophy & Spirituality", "Hindi Literature", "Psychology & Self-Development"].map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => {
                      resetFilters();
                      toggle("categories", c);
                    }}
                    className="px-3 py-1.5 rounded-xl bg-[var(--secondary)] border border-[var(--border)] text-xs text-[var(--foreground)] hover:border-[var(--accent)] transition-all cursor-pointer"
                  >
                    {c}
                  </button>
                ))}
          </div>
          <button
            type="button"
            onClick={resetFilters}
            className="px-6 py-2.5 rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-bold shadow-md hover:opacity-90 transition-all cursor-pointer"
          >
            Clear All Filters
          </button>
        </div>
      ) : (
        <>
          <div className={`grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-6 transition-opacity ${isStale ? "opacity-70" : ""}`}>
            {visibleBooks.map((book) => (
              <BookCard key={book.id} book={book} highlightTokens={result.tokens} />
            ))}
          </div>

          {displayLimit < result.books.length && (
            <div className="mt-12 flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setDisplayLimit((prev) => prev + PAGE_SIZE)}
                className="px-6 py-3 rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] font-bold text-xs shadow-md hover:opacity-90 transition-all cursor-pointer flex items-center gap-2"
              >
                <span>Load More Books ({result.books.length - displayLimit} remaining)</span>
                <span>↓</span>
              </button>
              <button
                type="button"
                onClick={() => setDisplayLimit(result.books.length)}
                className="px-5 py-3 rounded-xl bg-[var(--secondary)] hover:bg-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--foreground)] font-semibold text-xs border border-[var(--border)] transition-all cursor-pointer"
              >
                Show All ({result.books.length})
              </button>
            </div>
          )}
        </>
      )}

      {/* Mobile filter drawer */}
      {drawerOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex flex-col justify-end bg-black/50" role="dialog" aria-modal="true" aria-label="Filters">
          <div className="absolute inset-0" onClick={() => setDrawerOpen(false)} />
          <div className="relative max-h-[85dvh] overflow-y-auto rounded-t-3xl border-t border-[var(--border)] bg-[var(--card)] p-5 text-left animate-scale-up">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-serif text-lg font-bold text-[var(--foreground)]">Filters</h2>
              <button type="button" onClick={resetFilters} className="text-xs font-semibold text-[var(--accent)] cursor-pointer">
                Clear all
              </button>
            </div>
            {filterGroups}
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="sticky bottom-0 mt-5 w-full rounded-xl bg-[var(--primary)] px-4 py-3 text-sm font-bold text-[var(--primary-foreground)] shadow-md cursor-pointer"
            >
              Show {result.books.length} book{result.books.length === 1 ? "" : "s"}
            </button>
          </div>
        </div>
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
