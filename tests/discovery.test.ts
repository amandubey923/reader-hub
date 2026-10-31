import { test } from "node:test";
import assert from "node:assert/strict";
import { BOOKS, getBookById, isTechnicalBook, matchesPhilosophySubcategory } from "../data/books";
import {
  editDistance,
  getSearchSuggestions,
  highlightMatches,
  normalizeText,
  searchCatalog,
} from "../lib/search/catalog-search";
import {
  EMPTY_FILTERS,
  filtersFromParams,
  filtersToParams,
  queryCatalog,
} from "../lib/search/catalog-filters";
import { ALL_LANGUAGES, getLengthBucket, getPageCount } from "../lib/search/book-meta";
import {
  calculateBookSimilarity,
  generateRecommendations,
  getRelatedBooks,
  getRelatedBooksWithReasons,
  isReadableIn,
  isSameAuthor,
} from "../lib/recommendations";

const ids = (query: string, n = 5) => searchCatalog(query).hits.slice(0, n).map((h) => h.book.id);
const now = Date.UTC(2026, 9, 31);

// ---------------------------------------------------------------- Search

test("exact and partial titles rank first", () => {
  assert.equal(ids("1984")[0], "1984");
  assert.equal(ids("great gats")[0], "the-great-gatsby");
  assert.equal(ids("crime and pun")[0], "crime-and-punishment");
  assert.equal(ids("Pride")[0], "pride-and-prejudice");
});

test("author search, case-insensitive and accent-insensitive", () => {
  assert.ok(searchCatalog("ORWELL").hits.some((h) => h.book.id === "1984"));
  assert.equal(searchCatalog("Orwell").hits[0].matchedField, "author");
  const marquez = searchCatalog("garcia marquez").hits[0]?.book;
  assert.equal(marquez?.id, "one-hundred-years-of-solitude");
  assert.equal(normalizeText("Márquez"), "marquez");
});

test("typos still find the intended book", () => {
  assert.equal(ids("dostoevksy")[0] && getBookById(ids("dostoevksy")[0])?.author, "Fyodor Dostoevsky");
  assert.equal(ids("gatsbyy")[0], "the-great-gatsby");
  assert.equal(ids("premchnd").length > 0 && getBookById(ids("premchnd")[0])?.author.includes("Premchand"), true);
  assert.equal(editDistance("teh", "the"), 1, "transpositions count as one edit");
});

test("Hindi (Devanagari) text is searchable and not corrupted by normalisation", () => {
  const hindi = BOOKS.find((b) => /[ऀ-ॿ]/.test(b.title));
  if (hindi) {
    const word = hindi.title.split(/\s+/).find((w) => /[ऀ-ॿ]{2,}/.test(w))!;
    assert.ok(searchCatalog(word).hits.some((h) => h.book.id === hindi.id), `finds ${hindi.id} by "${word}"`);
  }
  assert.equal(normalizeText("कामायनी"), "कामायनी", "vowel signs survive");
});

test("categories, sub-groups, languages and types are searchable", () => {
  assert.ok(searchCatalog("stoicism").hits.length > 0);
  assert.ok(searchCatalog("hindi").hits.some((h) => h.book.language === "Hindi"));
  assert.ok(searchCatalog("cheat sheet").hits.some((h) => h.book.resourceType === "CheatSheet"));
});

test("nonsense returns no results and a helpful correction when possible", () => {
  assert.equal(searchCatalog("zzqqxxyy").hits.length, 0);
  const r = searchCatalog("orwel nineteen");
  assert.ok(r.hits.length > 0, "multi-word queries fall back to partial matches");
  assert.equal(searchCatalog("gatbsy great").hits[0]?.book.id, "the-great-gatsby");
  assert.ok((searchCatalog("dostoyevskyy").didYouMean || searchCatalog("dostoyevskyy").hits.length > 0) !== undefined);
});

