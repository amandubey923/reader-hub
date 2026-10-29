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
 * Separate, full-screen introduction for logged-out visitors: six vertically scrolling sections.
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
  const [authOpen, setAuthOpen] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  // Sections animate in the first time they are seen; continuous animations run only while on screen
  const [revealed, setRevealed] = useState<boolean[]>(() => SLIDES.map((_, i) => i === 0));
  const [onScreen, setOnScreen] = useState<boolean[]>(() => SLIDES.map((_, i) => i === 0));

  const rootRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<(HTMLElement | null)[]>([]);
  const frameRef = useRef<number | null>(null);
  const scrollFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // The landing is its own scroll container above the app, so the page underneath must not scroll.
  // Focusing it lets Space, Page Up/Down and arrow keys scroll the landing natively.
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    rootRef.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === "undefined") {
      setRevealed(SLIDES.map(() => true));
      setOnScreen(SLIDES.map(() => true));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const updates = new Map<number, boolean>();
        entries.forEach((entry) => updates.set(Number((entry.target as HTMLElement).dataset.index), entry.isIntersecting));
        setOnScreen((prev) => prev.map((v, i) => (updates.has(i) ? updates.get(i)! : v)));
        setRevealed((prev) => prev.map((v, i) => v || updates.get(i) === true));
      },
      { root, threshold: 0.18 }
    );
    sectionRefs.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
    };
  }, []);

  // Reading-progress bar, updated at most once per frame
  const onScroll = () => {
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const root = rootRef.current;
      if (!root || !progressRef.current) return;
      const max = root.scrollHeight - root.clientHeight;
      progressRef.current.style.width = `${max > 0 ? Math.min(100, (root.scrollTop / max) * 100) : 100}%`;
    });
  };

  const scrollToSection = useCallback(
    (i: number) => {
      sectionRefs.current[i]?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
    },
    [reducedMotion]
  );

  const scrollToTop = useCallback(() => {
    rootRef.current?.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
  }, [reducedMotion]);

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

  return (
    <div
      ref={rootRef}
      data-theme="architect"
      tabIndex={-1}
      className="rh-landing fixed inset-0 z-[60] overflow-y-auto overflow-x-hidden overscroll-contain bg-[var(--background)] text-[var(--foreground)] focus:outline-none"
      onScroll={onScroll}
      onPointerMove={onPointerMove}
      aria-label="Introduction to Reader's HUB"
    >
      {/* Ambient backdrop: drafting grid + warm light (stays put while the content scrolls) */}
      <div aria-hidden="true" className="rh-backdrop pointer-events-none fixed inset-0" />

      {/* Header + scroll progress */}
      <header className="sticky top-0 z-30 bg-[var(--background)]/80 backdrop-blur-md">
        <div className="h-[3px] bg-[var(--border)]/60" aria-hidden="true">
          <div ref={progressRef} className="h-full w-0 bg-gradient-to-r from-[var(--accent-glow)] to-[var(--accent-secondary)]" />
        </div>
        <div className="flex items-center justify-between px-5 py-3 sm:px-8">
          <button type="button" onClick={scrollToTop} className="flex cursor-pointer items-center gap-2.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded-lg" aria-label="Reader's HUB — back to the top">
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
        </div>
      </header>

      {/* Six stacked sections */}
      <main className="relative">
        {SLIDES.map(({ id, label, Component }, i) => (
          <section
            key={id}
            id={`intro-${id}`}
            ref={(el) => {
              sectionRefs.current[i] = el;
            }}
            data-index={i}
            data-active={onScreen[i] ? "true" : "false"}
            data-revealed={revealed[i] ? "true" : "false"}
            aria-label={label}
            className="rh-slide relative flex min-h-[calc(100dvh-64px)] scroll-mt-16 flex-col [&>*]:w-full [&>*]:flex-1"
          >
            <Component
              active={revealed[i]}
              reducedMotion={reducedMotion}
              onNext={() => scrollToSection(Math.min(i + 1, SLIDES.length - 1))}
              onAuth={() => setAuthOpen(true)}
              onReplay={scrollToTop}
            />
          </section>
        ))}
      </main>

      <AuthModal isOpen={authOpen} onClose={() => setAuthOpen(false)} />
    </div>
  );
}
