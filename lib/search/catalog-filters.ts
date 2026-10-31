/**
 * Combined filtering, facet counts and sorting for the library page (pure; unit-tested).
 * Within a group selections are OR'ed (Hindi OR English); across groups they are AND'ed.
 */

import { Book, BOOKS } from "@/data/books";
import { searchCatalog, SearchHit } from "./catalog-search";
import {
  LengthBucket,
  getFilterCategories,
  getLengthBucket,
  getPageCount,
  getResourceType,
  getSubgroups,
} from "./book-meta";

export type SortKey =
  | "relevance"
  | "popular"
  | "title"
  | "author"
  | "pages-asc"
  | "pages-desc"
  | "newest"
  | "rating";

export const SORT_OPTIONS: { id: SortKey; label: string }[] = [
  { id: "relevance", label: "Best match" },
  { id: "popular", label: "Popular" },
  { id: "title", label: "Title A–Z" },
  { id: "author", label: "Author A–Z" },
  { id: "pages-asc", label: "Shortest first" },
  { id: "pages-desc", label: "Longest first" },
  { id: "newest", label: "Newest" },
  { id: "rating", label: "Highest rated" },
];

export interface CatalogFilters {
  query: string;
  categories: string[];
  subgroups: string[];
  languages: string[];
  authors: string[];
  lengths: LengthBucket[];
  types: string[];
  sort: SortKey;
}

export const EMPTY_FILTERS: CatalogFilters = {
  query: "",
  categories: [],
  subgroups: [],
  languages: [],
  authors: [],
  lengths: [],
  types: [],
  sort: "popular",
};

export type FacetGroup = "categories" | "subgroups" | "languages" | "authors" | "lengths" | "types";

const facetValues: Record<FacetGroup, (b: Book) => string[]> = {
  categories: getFilterCategories,
  subgroups: getSubgroups,
  languages: (b) => [b.language],
  authors: (b) => [b.author],
  lengths: (b) => {
    const bucket = getLengthBucket(b);
    return bucket ? [bucket] : [];
  },
  types: (b) => [getResourceType(b)],
};

const FACET_GROUPS = Object.keys(facetValues) as FacetGroup[];

function passesGroup(book: Book, group: FacetGroup, selected: string[]): boolean {
  if (selected.length === 0) return true;
  const values = facetValues[group](book);
  return selected.some((s) => values.includes(s));
}

function passesAll(book: Book, filters: CatalogFilters, except?: FacetGroup): boolean {
  return FACET_GROUPS.every((g) => g === except || passesGroup(book, g, filters[g] as string[]));
}

export interface CatalogQueryResult {
  books: Book[];
  /** Relevance hits keyed by book ID (present when a query is active). */
  hits: Map<string, SearchHit>;
  tokens: string[];
  didYouMean?: string;
  partial: boolean;
  /** For each group, how many results each value would give (respecting the other active filters). */
  facets: Record<FacetGroup, Map<string, number>>;
  total: number;
}

const byPagesAsc = (a: Book, b: Book) => (getPageCount(a) ?? Infinity) - (getPageCount(b) ?? Infinity);

function sortBooks(books: Book[], sort: SortKey, hits: Map<string, SearchHit>): Book[] {
  const sorted = [...books];
  switch (sort) {
    case "relevance":
      if (hits.size) return sorted.sort((a, b) => (hits.get(b.id)?.score ?? 0) - (hits.get(a.id)?.score ?? 0));
      return sortBooks(books, "popular", hits);
    case "popular":
      return sorted.sort((a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)) || (b.rating || 0) - (a.rating || 0));
    case "title":
      return sorted.sort((a, b) => a.title.localeCompare(b.title));
    case "author":
      return sorted.sort((a, b) => a.author.localeCompare(b.author) || a.title.localeCompare(b.title));
    case "pages-asc":
      return sorted.sort(byPagesAsc);
    case "pages-desc":
      return sorted.sort((a, b) => (getPageCount(b) ?? -1) - (getPageCount(a) ?? -1));
    case "newest":
      return sorted.sort((a, b) => (Number(b.year) || -Infinity) - (Number(a.year) || -Infinity));
    case "rating":
      return sorted.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  }
}

export function queryCatalog(filters: CatalogFilters, allBooks: Book[] = BOOKS): CatalogQueryResult {
  const search = filters.query.trim() ? searchCatalog(filters.query) : null;
  const hits = new Map<string, SearchHit>((search?.hits || []).map((h) => [h.book.id, h]));
  const pool = search ? allBooks.filter((b) => hits.has(b.id)) : allBooks;

  const books = sortBooks(
    pool.filter((b) => passesAll(b, filters)),
    filters.sort,
    hits
  );

  const facets = {} as Record<FacetGroup, Map<string, number>>;
  for (const group of FACET_GROUPS) {
    const counts = new Map<string, number>();
    for (const b of pool) {
      if (!passesAll(b, filters, group)) continue;
      for (const v of facetValues[group](b)) counts.set(v, (counts.get(v) || 0) + 1);
    }
    facets[group] = counts;
  }

  return {
    books,
    hits,
    tokens: search?.tokens || [],
    didYouMean: search?.didYouMean,
    partial: Boolean(search?.partial),
    facets,
    total: allBooks.length,
  };
}

export function countActiveFilters(f: CatalogFilters): number {
  return f.categories.length + f.subgroups.length + f.languages.length + f.authors.length + f.lengths.length + f.types.length + (f.query.trim() ? 1 : 0);
}

// ---------------------------------------------------------------- URL state (backward compatible)

const LIST_PARAMS: [FacetGroup, string][] = [
  ["categories", "cat"],
  ["subgroups", "sub"],
  ["languages", "lang"],
  ["authors", "author"],
  ["lengths", "len"],
  ["types", "type"],
];

const LEGACY_SORTS: Record<string, SortKey> = { popular: "popular", newest: "newest", title: "title", rating: "rating", pages: "pages-desc" };

export function filtersFromParams(params: URLSearchParams): CatalogFilters {
  const f: CatalogFilters = { ...EMPTY_FILTERS };
  f.query = (params.get("q") || "").slice(0, 120);
  for (const [group, key] of LIST_PARAMS) {
    (f as any)[group] = params.getAll(key).filter(Boolean).slice(0, 20);
  }
  // Existing links: /library?category=Hindi%20Literature and ?sort=rating|pages|...
  const legacyCategory = params.get("category");
  if (legacyCategory && legacyCategory !== "All" && !f.categories.includes(legacyCategory)) f.categories.push(legacyCategory);
  const sort = params.get("sort") || "";
  f.sort = (SORT_OPTIONS.some((o) => o.id === sort) ? sort : LEGACY_SORTS[sort]) as SortKey || (f.query ? "relevance" : "popular");
  return f;
}

export function filtersToParams(f: CatalogFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (f.query.trim()) params.set("q", f.query.trim());
  for (const [group, key] of LIST_PARAMS) (f[group] as string[]).forEach((v) => params.append(key, v));
  const defaultSort = f.query.trim() ? "relevance" : "popular";
  if (f.sort !== defaultSort) params.set("sort", f.sort);
  return params;
}