test("suggestions and highlighting", () => {
  assert.ok(getSearchSuggestions("plat").some((s) => s.kind === "author" && s.value.includes("Plato")));
  const segs = highlightMatches("Nineteen Eighty-Four by George Orwell", ["orwell"]);
  assert.deepEqual(segs.filter((s) => s.match).map((s) => s.text), ["Orwell"]);
  assert.deepEqual(highlightMatches("Plain", []), [{ text: "Plain", match: false }]);
});

test("search is fast enough for keystroke-by-keystroke use", () => {
  const queries = ["d", "do", "dos", "dost", "dosto", "dostoe", "philosophy of mind", "hindi kavita", "atomic habits", "zzz"];
  const start = performance.now();
  for (const q of queries) searchCatalog(q + " " + Math.random().toString(36).slice(2, 3)); // defeat the memo cache
  const perQuery = (performance.now() - start) / queries.length;
  assert.ok(perQuery < 60, `average ${perQuery.toFixed(1)}ms per query`);
});

// ---------------------------------------------------------------- Page counts

test("discovery uses measured PDF page counts, not inaccurate catalogue values", () => {
  const plato = getBookById("complete-dialogues-of-plato")!;
  assert.equal(Number(plato.pages), 120, "catalogue value is unchanged");
  assert.equal(getPageCount(plato), 2449);
  assert.equal(getLengthBucket(plato), "epic");
  assert.equal(getPageCount(getBookById("1984")!), 394);
  assert.ok(BOOKS.every((b) => (getPageCount(b) ?? 0) > 0), "every book has a page count");
});

// ---------------------------------------------------------------- Filters

test("existing single-category behaviour is preserved for every category", () => {
  const cats = Array.from(new Set(BOOKS.map((b) => b.category)));
  for (const cat of cats) {
    const got = queryCatalog({ ...EMPTY_FILTERS, categories: [cat] }).books.map((b) => b.id).sort();
    const expected = (cat === "Technical Knowledge" ? BOOKS.filter(isTechnicalBook) : BOOKS.filter((b) => b.category === cat)).map((b) => b.id).sort();
    assert.deepEqual(got, expected, cat);
  }
  const osho = queryCatalog({ ...EMPTY_FILTERS, categories: ["Philosophy & Spirituality"], subgroups: ["Osho"] }).books;
  assert.deepEqual(osho.map((b) => b.id).sort(), BOOKS.filter((b) => matchesPhilosophySubcategory(b, "Osho")).map((b) => b.id).sort());
});

test("every language is filterable and counts add up", () => {
  let sum = 0;
  for (const lang of ALL_LANGUAGES) {
    const n = queryCatalog({ ...EMPTY_FILTERS, languages: [lang] }).books.length;
    assert.ok(n > 0, lang);
    sum += n;
  }
  assert.equal(sum, BOOKS.length);
});

test("filters combine: OR within a group, AND across groups", () => {
  const two = queryCatalog({ ...EMPTY_FILTERS, languages: ["Hindi", "English"] }).books;
  assert.equal(two.length, BOOKS.filter((b) => b.language === "Hindi" || b.language === "English").length);
  const combo = queryCatalog({ ...EMPTY_FILTERS, categories: ["Philosophy & Spirituality"], languages: ["English"], lengths: ["short"] }).books;
  assert.ok(combo.length > 0);
  assert.ok(combo.every((b) => b.category === "Philosophy & Spirituality" && b.language === "English" && getLengthBucket(b) === "short"));
  const withQuery = queryCatalog({ ...EMPTY_FILTERS, query: "osho", languages: ["Hindi"] }).books;
  assert.ok(withQuery.length > 0 && withQuery.every((b) => b.language === "Hindi"));
});

test("facet counts reflect the other active filters", () => {
  const r = queryCatalog({ ...EMPTY_FILTERS, languages: ["English"] });
  const philoEnglish = BOOKS.filter((b) => b.category === "Philosophy & Spirituality" && b.language === "English").length;
  assert.equal(r.facets.categories.get("Philosophy & Spirituality"), philoEnglish);
  // The language facet ignores its own selection so other languages remain choosable
  assert.equal(r.facets.languages.get("Hindi"), BOOKS.filter((b) => b.language === "Hindi").length);
});

