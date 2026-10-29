"use client";

import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import Link from "next/link";
import Logo from "@/components/Logo";
import { SlideProps } from "./shared";
import { DiscoverSlide, ReaderSlide, WelcomeSlide } from "./slides-intro";
import { BeginSlide, JourneySlide, UnderstandSlide } from "./slides-journey";

const AuthModal = dynamic(() => import("@/components/auth/AuthModal"), { ssr: false });

const SLIDES: { id: string; label: string; Component: React.ComponentType<SlideProps> }[] = [
  { id: "welcome", label: "Welcome to Reader's HUB", Component: WelcomeSlide },
  { id: "discover", label: "Discover your next book", Component: DiscoverSlide },
  { id: "reader", label: "Your personal reading experience", Component: ReaderSlide },
  { id: "understand", label: "Understand every page", Component: UnderstandSlide },
  { id: "journey", label: "Remember your reading journey", Component: JourneySlide },
  { id: "begin", label: "Begin your reading journey", Component: BeginSlide },
];

const TRANSITION_MS = 750;
const SWIPE_THRESHOLD_PX = 60;

const noopSubscribe = () => () => {};

/** False during SSR and hydration, true afterwards — portals need `document`, and markup must match on hydrate. */
function useIsClient(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

/**
 * The app layout wraps pages in a `relative z-10` container, which is its own stacking context.
 * Portaling to <body> lets the landing sit above the app navbar and floating widgets without touching the layout.
 */
function BodyPortal({ children }: { children: React.ReactNode }) {
  const isClient = useIsClient();
  return isClient ? createPortal(children, document.body) : null;
}

/**
 * Shown on "/" while Firebase restores the session, so signed-in readers never see the landing flash.
 */
export function LandingSplash() {
  return (
    <BodyPortal>
      <LandingSplashScreen />
    </BodyPortal>
  );
}

function LandingSplashScreen() {
  return (
    <div
      data-theme="architect"
      className="rh-landing fixed inset-0 z-[60] flex items-center justify-center bg-[var(--background)]"
      role="status"
      aria-label="Loading Reader's HUB"
    >
      <div className="animate-pulse">
        <Logo size={56} />
      </div>
    </div>
  );
}

/**
 * Separate, full-screen six-slide introduction for logged-out visitors.
 * Always rendered in the Architect Ivory & Gold palette, independent of the reader's chosen app theme.
 */
export default function LandingExperience() {
  return (
    <BodyPortal>
      <LandingDeck />
    </BodyPortal>
  );
}

function LandingDeck() {
  const [index, setIndex] = useState(0);
  const [replayKey, setReplayKey] = useState(0);
  const [authOpen, setAuthOpen] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const scrollerRefs = useRef<(HTMLDivElement | null)[]>([]);
  const indexRef = useRef(0);
  const lockUntilRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  // A swipe that ends on a book cover must not also open that book
  const suppressClickUntilRef = useRef(0);

  const total = SLIDES.length;

  useEffect(() => {
    indexRef.current = index;
    scrollerRefs.current[index]?.scrollTo({ top: 0 });
  }, [index]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // The landing covers the app chrome, so the page underneath must not scroll, and horizontal swipes
  // between slides must not trigger the browser's swipe-to-go-back history navigation
  useEffect(() => {
    const html = document.documentElement;
    const originalOverflow = document.body.style.overflow;
    const originalOverscroll = html.style.overscrollBehaviorX;
    document.body.style.overflow = "hidden";
    html.style.overscrollBehaviorX = "none";
    return () => {
      document.body.style.overflow = originalOverflow;
      html.style.overscrollBehaviorX = originalOverscroll;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  const goTo = useCallback(
    (target: number) => {
      const next = Math.max(0, Math.min(total - 1, target));
      if (next === indexRef.current) return;
      const now = Date.now();
      if (now < lockUntilRef.current) return;
      lockUntilRef.current = now + (reducedMotion ? 120 : TRANSITION_MS);
      setIndex(next);
    },
    [total, reducedMotion]
  );

  const next = useCallback(() => goTo(indexRef.current + 1), [goTo]);
  const prev = useCallback(() => goTo(indexRef.current - 1), [goTo]);

  const replay = useCallback(() => {
    lockUntilRef.current = 0;
    setIndex(0);
    setReplayKey((k) => k + 1);
  }, []);

  // Keyboard navigation (disabled while the sign-in dialog is open or a form field has focus)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (authOpen || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;

      if (["ArrowRight", "ArrowDown", "PageDown"].includes(e.key) || (e.key === " " && target?.tagName !== "BUTTON")) {
        e.preventDefault();
        next();
      } else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(e.key)) {
        e.preventDefault();
        prev();
      } else if (e.key === "Home") {
        e.preventDefault();
        goTo(0);
      } else if (e.key === "End") {
        e.preventDefault();
        goTo(total - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [authOpen, goTo, next, prev, total]);

  // A slide whose content overflows (small screens) scrolls first; navigation happens at its edges
  const atEdge = (direction: 1 | -1) => {
    const el = scrollerRefs.current[indexRef.current];
    if (!el) return true;
    return direction > 0 ? el.scrollTop + el.clientHeight >= el.scrollHeight - 2 : el.scrollTop <= 2;
  };

  const onWheel = (e: React.WheelEvent) => {
    if (authOpen || Math.abs(e.deltaY) < 24 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    const direction = e.deltaY > 0 ? 1 : -1;
    if (!atEdge(direction)) return;
    if (direction > 0) next();
    else prev();
  };

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY };
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start || authOpen) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) > SWIPE_THRESHOLD_PX && Math.abs(dx) > Math.abs(dy) * 1.2) {
      suppressClickUntilRef.current = Date.now() + 500;
      if (dx < 0) next();
      else prev();
    } else if (Math.abs(dy) > SWIPE_THRESHOLD_PX * 1.5 && Math.abs(dy) > Math.abs(dx) * 1.5) {
      const direction = dy < 0 ? 1 : -1;
      if (atEdge(direction)) {
        suppressClickUntilRef.current = Date.now() + 500;
        if (direction > 0) next();
        else prev();
      }
    }
  };

  const onClickCapture = (e: React.MouseEvent) => {
    if (Date.now() < suppressClickUntilRef.current) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  // Mouse-driven parallax, batched to one style write per frame
  const onPointerMove = (e: React.PointerEvent) => {
    if (reducedMotion || e.pointerType !== "mouse" || !rootRef.current) return;
    const x = e.clientX / window.innerWidth - 0.5;
    const y = e.clientY / window.innerHeight - 0.5;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      rootRef.current?.style.setProperty("--px", (x * 2).toFixed(3));
      rootRef.current?.style.setProperty("--py", (y * 2).toFixed(3));
    });
  };

  const slideTransform = (i: number) => {
    if (i === index || reducedMotion) return "none";
    return i < index
      ? "translate3d(0, -7%, -160px) rotateX(8deg) scale(0.96)"
      : "translate3d(0, 7%, -160px) rotateX(-8deg) scale(0.96)";
  };

  return (
    <div
      ref={rootRef}
      data-theme="architect"
      className="rh-landing fixed inset-0 z-[60] overflow-hidden bg-[var(--background)] text-[var(--foreground)]"
      style={{ perspective: "1800px" }}
      onWheel={onWheel}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onClickCapture={onClickCapture}
      onPointerMove={onPointerMove}
      aria-roledescription="carousel"
      aria-label="Introduction to Reader's HUB"
    >
      {/* Ambient backdrop: drafting grid + warm light */}
      <div aria-hidden="true" className="rh-backdrop pointer-events-none absolute inset-0" />

      {/* Progress */}
      <div className="absolute inset-x-0 top-0 z-30 h-[3px] bg-[var(--border)]/60" aria-hidden="true">
        <div
          className="h-full bg-gradient-to-r from-[var(--accent-glow)] to-[var(--accent-secondary)]"
          style={{ width: `${((index + 1) / total) * 100}%`, transition: reducedMotion ? "none" : "width 700ms cubic-bezier(0.22,1,0.36,1)" }}
        />
      </div>

      {/* Header */}
      <header className="absolute inset-x-0 top-0 z-30 flex items-center justify-between px-5 pt-5 sm:px-8">
        <button type="button" onClick={replay} className="flex cursor-pointer items-center gap-2.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded-lg" aria-label="Reader's HUB — back to the first slide">
          <Logo size={34} />
          <span className="hidden font-serif text-lg font-bold tracking-tight text-[var(--foreground)] sm:inline">Reader&apos;s HUB</span>
        </button>
        <nav className="flex items-center gap-2 sm:gap-3" aria-label="Landing">
          <Link href="/library" className="hidden rounded-lg px-3 py-2 text-sm font-semibold text-[var(--text-secondary)] transition-colors hover:text-[var(--foreground)] sm:inline-block">
            Browse library
          </Link>
          <button
            type="button"
            onClick={() => setAuthOpen(true)}
            className="cursor-pointer rounded-xl border border-[var(--border)] bg-[var(--card)]/90 px-4 py-2 text-sm font-semibold text-[var(--foreground)] shadow-sm backdrop-blur transition-colors hover:border-[var(--accent)]/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            Log in
          </button>
        </nav>
      </header>

      {/* Slides */}
      {SLIDES.map(({ id, label, Component }, i) => {
        const isActive = i === index;
        return (
          <section
            key={`${id}-${replayKey}`}
            data-active={isActive ? "true" : "false"}
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${total}: ${label}`}
            aria-hidden={!isActive}
            inert={!isActive}
            className="rh-slide absolute inset-0"
            style={{
              opacity: isActive ? 1 : 0,
              transform: slideTransform(i),
              transition: reducedMotion ? "none" : `opacity ${TRANSITION_MS}ms ease, transform ${TRANSITION_MS}ms cubic-bezier(0.22,1,0.36,1)`,
              pointerEvents: isActive ? "auto" : "none",
              zIndex: isActive ? 10 : 1,
            }}
          >
            <div
              ref={(el) => {
                scrollerRefs.current[i] = el;
              }}
              className="h-full touch-pan-y overflow-y-auto overflow-x-hidden overscroll-contain"
            >
              <Component active={isActive} reducedMotion={reducedMotion} onNext={next} onAuth={() => setAuthOpen(true)} onReplay={replay} />
            </div>
          </section>
        );
      })}

      {/* Controls */}
      <div className="absolute inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 px-5 pb-5 sm:px-8 sm:pb-7">
        <div className="hidden font-mono text-xs text-[var(--text-secondary)] sm:block" aria-hidden="true">
          <span className="font-bold text-[var(--foreground)]">{String(index + 1).padStart(2, "0")}</span> / {String(total).padStart(2, "0")}
        </div>

        <div className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)]/85 px-3 py-2 shadow-sm backdrop-blur" role="tablist" aria-label="Choose a slide">
          {SLIDES.map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Slide ${i + 1}: ${s.label}`}
              title={s.label}
              onClick={() => goTo(i)}
              className="group flex h-5 cursor-pointer items-center focus:outline-none"
            >
              <span
                className={`block h-1.5 rounded-full transition-all duration-500 group-focus-visible:ring-2 group-focus-visible:ring-[var(--accent)] ${
                  i === index ? "w-7 bg-gradient-to-r from-[var(--accent-glow)] to-[var(--accent-secondary)]" : "w-1.5 bg-[var(--foreground)]/25 group-hover:bg-[var(--foreground)]/50"
                }`}
              />
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={prev}
            disabled={index === 0}
            aria-label="Previous slide"
            className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-[var(--border)] bg-[var(--card)]/90 text-[var(--foreground)] shadow-sm backdrop-blur transition-all hover:border-[var(--accent)]/50 disabled:cursor-default disabled:opacity-35 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            ←
          </button>
          {index < total - 1 ? (
            <button
              type="button"
              onClick={next}
              aria-label="Next slide"
              className="flex h-10 cursor-pointer items-center gap-2 rounded-full bg-[#141b2d] px-4 text-sm font-semibold text-[#f7f4ec] shadow-md transition-all hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              <span className="hidden sm:inline">Next</span> →
            </button>
          ) : (
            <button
              type="button"
              onClick={replay}
              aria-label="Replay the introduction"
              className="flex h-10 cursor-pointer items-center gap-2 rounded-full bg-[#141b2d] px-4 text-sm font-semibold text-[#f7f4ec] shadow-md transition-all hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              ↺ <span className="hidden sm:inline">Replay</span>
            </button>
          )}
        </div>
      </div>

      {/* Screen reader announcement of the current slide */}
      <p className="sr-only" aria-live="polite">
        Slide {index + 1} of {total}: {SLIDES[index].label}
      </p>

      <AuthModal isOpen={authOpen} onClose={() => setAuthOpen(false)} />
    </div>
  );
}
