"use client";

import React, { useMemo, useState } from "react";
import { useLibrary } from "@/context/LibraryContext";
import { useAuth } from "@/context/AuthContext";
import { CATEGORIES, PHILOSOPHY_SUBCATEGORIES, TECHNICAL_SUBCATEGORIES } from "@/data/books";
import { DiscoveryInterests, generateRecommendations } from "@/lib/recommendations";
import { useDiscoveryInterests } from "@/lib/discovery-interests";
import { ALL_LANGUAGES } from "@/lib/search/book-meta";
import BookCard from "@/components/BookCard";

interface SmartRecommendationsProps {
  maxSections?: number;
  className?: string;
}

const INTEREST_CATEGORIES = CATEGORIES.filter((c) => c !== "All") as string[];
const INTEREST_TOPICS = [
  ...PHILOSOPHY_SUBCATEGORIES.filter((s) => s !== "All Philosophy"),
  ...TECHNICAL_SUBCATEGORIES.filter((s) => s !== "All Technical"),
] as string[];
// Languages with a meaningful number of books (translations like "Greek (Eng Trans)" are readable in English)
const INTEREST_LANGUAGES = ALL_LANGUAGES.filter((l) => !/trans/i.test(l)).slice(0, 6);

function ToggleChips({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <div>
      <div className="text-xs font-medium text-[var(--text-secondary)] mb-2">{label}</div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
        {options.map((o) => {
          const active = selected.includes(o);
          return (
            <button
              key={o}
              type="button"
              aria-pressed={active}
              onClick={() => onToggle(o)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                active
                  ? "bg-[var(--primary)] text-[var(--primary-foreground)] font-bold shadow-sm"
                  : "bg-[var(--secondary)] text-[var(--text-secondary)] hover:text-[var(--foreground)] border border-[var(--border)]"
              }`}
            >
              {active && <span aria-hidden="true">✓ </span>}
              {o}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function InterestPicker({
  interests,
  onSave,
  onClose,
}: {
  interests: DiscoveryInterests;
  onSave: (next: DiscoveryInterests) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<DiscoveryInterests>(interests);
  const toggle = (group: keyof DiscoveryInterests, value: string) =>
    setDraft((prev) => ({
      ...prev,
      [group]: prev[group].includes(value) ? prev[group].filter((v) => v !== value) : [...prev[group], value],
    }));

  return (
    <div className="glass-card rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5 sm:p-6 space-y-4 shadow-xl" role="region" aria-label="Reading interests">
      <div>
        <h4 className="font-serif font-bold text-base text-[var(--foreground)]">What do you like to read?</h4>
        <p className="text-xs text-[var(--text-secondary)] mt-1">
          Optional. Saved only in this browser on this device, never uploaded. Recommendations still work without it.
        </p>
      </div>
      <ToggleChips label="Categories" options={INTEREST_CATEGORIES} selected={draft.categories} onToggle={(v) => toggle("categories", v)} />
      <ToggleChips label="Topics & traditions" options={INTEREST_TOPICS} selected={draft.subgroups} onToggle={(v) => toggle("subgroups", v)} />
      <ToggleChips label="Languages I read" options={INTEREST_LANGUAGES} selected={draft.languages} onToggle={(v) => toggle("languages", v)} />
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          onClick={() => {
            onSave(draft);
            onClose();
          }}
          className="px-5 py-2 rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-bold shadow-md hover:opacity-90 transition-all cursor-pointer"
        >
          Save interests
        </button>
        <button
          type="button"
          onClick={() => {
            onSave({ categories: [], subgroups: [], languages: [] });
            onClose();
          }}
          className="px-4 py-2 rounded-xl bg-[var(--secondary)] border border-[var(--border)] text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--foreground)] cursor-pointer"
        >
          Clear interests
        </button>
        <button type="button" onClick={onClose} className="px-3 py-2 text-xs text-[var(--text-secondary)] hover:text-[var(--foreground)] cursor-pointer">
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function SmartRecommendations({
  maxSections = 3,
  className = "",
}: SmartRecommendationsProps) {
  const { readingHistory, favorites, stats } = useLibrary();
  const { user } = useAuth();
  const { interests, save } = useDiscoveryInterests(user?.uid);
  const [pickerOpen, setPickerOpen] = useState(false);
  const completedIds = stats?.completedBookIds;

  const results = useMemo(() => {
    return generateRecommendations(readingHistory, favorites, undefined, { interests, completedIds });
  }, [readingHistory, favorites, interests, completedIds]);

  const interestCount = interests.categories.length + interests.subgroups.length + interests.languages.length;
  const displaySections = results.sections.slice(0, maxSections);
  if (displaySections.length === 0 && !pickerOpen) return null;

  return (
    <section className={"w-full space-y-10 text-left min-w-0 " + className}>
      <div className="flex flex-wrap items-center justify-end gap-2 -mb-6">
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          aria-expanded={pickerOpen}
          className="px-3 py-1.5 rounded-xl border border-[var(--border)] bg-[var(--secondary)] text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--foreground)] cursor-pointer"
        >
          {interestCount > 0 ? `Your interests (${interestCount}) · Edit` : "Tune recommendations"}
        </button>
      </div>

      {pickerOpen && <InterestPicker interests={interests} onSave={save} onClose={() => setPickerOpen(false)} />}

      {displaySections.map((sec) => (
        <div key={sec.id} className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="text-xl sm:text-2xl p-2 rounded-2xl bg-[var(--accent)]/10 border border-[var(--accent)]/20 shadow-xs">
                {sec.icon}
              </span>
              <div>
                <h3 className="font-serif font-bold text-base sm:text-xl text-[var(--foreground)] tracking-tight">
                  {sec.title}
                </h3>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                  {sec.subtitle}
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-5 w-full min-w-0">
            {sec.books.map((book) => (
              <BookCard key={book.id} book={book} reason={sec.reasons[book.id]} />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