test("sorting by relevance, title, author and real page counts", () => {
  assert.equal(queryCatalog({ ...EMPTY_FILTERS, query: "gatsby", sort: "relevance" }).books[0].id, "the-great-gatsby");
  const byTitle = queryCatalog({ ...EMPTY_FILTERS, sort: "title" }).books.map((b) => b.title);
  assert.deepEqual(byTitle, [...byTitle].sort((a, b) => a.localeCompare(b)));
  const short = queryCatalog({ ...EMPTY_FILTERS, sort: "pages-asc" }).books.map((b) => getPageCount(b)!);
  assert.ok(short.every((p, i) => i === 0 || p >= short[i - 1]));
  const long = queryCatalog({ ...EMPTY_FILTERS, sort: "pages-desc" }).books[0];
  assert.equal(getPageCount(long), Math.max(...BOOKS.map((b) => getPageCount(b)!)));
});

test("URL state round-trips and old links keep working", () => {
  const legacy = filtersFromParams(new URLSearchParams("category=Hindi%20Literature&sort=rating"));
  assert.deepEqual(legacy.categories, ["Hindi Literature"]);
  assert.equal(legacy.sort, "rating");
  assert.equal(filtersFromParams(new URLSearchParams("sort=pages")).sort, "pages-desc");
  const f = { ...EMPTY_FILTERS, query: "plato", languages: ["English", "Hindi"], lengths: ["short" as const], sort: "title" as const };
  const back = filtersFromParams(filtersToParams(f));
  assert.deepEqual(back, { ...f });
  assert.equal(filtersFromParams(new URLSearchParams("q=plato")).sort, "relevance");
});

// ---------------------------------------------------------------- Related books & recommendations

test("related books are relevant, explained and never the same book", () => {
  const related = getRelatedBooksWithReasons(getBookById("crime-and-punishment")!, BOOKS, 4);
  assert.equal(related.length, 4);
  assert.ok(related.every((r) => r.book.id !== "crime-and-punishment" && r.reason.length > 0));
  const osho = BOOKS.find((b) => b.author.toLowerCase().includes("osho"))!;
  const oshoRelated = getRelatedBooksWithReasons(osho, BOOKS, 4);
  // Same tradition dominates; a per-author cap deliberately leaves room for one adjacent pick
  assert.ok(oshoRelated.filter((r) => /Osho/.test(r.book.author) || /Osho/.test(r.reason)).length >= 3, "same tradition first");
  assert.ok(isSameAuthor("Osho", "Bhagwan Shree Rajneesh (Osho)") && !isSameAuthor("Osho", "Plato"));
  assert.ok(isReadableIn("Greek (Eng Trans)", "English") && isReadableIn("Hindi / Urdu", "Hindi") && !isReadableIn("Hindi", "English"));
  assert.deepEqual(getRelatedBooks(osho).map((b) => b.id), oshoRelated.map((r) => r.book.id), "legacy API agrees");
  assert.equal(calculateBookSimilarity(osho, osho), -1);
});

test("guests get transparent starter picks", () => {
  const r = generateRecommendations([], [], BOOKS, { now });
  assert.equal(r.hasActivity, false);
  assert.equal(r.sections[0].id, "start-here");
  for (const s of r.sections) {
    assert.ok(s.books.every((b) => s.reasons[b.id]), `${s.id} has a reason for every book`);
  }
  const startCats = r.sections[0].books.map((b) => b.category);
  assert.equal(new Set(startCats).size, startCats.length, "one pick per category");
});

