/**
 * Full catalogue metadata audit (a controlled maintenance task, never run on user visits).
 *
 *   npx tsx scripts/audit-catalogue.ts           → report only (data/catalogue-audit.json)
 *   npx tsx scripts/audit-catalogue.ts --apply   → also correct verified page-count discrepancies in data/books.json
 *
 * For every book it checks the stable ID, title/author/language/category, the PDF file it points to
 * (exists, SHA-256 matches the catalogued fileHash, not shared with another book), the real page count
 * (PDF.js numPages — the same engine the reader uses — cross-checked with pdf-lib), and the cover file.
 *
 * Only `pages` is ever corrected: it describes the PDF the book actually opens, so it is set to that file's real
 * page count whenever PDF.js and pdf-lib agree (identity problems are still reported separately for review). Titles, authors and IDs are never rewritten automatically: the PDF's embedded
 * metadata is often wrong, so differences there are reported for human review, not "fixed".
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execSync } from "child_process";
import { PDFDocument } from "pdf-lib";

interface CatalogBook {
  id: string;
  title: string;
  author: string;
  category: string;
  language: string;
  cover: string;
  pdf: string;
  pages: number;
  fileHash?: string;
}

type Status = "verified" | "corrected" | "review" | "unavailable";

interface BookAudit {
  id: string;
  title: string;
  status: Status;
  catalogPages: number;
  pdfPages: number | null;
  pdfLibPages: number | null;
  /** True when the catalogue page count is replaced by the PDF's verified count. */
  pagesCorrected: boolean;
  issues: string[];
  notes: string[];
  embeddedTitle?: string;
  embeddedAuthor?: string;
}

const root = process.cwd();
const APPLY = process.argv.includes("--apply");
const BOOKS_FILE = path.join(root, "data", "books.json");
const SAFE_ID = /^[^:\s/\\]{1,200}$/;

