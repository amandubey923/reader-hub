/**
 * Measures the real page count of every catalogue PDF (public/pdfs) and writes data/pdf-page-counts.json.
 * Read-only for books.json and the PDFs; run with: npx tsx scripts/compute-pdf-page-counts.ts
 *
 * The catalogue's `pages` field was entered by hand and is sometimes wrong (e.g. 1 page, or a print edition's
 * count). Discovery features (length filters, sorting, related books) use these measured counts when available.
 */

import fs from "fs";
import path from "path";
import { PDFDocument } from "pdf-lib";

interface CatalogBook {
  id: string;
  pdf: string;
  pages: number | string;
}

async function main() {
  const root = process.cwd();
  const books: CatalogBook[] = JSON.parse(fs.readFileSync(path.join(root, "data", "books.json"), "utf8"));
  const counts: Record<string, number> = {};
  const failed: { id: string; reason: string }[] = [];

  for (const [i, book] of books.entries()) {
    const file = path.join(root, "public", decodeURIComponent(book.pdf).replace(/^\//, ""));
    try {
      const bytes = fs.readFileSync(file);
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
      const n = doc.getPageCount();
      if (n > 0) counts[book.id] = n;
      else failed.push({ id: book.id, reason: "zero pages" });
    } catch (err: any) {
      failed.push({ id: book.id, reason: String(err?.message || err).slice(0, 120) });
    }
    if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${books.length}`);
  }

  const out = {
    generatedAt: new Date().toISOString(),
    source: "Measured from public/pdfs with pdf-lib (scripts/compute-pdf-page-counts.ts)",
    counts,
    failed,
  };
  fs.writeFileSync(path.join(root, "data", "pdf-page-counts.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(`Measured ${Object.keys(counts).length}/${books.length} PDFs; ${failed.length} failed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