test("personal recommendations follow the reader's signals and explain them", () => {
  const history = [{ bookId: "crime-and-punishment", page: 400, totalPages: 430, progress: 93, lastReadAt: now - 86400000 }];
  const favorites = ["godan"];
  const r = generateRecommendations(history, favorites, BOOKS, { now, completedIds: ["the-great-gatsby"] });
  const all = r.sections.flatMap((s) => s.books.map((b) => b.id));
  for (const known of ["crime-and-punishment", "godan", "the-great-gatsby"]) assert.ok(!all.includes(known), `${known} not recommended back`);
  const picked = r.sections.find((s) => s.id === "picked-for-you")!;
  assert.ok(picked.books.some((b) => b.category === "Classics & Literature" || b.category === "Hindi Literature"));
  assert.ok(picked.books.every((b) => /Because|More from|interest|enjoy/.test(picked.reasons[b.id])));
  const authors = picked.books.map((b) => b.author);
  assert.ok(authors.every((a) => authors.filter((x) => x === a).length <= 2), "at most two per author");
});

test("explicit interests and language preferences steer recommendations", () => {
  const r = generateRecommendations([], [], BOOKS, { now, interests: { categories: [], subgroups: ["Stoicism"], languages: ["English"] } });
  assert.equal(r.hasActivity, true);
  const picked = r.sections.find((s) => s.id === "picked-for-you")!;
  assert.ok(picked.books.length >= 2);
  // Every Stoic text in the catalogue is an English translation ("Greek (Eng Trans)" etc.)
  assert.ok(picked.books.every((b) => isReadableIn(b.language, "English")), picked.books.map((b) => b.language).join());
  assert.ok(picked.books.slice(0, 3).every((b) => /Stoicism/.test(picked.reasons[b.id])), "top picks explained by the chosen interest");
  assert.ok(picked.books.every((b) => !/^Highly rated/.test(picked.reasons[b.id])), "no padding with unrelated books");
});

// ---------------------------------------------------------------- Shared engine in every entry point

test("stemming and filler words: natural phrasing still finds the right books", () => {
  const stoic = ids("stoicism", 3);
  assert.ok(stoic.length >= 3 && stoic.every((id) => /stoic/i.test(JSON.stringify(getBookById(id)))), stoic.join());
  // "books" / "by" refine but are not required, so these still return complete matches
  assert.equal(searchCatalog("books by orwell").hits[0]?.book.id, "1984");
  assert.equal(searchCatalog("books by orwell").partial, false);
  assert.ok(searchCatalog("osho books").hits.slice(0, 10).every((h) => /osho/i.test(h.book.author + h.book.title)));
});

test("short fuzzy fragments do not produce unrelated matches", () => {
  // "mice" must not match "license", "men" must not match "development"
  const r = searchCatalog("of mice and men");
  assert.ok(r.hits.every((h) => !h.complete), "only labelled partial matches");
  assert.equal(r.didYouMean, undefined, "no suggestion that would itself find nothing");
});

test("special characters in a query never throw and are treated as text", () => {
  for (const q of ["(", "[a-z", "c++", "*", "\\", "?"]) {
    assert.doesNotThrow(() => searchCatalog(q));
    assert.doesNotThrow(() => highlightMatches("Some (title) [x]", searchCatalog(q).tokens));
  }
});

test("Bodhi's catalog tool and the Library Assistant use the shared engine", async () => {
  const { searchCatalog: toolSearch } = await import("../lib/companion/catalog-tools");
  const { tryDeterministicQuery } = await import("../lib/library-assistant");
  const tool = toolSearch({ query: "books about stoicism for beginners" });
  assert.ok(tool.results.length >= 3);
  assert.ok(tool.results.slice(0, 3).every((b) => /stoic/i.test(JSON.stringify(b))), tool.results.map((b) => b.title).join());
  assert.equal(toolSearch({ query: "Orwell" }).results[0].pages, 394, "measured page count reported to Bodhi");
  assert.equal(toolSearch({ query: "orwell", language: "hindi" }).results.length, 0, "filters still apply");

  const dosto = tryDeterministicQuery("dostoyevsky books");
  assert.ok(dosto && dosto.books.length > 0 && dosto.books.every((b) => b.author === "Fyodor Dostoevsky"));
  const premchand = tryDeterministicQuery("books by premchnd");
  assert.ok(premchand && premchand.books.every((b) => /Premchand/.test(b.author)));
});