const normalize = (s: string) =>
  (s || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

async function main() {
  const raw = fs.readFileSync(BOOKS_FILE, "utf8");
  const books: CatalogBook[] = JSON.parse(raw);
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const categoriesSource = fs.readFileSync(path.join(root, "data", "books.ts"), "utf8");
  const categoryBlock = categoriesSource.match(/export const CATEGORIES = \[([\s\S]*?)\]/)?.[1] || "";
  const knownCategories = new Set(Array.from(categoryBlock.matchAll(/"([^"]+)"/g)).map((m) => m[1]));

  // Exact file names as stored in git (= what Linux hosting serves). Windows matches names case-insensitively,
  // so a link like /pdfs/YouAreLife.pdf works locally but 404s in production when the file is youarelife.pdf.
  let tracked: Set<string> | null = null;
  try {
    tracked = new Set(
      execSync("git -c core.quotepath=false ls-files public", { maxBuffer: 1e8 }).toString().split(/\r?\n/).filter(Boolean).map((f) => f.replace(/^public/, ""))
    );
  } catch {
    console.warn("git unavailable: exact-case path check skipped");
  }

  const idCount = new Map<string, number>();
  const pdfOwners = new Map<string, string[]>();
  const hashOwners = new Map<string, string[]>();
  const coverOwners = new Map<string, string[]>();
  for (const b of books) {
    idCount.set(b.id, (idCount.get(b.id) || 0) + 1);
    pdfOwners.set(b.pdf, [...(pdfOwners.get(b.pdf) || []), b.id]);
    coverOwners.set(b.cover, [...(coverOwners.get(b.cover) || []), b.id]);
  }

  const results: BookAudit[] = [];
  for (const [i, b] of books.entries()) {
    const issues: string[] = [];
    const notes: string[] = [];
    let pdfPages: number | null = null;
    let pdfLibPages: number | null = null;
    let embeddedTitle: string | undefined;
    let embeddedAuthor: string | undefined;
    let unavailable = false;

    // Identity and catalogue fields
    if ((idCount.get(b.id) || 0) > 1) issues.push("duplicate book ID");
    if (!SAFE_ID.test(b.id)) issues.push("unsafe book ID");
    if (!b.title?.trim()) issues.push("missing title");
    if (!b.author?.trim() || /^unknown$/i.test(b.author.trim())) issues.push("missing author");
    if (!b.language?.trim()) issues.push("missing language");
    if (!knownCategories.has(b.category)) issues.push(`unknown category "${b.category}"`);
    if ((pdfOwners.get(b.pdf) || []).length > 1) issues.push(`PDF shared with ${pdfOwners.get(b.pdf)!.filter((x) => x !== b.id).join(", ")}`);
    if ((coverOwners.get(b.cover) || []).length > 1) issues.push(`cover shared with ${coverOwners.get(b.cover)!.filter((x) => x !== b.id).join(", ")}`);
    if (!b.cover || !fs.existsSync(path.join(root, "public", decodeURIComponent(b.cover).replace(/^\//, "")))) issues.push("cover file missing");

    if (tracked && b.pdf && !tracked.has(decodeURIComponent(b.pdf))) issues.push("PDF path does not exactly match a tracked file (letter case or Unicode form) — 404 on Linux hosting");
    if (tracked && b.cover?.startsWith("/") && !tracked.has(decodeURIComponent(b.cover))) issues.push("cover path does not exactly match a tracked file — 404 on Linux hosting");

    // The PDF itself
    const file = path.join(root, "public", decodeURIComponent(b.pdf || "").replace(/^\//, ""));
    if (!b.pdf || !fs.existsSync(file)) {
      unavailable = true;
      issues.push("PDF file missing");
    } else {
      const bytes = fs.readFileSync(file);
      const hash = crypto.createHash("sha256").update(bytes).digest("hex");
      hashOwners.set(hash, [...(hashOwners.get(hash) || []), b.id]);
      if (!b.fileHash) notes.push("no catalogued fileHash to confirm the file");
      else if (b.fileHash !== hash) issues.push("PDF content does not match the catalogued fileHash");

      try {
        const task = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
        const doc = await task.promise;
        pdfPages = doc.numPages;
        const meta = await doc.getMetadata().catch(() => null);
        const info = (meta?.info || {}) as Record<string, unknown>;
        embeddedTitle = typeof info.Title === "string" && info.Title.trim() ? info.Title.trim() : undefined;
        embeddedAuthor = typeof info.Author === "string" && info.Author.trim() ? info.Author.trim() : undefined;
        await task.destroy();
      } catch (err: any) {
        unavailable = true;
        issues.push(`PDF.js could not open the file: ${String(err?.message || err).slice(0, 80)}`);
      }
      try {
        const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
        pdfLibPages = doc.getPageCount();
      } catch {
        notes.push("pdf-lib could not parse the file (PDF.js count used alone)");
      }
    }

    if (pdfPages !== null && pdfLibPages !== null && pdfPages !== pdfLibPages) {
      issues.push(`page engines disagree (PDF.js ${pdfPages}, pdf-lib ${pdfLibPages})`);
    }
    if (pdfPages !== null && pdfPages <= 2) notes.push(`very short PDF (${pdfPages} pages) — confirmed by the file itself`);
    if (pdfPages !== null && pdfPages >= 2000) notes.push(`very long PDF (${pdfPages} pages) — confirmed by the file itself`);

    // Embedded PDF metadata is only advisory: report clear contradictions, never overwrite from it
    if (embeddedTitle && b.title) {
      const t = normalize(embeddedTitle);
      const c = normalize(b.title);
      const overlap = c.split(" ").filter((w) => w.length > 3 && t.includes(w)).length;
      if (t.length > 3 && !/^(untitled|microsoft word|document|pdf|new document)/.test(t) && overlap === 0 && !t.includes(c) && !c.includes(t)) {
        notes.push(`PDF's embedded title is "${embeddedTitle.slice(0, 80)}" (advisory only; often a converter artefact)`);
      }
    }

    const identityConfirmed = Boolean(b.fileHash) && !issues.some((x) => x.includes("fileHash") || x.includes("PDF shared"));
    if (!identityConfirmed && !unavailable) notes.push("PDF identity not confirmed by a matching catalogued fileHash");
    const catalogPages = Number(b.pages) || 0;
    const enginesAgree = pdfPages !== null && (pdfLibPages === null || pdfLibPages === pdfPages);
    const pagesCorrected = enginesAgree && catalogPages !== pdfPages;
    let status: Status;
    if (unavailable) status = "unavailable";
    else if (issues.length > 0 || !identityConfirmed) status = "review";
    else if (pagesCorrected) status = "corrected";
    else status = "verified";

    results.push({ id: b.id, title: b.title, status, catalogPages, pdfPages, pdfLibPages, pagesCorrected, issues, notes, embeddedTitle, embeddedAuthor });
    if ((i + 1) % 50 === 0) console.log(`  audited ${i + 1}/${books.length}`);
  }

  for (const [hash, owners] of hashOwners) {
    if (owners.length > 1) {
      for (const id of owners) {
        const r = results.find((x) => x.id === id)!;
        r.issues.push(`identical PDF content also used by ${owners.filter((x) => x !== id).join(", ")} (${hash.slice(0, 10)}…)`);
        if (r.status === "verified" || r.status === "corrected") r.status = "review";
      }
    }
  }

  // Apply only verified page-count corrections; nothing else in the catalogue changes
  const corrections = results.filter((r) => r.pagesCorrected);
  if (APPLY && corrections.length) {
    const byId = new Map(corrections.map((r) => [r.id, r.pdfPages!]));
    const updated = books.map((b) => (byId.has(b.id) ? { ...b, pages: byId.get(b.id)! } : b));
    const eol = raw.includes("\r\n") ? "\r\n" : "\n";
    const serialised = JSON.stringify(updated, null, 2).replace(/\n/g, eol) + (raw.endsWith("\n") ? eol : "");
    fs.writeFileSync(BOOKS_FILE, serialised);
  }

  // Measured counts used by the app as the verified source (all books the PDF.js engine could open).
  // Never replaced by a worse run: if any previously measured book could not be measured now, keep the old file.
  const counts: Record<string, number> = {};
  for (const r of results) if (r.pdfPages !== null) counts[r.id] = r.pdfPages;
  const countsFile = path.join(root, "data", "pdf-page-counts.json");
  const previous: Record<string, number> = fs.existsSync(countsFile) ? JSON.parse(fs.readFileSync(countsFile, "utf8")).counts || {} : {};
  const lost = Object.keys(previous).filter((id) => books.some((b) => b.id === id) && counts[id] === undefined);
  if (lost.length) console.warn(`Not updating pdf-page-counts.json: ${lost.length} previously measured books could not be measured now.`);
  else fs.writeFileSync(
    countsFile,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: "PDF.js numPages of public/pdfs, cross-checked with pdf-lib (scripts/audit-catalogue.ts)",
        counts,
        failed: results.filter((r) => r.pdfPages === null).map((r) => ({ id: r.id, reason: r.issues.join("; ") })),
      },
      null,
      2
    ) + "\n"
  );

  const summary = {
    total: results.length,
    verified: results.filter((r) => r.status === "verified").length,
    corrected: results.filter((r) => r.status === "corrected").length,
    pageCountsCorrected: corrections.length,
    review: results.filter((r) => r.status === "review").length,
    unavailable: results.filter((r) => r.status === "unavailable").length,
    applied: APPLY,
  };
  fs.writeFileSync(
    path.join(root, "data", "catalogue-audit.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), summary, books: results }, null, 2) + "\n"
  );
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
