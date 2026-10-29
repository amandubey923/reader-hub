import React from "react";
import Link from "next/link";
import { BOOKS } from "@/data/books";
import { FREE_TIER_LIMITS, PRO_ENFORCEMENT_ENABLED } from "@/lib/monetization-config";
import { DAILY_READING_GOAL_SECONDS } from "@/lib/reader-storage";

const GOAL_MINUTES = Math.round(DAILY_READING_GOAL_SECONDS / 60);

// Answers reflect current behaviour in the codebase; update alongside the features they describe
const FAQS: { q: string; a: React.ReactNode }[] = [
  {
    q: "Do I need an account to read?",
    a: `No. All ${BOOKS.length} books open without signing in. Signing in with Google is optional and lets your reading progress, favorites, notes and streak follow you to other devices.`,
  },
  {
    q: "Where are my progress and notes stored?",
    a: "On this device, in your browser's local storage. If you sign in, Reader's HUB also syncs them to your account so they can be restored when you sign in elsewhere.",
  },
  {
    q: "Can I translate what I'm reading?",
    a: PRO_ENFORCEMENT_ENABLED
      ? `Yes. Inside the reader, AI can translate the pages you have open into Hindi, Hinglish or English. Free readers get ${FREE_TIER_LIMITS.DAILY_TRANSLATION_SPREADS} translated spreads and ${FREE_TIER_LIMITS.DAILY_AI_QUERIES} Library Assistant questions per day.`
      : "Yes. Inside the reader, AI can translate the pages you have open into Hindi, Hinglish or English.",
  },
  {
    q: "How does the daily reading streak work?",
    a: `Active reading time inside a book counts toward a ${GOAL_MINUTES}-minute daily goal. Reach it and that day's diya lights up; consecutive days build your streak.`,
  },
  {
    q: "What happens when I finish a book?",
    a: "Reaching the last page marks the book as completed and issues a completion certificate you can download as a PDF.",
  },
  {
    q: "Can I annotate books?",
    a: "Yes. You can highlight text, write notes, draw on pages and add bookmarks while you read.",
  },
];

export default function ReaderFaq() {
  return (
    <section id="faq" aria-labelledby="faq-heading" className="py-20 border-t border-[var(--border)]/80">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)] gap-10 lg:gap-16">
        <div className="lg:sticky lg:top-28 self-start">
          <div className="flex items-center gap-3 text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--accent)] mb-3">
            <span className="h-px w-8 bg-[var(--accent)]/60" />
            <span>Questions</span>
          </div>
          <h2 id="faq-heading" className="text-3xl sm:text-4xl font-bold font-serif tracking-tight text-[var(--foreground)] leading-[1.1]">
            Good to know before <span className="text-gold-gradient italic">you open a book.</span>
          </h2>
          <p className="text-sm text-[var(--text-secondary)] mt-4 leading-relaxed">
            Something else on your mind?{" "}
            <Link href="/contact" className="font-semibold text-[var(--accent)] hover:underline underline-offset-4">
              Send a note
            </Link>
            .
          </p>
        </div>

        <div className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
          {FAQS.map((item) => (
            <details key={item.q} className="group py-1">
              <summary className="flex items-center justify-between gap-6 py-4 cursor-pointer list-none rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] [&::-webkit-details-marker]:hidden">
                <span className="text-sm sm:text-base font-semibold text-[var(--foreground)] group-open:text-[var(--accent)] transition-colors">
                  {item.q}
                </span>
                <span
                  className="shrink-0 w-7 h-7 rounded-full border border-[var(--border)] flex items-center justify-center text-[var(--accent)] text-sm transition-transform duration-300 group-open:rotate-45"
                  aria-hidden="true"
                >
                  +
                </span>
              </summary>
              <p className="pb-5 pr-12 text-sm text-[var(--text-secondary)] leading-relaxed">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
