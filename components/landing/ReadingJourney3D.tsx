"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { BOOKS } from "@/data/books";
import { DAILY_READING_GOAL_SECONDS } from "@/lib/reader-storage";

type StageId = "discover" | "read" | "annotate" | "remember";

interface Stage {
  id: StageId;
  num: string;
  title: string;
  body: string;
}

const GOAL_MINUTES = Math.round(DAILY_READING_GOAL_SECONDS / 60);

// Copy describes only features that exist in the codebase today
const STAGES: Stage[] = [
  {
    id: "discover",
    num: "01",
    title: "Discover",
    body: `Search ${BOOKS.length} books by title, author or tag, then narrow by genre, philosophical tradition or technical track.`,
  },
  {
    id: "read",
    num: "02",
    title: "Read",
    body: "Open any book in a focused PDF reader with single or two-page spreads, zoom, reading modes and in-book search. Your page is saved as you go.",
  },
  {
    id: "annotate",
    num: "03",
    title: "Annotate & translate",
    body: "Highlight passages, write notes, sketch on pages and bookmark. Translate the open spread into Hindi, Hinglish or English with AI.",
  },
  {
    id: "remember",
    num: "04",
    title: "Remember",
    body: `${GOAL_MINUTES} focused minutes a day keeps your reading streak alive. Finish a book to earn a completion certificate.`,
  },
];

const AUTO_ADVANCE_MS = 5500;

const pick = (id: string, fallback: number) => BOOKS.find((b) => b.id === id) || BOOKS[fallback];
const FEATURED = pick("1984", 0);
const FAN = [pick("godan", 1), FEATURED, pick("meditations", 2)];
const DEMO_PAGE = Math.max(1, Math.round((Number(FEATURED.pages) || 100) * 0.13));

