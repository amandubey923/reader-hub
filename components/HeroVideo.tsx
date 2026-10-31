"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import Hero3DLayer from "./visual/Hero3DLayer";
import { BOOKS } from "@/data/books";

interface HeroVideoProps {
  onExploreClick?: () => void;
}

export default function HeroVideo({ onExploreClick }: HeroVideoProps) {
  const [videoError, setVideoError] = useState(false);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Pick 3 representative hero books for the 3D floating visual
  const heroBooks = [
    BOOKS.find((b) => b.id === "1984") || BOOKS[0],
    BOOKS.find((b) => b.id === "atomic-habits") || BOOKS[1],
    BOOKS.find((b) => b.id === "godan") || BOOKS[2],
  ].filter(Boolean);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mediaQuery.matches);

    const handleChange = (e: MediaQueryListEvent) => {
      setReducedMotion(e.matches);
    };
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  return (
    <section className="relative min-h-[620px] lg:min-h-[680px] flex items-center justify-center overflow-hidden pt-20 pb-16">
      {/* Background Video or Fallback */}
      {!reducedMotion && !videoError ? (
        <video
          ref={videoRef}
          autoPlay
          muted
          loop
          playsInline
          onLoadedData={() => setVideoLoaded(true)}
          onError={() => setVideoError(true)}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 scale-105 ${
            videoLoaded ? "opacity-30" : "opacity-0"
          }`}
        >
          <source src="/images/bg/bgvideo.mp4" type="video/mp4" />
        </video>
      ) : null}

      {/* Fallback Static Gradient / Texture */}
      {(reducedMotion || videoError || !videoLoaded) && (
        <div
          className="absolute inset-0 w-full h-full bg-cover bg-center opacity-20"
          style={{ backgroundImage: "url('/images/login.jpg')" }}
        />
      )}

      {/* 3D Depth Layer */}
      <Hero3DLayer />

      {/* Cinematic Dark Overlays */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: "linear-gradient(to bottom, color-mix(in srgb, var(--background) 85%, transparent), color-mix(in srgb, var(--background) 75%, transparent), var(--background))" }}
      />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: "radial-gradient(ellipse at center, color-mix(in srgb, var(--accent) 15%, transparent), transparent 60%, var(--background))" }}
      />

      {/* Hero Content Container */}
      <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 text-center flex flex-col items-center">
        {/* Subtle Pill Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[var(--card)] border border-[var(--border)] text-[var(--accent)] text-xs font-bold uppercase tracking-widest mb-6 backdrop-blur-xl shadow-md animate-fade-in">
          <span>Free Digital Library &amp; Reading Platform</span>
        </div>

        {/* Hero Title */}
        <h1 className="text-4xl sm:text-6xl lg:text-7xl font-bold tracking-tight text-[var(--foreground)] font-serif leading-[1.1] mb-6">
          Stories worth <span className="text-gold-gradient italic">reading.</span>
          <br />
          Ideas worth <span className="text-[var(--accent)]">remembering.</span>
        </h1>

        {/* Subtitle */}
        <p className="max-w-2xl text-base sm:text-lg text-[var(--text-secondary)] font-normal leading-relaxed mb-8">
          Welcome to <strong className="text-[var(--foreground)] font-semibold">Reader&apos;s HUB</strong> — a modern, fast, and completely free digital reading space. Explore timeless Hindi literature, iconic world classics, and philosophical treatises with zero barriers.
        </p>

        {/* CTAs */}
        <div className="flex flex-wrap items-center justify-center gap-4 mb-10">
          {onExploreClick ? (
            <button
              onClick={onExploreClick}
              className="px-8 py-4 rounded-xl bg-gradient-to-r from-[var(--primary)] to-[var(--accent-secondary)] hover:opacity-95 text-[var(--primary-foreground)] font-bold text-sm shadow-xl hover:shadow-[0_0_20px_var(--theme-glow)] hover:scale-105 transition-all cursor-pointer flex items-center gap-2"
            >
              <span>Explore Library</span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          ) : (
            <Link
              href="/library"
              className="px-8 py-4 rounded-xl bg-gradient-to-r from-[var(--primary)] to-[var(--accent-secondary)] hover:opacity-95 text-[var(--primary-foreground)] font-bold text-sm shadow-xl hover:shadow-[0_0_20px_var(--theme-glow)] hover:scale-105 transition-all flex items-center gap-2"
            >
              <span>Explore Library</span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </Link>
          )}

          <Link
            href="/library?sort=rating"
            className="px-8 py-4 rounded-xl bg-[var(--card)] hover:bg-[var(--secondary)] text-[var(--foreground)] border border-[var(--border)] hover:border-[var(--accent)]/50 font-semibold text-sm shadow-md transition-all backdrop-blur-md flex items-center gap-2 hover:scale-105"
          >
            <span>✨</span>
            <span>Discover a Book</span>
          </Link>
        </div>

        {/* Floating 3D Book Showcases */}
        <div className="hidden sm:flex items-center justify-center gap-6 my-4 perspective-1000">
          {heroBooks.map((b, idx) => (
            <Link
              key={b.id}
              href={`/book/${b.id}`}
              className={`group relative rounded-xl overflow-hidden book-shadow border border-[var(--border)]/70 hover:border-[var(--accent)] transition-all duration-300 transform hover:-translate-y-2 hover:rotate-0 ${
                idx === 0
                  ? "-rotate-6 scale-95 opacity-85 hover:opacity-100"
                  : idx === 1
                  ? "rotate-0 scale-105 z-10 shadow-2xl"
                  : "rotate-6 scale-95 opacity-85 hover:opacity-100"
              }`}
              style={{ width: "105px", height: "155px" }}
            >
              <Image
                src={b.cover}
                alt={b.title}
                fill
                sizes="105px"
                className="object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
                <span className="text-[9px] font-bold text-white truncate">
                  {b.title}
                </span>
              </div>
            </Link>
          ))}
        </div>

        {/* Quick Value Metrics with Real Live Data */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6 w-full max-w-3xl pt-8 border-t border-[var(--border)]/80 mt-4">
          <div className="text-center">
            <div className="text-2xl sm:text-3xl font-bold text-[var(--accent)] font-serif">
              {BOOKS.length}+
            </div>
            <div className="text-xs text-[var(--text-secondary)] mt-0.5 font-medium">
              Curated Volumes
            </div>
          </div>
          <div className="text-center">
            <div className="text-2xl sm:text-3xl font-bold text-[var(--accent)] font-serif">
              100%
            </div>
            <div className="text-xs text-[var(--text-secondary)] mt-0.5 font-medium">
              Free &amp; Open Access
            </div>
          </div>
          <div className="text-center">
            <div className="text-2xl sm:text-3xl font-bold text-[var(--accent)] font-serif">
              0s
            </div>
            <div className="text-xs text-[var(--text-secondary)] mt-0.5 font-medium">
              No Login Required
            </div>
          </div>
          <div className="text-center">
            <div className="text-2xl sm:text-3xl font-bold text-[var(--accent)] font-serif">
              Multi
            </div>
            <div className="text-xs text-[var(--text-secondary)] mt-0.5 font-medium">
              Hindi &amp; World Editions
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