export default function ReadingJourney3D() {
  const [active, setActive] = useState<number>(0);
  const [autoplay, setAutoplay] = useState<boolean>(true);
  const [inView, setInView] = useState<boolean>(false);
  const [reducedMotion, setReducedMotion] = useState<boolean>(false);
  const sectionRef = useRef<HTMLElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Only animate while the section is on screen
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), {
      threshold: 0.35,
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!autoplay || !inView || reducedMotion) return;
    const timer = setTimeout(() => setActive((prev) => (prev + 1) % STAGES.length), AUTO_ADVANCE_MS);
    return () => clearTimeout(timer);
  }, [active, autoplay, inView, reducedMotion]);

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  const selectStage = (idx: number) => {
    setAutoplay(false);
    setActive(idx);
  };

  const replay = () => {
    setActive(0);
    setAutoplay(true);
  };

  // Gentle pointer parallax (fine pointers only), batched into one frame
  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (reducedMotion || e.pointerType !== "mouse" || !sceneRef.current) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(() => {
        sceneRef.current?.style.setProperty("--tilt-x", `${(x * 10).toFixed(2)}deg`);
        sceneRef.current?.style.setProperty("--tilt-y", `${(-y * 8).toFixed(2)}deg`);
      });
    },
    [reducedMotion]
  );

  const resetTilt = () => {
    sceneRef.current?.style.setProperty("--tilt-x", "0deg");
    sceneRef.current?.style.setProperty("--tilt-y", "0deg");
  };

  const stage = STAGES[active].id;
  const is = (id: StageId) => stage === id;

  // Floating layer: lifts toward the viewer when its stage is active
  const layerStyle = (visible: boolean, z: number, extra = ""): React.CSSProperties => ({
    transform: `translateZ(${visible ? z : z - 40}px) ${extra}`,
    opacity: visible ? 1 : 0,
    transition: reducedMotion ? "none" : "opacity 500ms ease, transform 700ms cubic-bezier(0.16, 1, 0.3, 1)",
    pointerEvents: visible ? "auto" : "none",
  });

  return (
    <section
      ref={sectionRef}
      id="how-it-works"
      aria-labelledby="journey-heading"
      className="relative py-20 border-t border-[var(--border)]/80 overflow-hidden"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mb-10 lg:mb-14">
          <div className="flex items-center gap-3 text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--accent)] mb-3">
            <span className="h-px w-8 bg-[var(--accent)]/60" />
            <span>The Reading Workflow</span>
          </div>
          <h2
            id="journey-heading"
            className="text-3xl sm:text-4xl lg:text-5xl font-bold font-serif tracking-tight text-[var(--foreground)] leading-[1.1]"
          >
            From shelf to memory, <span className="text-gold-gradient italic">in four quiet steps.</span>
          </h2>
          <p className="text-sm sm:text-base text-[var(--text-secondary)] mt-4 leading-relaxed">
            Everything below happens inside Reader&apos;s HUB. Pick a step to see it, or let the scene play through.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-8 lg:gap-12 items-center">
          {/* Step selector */}
          <div className="order-2 lg:order-1">
            <ol className="flex lg:flex-col gap-2 lg:gap-3 overflow-x-auto lg:overflow-visible pb-2 lg:pb-0 -mx-4 px-4 lg:mx-0 lg:px-0 snap-x" role="tablist" aria-label="Reading workflow steps">
              {STAGES.map((s, idx) => {
                const selected = idx === active;
                return (
                  <li key={s.id} className="snap-start shrink-0 w-[78%] sm:w-[46%] lg:w-auto">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      aria-controls="journey-scene"
                      onClick={() => selectStage(idx)}
                      className={`group relative w-full h-full text-left rounded-2xl border p-4 lg:p-5 transition-all duration-300 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)] ${
                        selected
                          ? "bg-[var(--card)] border-[var(--accent)]/50 shadow-[0_18px_40px_-24px_rgba(20,27,45,0.35)]"
                          : "bg-transparent border-[var(--border)] hover:bg-[var(--card)]/70 hover:border-[var(--accent)]/30"
                      }`}
                    >
                      <div className="flex items-baseline gap-3">
                        <span
                          className={`font-mono text-xs font-bold tracking-wider ${
                            selected ? "text-[var(--accent)]" : "text-[var(--text-secondary)]"
                          }`}
                        >
                          {s.num}
                        </span>
                        <span className="text-base lg:text-lg font-bold font-serif text-[var(--foreground)]">{s.title}</span>
                      </div>
                      <p
                        className={`text-xs sm:text-sm leading-relaxed text-[var(--text-secondary)] mt-1.5 pl-8 ${
                          selected ? "" : "lg:line-clamp-1"
                        }`}
                      >
                        {s.body}
                      </p>
                      {selected && autoplay && inView && !reducedMotion && (
                        <span className="absolute left-4 right-4 bottom-0 h-[2px] rounded-full bg-[var(--border)] overflow-hidden" aria-hidden="true">
                          <span
                            key={`progress-${active}`}
                            className="block h-full bg-gradient-to-r from-[var(--accent-glow)] to-[var(--primary)]"
                            style={{ animation: `journeyProgress ${AUTO_ADVANCE_MS}ms linear forwards` }}
                          />
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ol>

            <div className="flex flex-wrap items-center gap-3 mt-6">
              <Link
                href="/library"
                className="px-6 py-3 rounded-xl bg-gradient-to-r from-[var(--primary)] to-[var(--accent-secondary)] text-[var(--primary-foreground)] font-bold text-sm shadow-lg hover:shadow-[0_0_24px_var(--theme-glow)] hover:-translate-y-0.5 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
              >
                Start Reading
              </Link>
              <Link
                href={`/book/${FEATURED.id}`}
                className="px-5 py-3 rounded-xl border border-[var(--border)] bg-[var(--card)] hover:border-[var(--accent)]/50 text-[var(--foreground)] font-semibold text-sm transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                Try it on {FEATURED.title}
              </Link>
              <button
                type="button"
                onClick={replay}
                className="text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--accent)] underline-offset-4 hover:underline transition-colors cursor-pointer"
              >
                ↺ Replay
              </button>
            </div>
          </div>

          {/* 3D scene */}
          <div
            className="order-1 lg:order-2 relative h-[360px] sm:h-[440px] lg:h-[500px] select-none"
            style={{ perspective: "1400px" }}
            onPointerMove={handlePointerMove}
            onPointerLeave={resetTilt}
          >
            <div
              id="journey-scene"
              role="tabpanel"
              aria-label={`${STAGES[active].title} — illustrative preview`}
              ref={sceneRef}
              className="absolute inset-0"
              style={{
                transformStyle: "preserve-3d",
                transform: "rotateX(calc(16deg + var(--tilt-y, 0deg))) rotateY(calc(-10deg + var(--tilt-x, 0deg)))",
                transition: reducedMotion ? "none" : "transform 400ms ease-out",
              }}
            >
              {/* Ivory desk surface */}
              <div
                className="absolute left-[4%] right-[4%] top-[14%] bottom-[6%] rounded-[28px] border border-[var(--border)]"
                style={{
                  transform: "translateZ(-30px)",
                  background:
                    "linear-gradient(145deg, color-mix(in srgb, var(--card) 96%, var(--accent-glow)), color-mix(in srgb, var(--secondary) 92%, var(--background)))",
                  boxShadow: "0 40px 80px -40px rgba(20,27,45,0.35), inset 0 1px 0 rgba(255,255,255,0.6)",
                }}
              >
                <div
                  className="absolute inset-0 rounded-[28px] opacity-60"
                  style={{
                    backgroundImage:
                      "linear-gradient(color-mix(in srgb, var(--foreground) 5%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--foreground) 5%, transparent) 1px, transparent 1px)",
                    backgroundSize: "28px 28px",
                  }}
                />
              </div>

              {/* Open book — the constant centrepiece */}
              <div
                className="absolute left-1/2 top-[30%] w-[62%] sm:w-[54%] aspect-[1.45]"
                style={{ transformStyle: "preserve-3d", transform: "translateX(-50%) translateZ(20px)" }}
              >
                <div className="absolute inset-0 flex rounded-md overflow-hidden" style={{ boxShadow: "0 30px 50px -22px rgba(20,27,45,0.45)" }}>
                  {[0, 1].map((side) => (
                    <div
                      key={side}
                      className="relative flex-1 bg-[var(--card)] p-[7%]"
                      style={{
                        background:
                          side === 0
                            ? "linear-gradient(90deg, var(--card) 80%, color-mix(in srgb, var(--foreground) 10%, var(--card)))"
                            : "linear-gradient(270deg, var(--card) 80%, color-mix(in srgb, var(--foreground) 10%, var(--card)))",
                      }}
                    >
                      {side === 0 && (
                        <div className="text-[8px] sm:text-[10px] font-serif font-bold text-[var(--foreground)] mb-2 truncate">
                          {FEATURED.title}
                        </div>
                      )}
                      {Array.from({ length: side === 0 ? 7 : 8 }).map((_, line) => {
                        const highlighted = side === 1 && line === 2 && (is("annotate") || is("remember"));
                        return (
                          <div
                            key={line}
                            className="h-[5px] sm:h-[6px] rounded-full mb-[7%] transition-colors duration-500"
                            style={{
                              width: `${[92, 84, 96, 70, 88, 94, 62, 80][line]}%`,
                              background: highlighted
                                ? "color-mix(in srgb, var(--accent-glow) 75%, transparent)"
                                : "color-mix(in srgb, var(--foreground) 12%, transparent)",
                            }}
                          />
                        );
                      })}
                      <div className="absolute bottom-[5%] left-0 right-0 text-center font-mono text-[7px] sm:text-[8px] text-[var(--text-secondary)]">
                        {side === 0 ? DEMO_PAGE : DEMO_PAGE + 1}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 01 Discover — cover fan + search */}
              <div className="absolute left-[8%] top-[4%] flex items-end gap-2 sm:gap-3" style={layerStyle(is("discover"), 90)}>
                {FAN.map((b, idx) => (
                  <Link
                    key={b.id}
                    href={`/book/${b.id}`}
                    tabIndex={is("discover") ? 0 : -1}
                    className="relative block w-[56px] h-[84px] sm:w-[78px] sm:h-[116px] rounded-md overflow-hidden border border-[var(--border)] shadow-xl transition-transform duration-300 hover:-translate-y-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                    style={{ transform: `rotate(${(idx - 1) * 7}deg) translateY(${idx === 1 ? -10 : 0}px)` }}
                  >
                    <Image src={b.cover} alt={b.title} fill sizes="78px" className="object-cover" />
                  </Link>
                ))}
              </div>
              <div
                className="absolute right-[8%] top-[10%] rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 shadow-lg flex items-center gap-2"
                style={layerStyle(is("discover"), 120)}
              >
                <span className="text-[var(--accent)] text-xs" aria-hidden="true">⌕</span>
                <span className="text-[10px] sm:text-xs text-[var(--text-secondary)]">
                  Search {BOOKS.length} books…
                </span>
              </div>

              {/* 02 Read — progress card */}
              <div
                className="absolute right-[6%] bottom-[12%] w-[46%] sm:w-[36%] rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 shadow-lg"
                style={layerStyle(is("read"), 110)}
              >
                <div className="flex items-center justify-between text-[10px] sm:text-xs">
                  <span className="font-semibold text-[var(--foreground)] truncate">{FEATURED.title}</span>
                  <span className="font-mono text-[var(--text-secondary)] shrink-0 ml-2">
                    p. {DEMO_PAGE} / {FEATURED.pages}
                  </span>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-[var(--secondary)] overflow-hidden">
                  <div className="h-full w-[13%] rounded-full bg-gradient-to-r from-[var(--accent-glow)] to-[var(--primary)]" />
                </div>
                <div className="mt-1.5 text-[9px] sm:text-[10px] text-[var(--text-secondary)]">Position saved automatically</div>
              </div>
              <div
                className="absolute left-[8%] top-[12%] rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 shadow-md text-[10px] sm:text-xs font-semibold text-[var(--foreground)]"
                style={layerStyle(is("read"), 100)}
              >
                ◧ Two-page spread · Focus mode
              </div>

              {/* 03 Annotate & translate */}
              <div
                className="absolute right-[5%] top-[14%] w-[40%] sm:w-[32%] rounded-xl border border-[var(--accent)]/40 bg-[var(--card)] p-3 shadow-lg"
                style={layerStyle(is("annotate"), 130, "rotate(2deg)")}
              >
                <div className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-[var(--accent)]">
                  Note · p. {DEMO_PAGE + 1}
                </div>
                <div className="mt-1 text-[10px] sm:text-xs text-[var(--foreground)] leading-snug">
                  Compare with the idea of doublethink later.
                </div>
              </div>
              <div
                className="absolute left-[7%] bottom-[12%] flex gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--card)] p-1.5 shadow-lg"
                style={layerStyle(is("annotate"), 110)}
              >
                {["हिन्दी", "Hinglish", "English"].map((lang, idx) => (
                  <span
                    key={lang}
                    className={`px-2 py-1 rounded-lg text-[10px] sm:text-xs font-semibold ${
                      idx === 0
                        ? "bg-gradient-to-r from-[var(--primary)] to-[var(--accent-secondary)] text-[var(--primary-foreground)]"
                        : "text-[var(--text-secondary)]"
                    }`}
                  >
                    {lang}
                  </span>
                ))}
              </div>

              {/* 04 Remember — streak + certificate */}
              <div
                className="absolute left-[7%] top-[10%] w-[38%] sm:w-[30%] rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 shadow-lg"
                style={layerStyle(is("remember"), 120)}
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg" aria-hidden="true">🪔</span>
                  <div>
                    <div className="text-[10px] sm:text-xs font-bold text-[var(--foreground)]">Daily goal lit</div>
                    <div className="text-[9px] sm:text-[10px] text-[var(--text-secondary)]">{GOAL_MINUTES} min of focused reading</div>
                  </div>
                </div>
                <div className="mt-2 flex gap-1" aria-hidden="true">
                  {Array.from({ length: 7 }).map((_, d) => (
                    <span
                      key={d}
                      className="h-2 flex-1 rounded-sm"
                      style={{
                        background: d < 5 ? "var(--accent-glow)" : "color-mix(in srgb, var(--foreground) 10%, transparent)",
                      }}
                    />
                  ))}
                </div>
              </div>
              <div
                className="absolute right-[6%] bottom-[10%] w-[44%] sm:w-[34%] rounded-xl p-[2px] shadow-xl"
                style={{
                  ...layerStyle(is("remember"), 140, "rotate(-3deg)"),
                  background: "linear-gradient(135deg, var(--accent-glow), var(--primary), var(--accent-secondary))",
                }}
              >
                <div className="rounded-[10px] bg-[var(--card)] p-3 text-center">
                  <div className="text-[8px] sm:text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--accent)]">
                    Certificate of Completion
                  </div>
                  <div className="mt-1 text-xs sm:text-sm font-serif font-bold text-[var(--foreground)] truncate">
                    {FEATURED.title}
                  </div>
                  <div className="text-[9px] sm:text-[10px] text-[var(--text-secondary)] truncate">{FEATURED.author}</div>
                </div>
              </div>
            </div>

            <div className="absolute bottom-0 right-0 text-[10px] text-[var(--text-secondary)] bg-[var(--card)]/80 border border-[var(--border)] rounded-full px-2.5 py-1 backdrop-blur">
              Illustrative preview · not your data
            </div>
          </div>
        </div>
      </div>

      <style>{`@keyframes journeyProgress { from { width: 0%; } to { width: 100%; } }`}</style>
    </section>
  );
}
