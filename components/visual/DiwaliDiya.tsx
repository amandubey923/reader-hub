"use client";

import React, { useState, useRef, useEffect, useMemo } from "react";
import { useLibrary } from "@/context/LibraryContext";
import { getLocalDateKey, getPreviousDateKey, DAILY_READING_GOAL_SECONDS } from "@/lib/reader-storage";

export default function DiwaliDiya() {
  const { streakData, todayReadingSeconds, isTodayQualified, todayActiveSeconds, globalActiveSeconds } = useLibrary();
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const todayReadingMinutes = Math.floor(todayReadingSeconds / 60);
  const todayActiveMinutes = Math.floor(todayActiveSeconds / 60);
  const progressPercent = Math.min(100, Math.round((todayReadingSeconds / DAILY_READING_GOAL_SECONDS) * 100));

  // STRICT LIT CONDITION:
  // Must be strictly false for 0-14:59 (no flame, no glow, no flicker, no halo).
  // Only true when user has genuinely accumulated >= 15 minutes (900 seconds).
  const isLit = Boolean(isTodayQualified || todayReadingSeconds >= DAILY_READING_GOAL_SECONDS);

  // Close popover when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // Compute Last 7 Days History
  const last7Days = useMemo(() => {
    const days: { dateKey: string; label: string; qualified: boolean; minutes: number; isToday: boolean }[] = [];
    const todayKey = getLocalDateKey();

    let current = todayKey;
    for (let i = 0; i < 7; i++) {
      const parts = current.split("-").map(Number);
      const d = new Date(parts[0], parts[1] - 1, parts[2]);
      const dayName = d.toLocaleDateString("en-US", { weekday: "short" });
      const activity = streakData.daily[current];
      const secs = activity?.seconds || 0;
      const qual = Boolean(activity?.qualified || secs >= DAILY_READING_GOAL_SECONDS);

      days.unshift({
        dateKey: current,
        label: i === 0 ? "Today" : dayName,
        qualified: qual,
        minutes: Math.floor(secs / 60),
        isToday: i === 0,
      });

      current = getPreviousDateKey(current);
    }
    return days;
  }, [streakData, todayReadingSeconds]);

  return (
    <div className="relative inline-block text-left" ref={popoverRef}>
      {/* -------------------------------------------------------------
       * Theme-Aware CSS Keyframe Animations for Living Diya Flame
       * ------------------------------------------------------------- */}
      <style jsx>{`
        @keyframes flameOuterSway {
          0%, 100% {
            transform: scale(1, 1) rotate(0deg);
            opacity: 0.96;
          }
          25% {
            transform: scale(1.03, 0.98) rotate(-1.2deg);
            opacity: 0.92;
          }
          50% {
            transform: scale(0.97, 1.03) rotate(0.8deg);
            opacity: 1;
          }
          75% {
            transform: scale(1.02, 0.99) rotate(-0.5deg);
            opacity: 0.94;
          }
        }

        @keyframes flameCoreFlicker {
          0%, 100% {
            transform: scale(1, 1) translateY(0);
            opacity: 1;
          }
          30% {
            transform: scale(0.96, 1.05) translateY(-0.3px);
            opacity: 0.94;
          }
          65% {
            transform: scale(1.05, 0.96) translateY(0.2px);
            opacity: 1;
          }
        }

        @keyframes diyaAuraPulse {
          0%, 100% {
            transform: scale(1) translate(-50%, -50%);
            opacity: 0.45;
          }
          50% {
            transform: scale(1.22) translate(-50%, -50%);
            opacity: 0.72;
          }
        }

        .animate-flame-outer {
          transform-origin: 16px 18px;
          animation: flameOuterSway 1.5s ease-in-out infinite;
        }

        .animate-flame-core {
          transform-origin: 16px 16px;
          animation: flameCoreFlicker 0.95s ease-in-out infinite;
        }

        .animate-diya-aura {
          transform-origin: 0 0;
          animation: diyaAuraPulse 2.2s ease-in-out infinite;
        }

        @media (prefers-reduced-motion: reduce) {
          .animate-flame-outer,
          .animate-flame-core,
          .animate-diya-aura {
            animation: none !important;
          }
        }
      `}</style>

      {/* -------------------------------------------------------------
       * Navbar Diya Trigger Button
       * ------------------------------------------------------------- */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`group relative flex items-center gap-2 px-2.5 sm:px-3.5 py-1.5 rounded-2xl border transition-all duration-300 cursor-pointer select-none ${
          isLit
            ? "bg-[var(--card)] border-[var(--accent)]/50 shadow-[0_0_18px_var(--theme-glow,rgba(245,158,11,0.28))] hover:border-[var(--accent)] hover:shadow-[0_0_24px_var(--theme-glow,rgba(245,158,11,0.45))]"
            : "bg-[var(--card)] hover:bg-[var(--secondary)] border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--foreground)] hover:border-[var(--border)]"
        }`}
        title={
          isLit
            ? `Diwali Diya Lit! ${streakData.currentStreak} Day Streak (${todayReadingMinutes}m read today)`
            : todayReadingMinutes > 0
            ? `Reading in Progress: ${todayReadingMinutes}/15 min to light your Diya`
            : "Read 15 minutes today to light your Diwali Diya"
        }
        aria-label="Daily Reading Streak"
      >
        {/* Prominent Handcrafted SVG Diwali Diya Icon */}
        <div className="relative w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center flex-shrink-0 transition-transform duration-300 group-hover:scale-105">
          {/* Ambient Warm Aura Glow (STRICTLY ONLY WHEN QUALIFIED / 15m+) */}
          {isLit && (
            <div
              className="absolute top-2.5 left-1/2 w-6 h-6 rounded-full bg-[var(--accent)]/45 blur-[5px] pointer-events-none animate-diya-aura"
              aria-hidden="true"
            />
          )}

          {/* Theme-Aware SVG Artwork */}
          <svg
            className="w-7 h-7 sm:w-8 sm:h-8 overflow-visible"
            viewBox="0 0 32 32"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              {/* Theme-Aware Lit Diya Lamp Body Gradient */}
              <linearGradient id="diyaBodyLit" x1="4" y1="16.5" x2="28" y2="28" gradientUnits="userSpaceOnUse">
                <stop stopColor="var(--accent, #f59e0b)" />
                <stop offset="0.45" stopColor="var(--primary, #d97706)" />
                <stop offset="0.85" stopColor="#92400e" />
                <stop offset="1" stopColor="#78350f" />
              </linearGradient>

              {/* Theme-Aware Unlit Terracotta/Brass Body Gradient */}
              <linearGradient id="diyaBodyUnlit" x1="4" y1="16.5" x2="28" y2="28" gradientUnits="userSpaceOnUse">
                <stop stopColor="#64748b" stopOpacity="0.8" />
                <stop offset="0.6" stopColor="#475569" stopOpacity="0.9" />
                <stop offset="1" stopColor="#334155" />
              </linearGradient>

              {/* Outer Radiant Flame Gradient */}
              <linearGradient id="flameOuterGrad" x1="16" y1="2.5" x2="16" y2="19" gradientUnits="userSpaceOnUse">
                <stop stopColor="#fef08a" />
                <stop offset="0.25" stopColor="#fde047" />
                <stop offset="0.6" stopColor="var(--accent, #f59e0b)" />
                <stop offset="0.88" stopColor="#ea580c" />
                <stop offset="1" stopColor="#dc2626" stopOpacity="0.85" />
              </linearGradient>

              {/* Middle Flame Gradient */}
              <linearGradient id="flameMidGrad" x1="16" y1="6.5" x2="16" y2="17.8" gradientUnits="userSpaceOnUse">
                <stop stopColor="#ffffff" />
                <stop offset="0.3" stopColor="#fef9c3" />
                <stop offset="0.65" stopColor="#fde047" />
                <stop offset="1" stopColor="var(--accent, #f59e0b)" />
              </linearGradient>

              {/* Inner White Core Flame Gradient */}
              <linearGradient id="flameCoreGrad" x1="16" y1="9.5" x2="16" y2="16.8" gradientUnits="userSpaceOnUse">
                <stop stopColor="#ffffff" />
                <stop offset="0.6" stopColor="#fef08a" />
                <stop offset="1" stopColor="#facc15" />
              </linearGradient>

              {/* Rim Polish Highlight Gradient */}
              <linearGradient id="rimHighlight" x1="4" y1="17" x2="28" y2="17" gradientUnits="userSpaceOnUse">
                <stop stopColor="#fef08a" stopOpacity="0.8" />
                <stop offset="0.5" stopColor="var(--accent, #f59e0b)" stopOpacity="0.9" />
                <stop offset="1" stopColor="#fbbf24" stopOpacity="0.6" />
              </linearGradient>
            </defs>

            {/* ----------------- Diya Lamp Stand & Bowl ----------------- */}
            {/* Base Stand Ring */}
            <path
              d="M11 27.5C11 29 21 29 21 27.5"
              stroke={isLit ? "var(--primary, #b45309)" : "var(--border, #475569)"}
              strokeWidth="1.6"
              strokeLinecap="round"
            />

            {/* Oil Lamp Bowl (Diya Base) */}
            <path
              d="M4 18.5C4 25.5 10 27.5 16 27.5C22 27.5 28 25.5 28 18.5C28 16.8 24.5 16 16 16C7.5 16 4 16.8 4 18.5Z"
              fill={isLit ? "url(#diyaBodyLit)" : "url(#diyaBodyUnlit)"}
              stroke={isLit ? "var(--accent, #f59e0b)" : "var(--border, #64748b)"}
              strokeWidth="1.2"
            />

            {/* Inner Oil Pool Surface */}
            <ellipse
              cx="16"
              cy="17.2"
              rx="9.5"
              ry="1.6"
              fill={isLit ? "#78350f" : "#1e293b"}
              opacity="0.75"
            />

            {/* Polished Rim Accent */}
            <path
              d="M5 17.5C9 19 23 19 27 17.5"
              stroke={isLit ? "url(#rimHighlight)" : "var(--border, #64748b)"}
              strokeWidth="1.1"
              strokeLinecap="round"
              opacity={isLit ? 0.95 : 0.5}
            />

            {/* ----------------- Flame Components ----------------- */}
            {isLit ? (
              /* Living Burning Flame (STRICTLY ONLY WHEN QUALIFIED >= 15m) */
              <g>
                {/* Outer Radiant Flame */}
                <path
                  d="M16 2.5C16 2.5 22.5 10 22.5 14.5C22.5 18 19.6 19 16 19C12.4 19 9.5 18 9.5 14.5C9.5 10 16 2.5 16 2.5Z"
                  fill="url(#flameOuterGrad)"
                  className="animate-flame-outer"
                  style={{ filter: "drop-shadow(0 0 4px var(--accent, #f59e0b))" }}
                />

                {/* Middle Warm Flame */}
                <path
                  d="M16 6.5C16 6.5 20.5 11.5 20.5 14.5C20.5 17 18.5 17.8 16 17.8C13.5 17.8 11.5 17 11.5 14.5C11.5 11.5 16 6.5 16 6.5Z"
                  fill="url(#flameMidGrad)"
                  className="animate-flame-core"
                />

                {/* Inner White Core Flame */}
                <path
                  d="M16 9.5C16 9.5 18.5 12.8 18.5 14.8C18.5 16.2 17.2 16.8 16 16.8C14.8 16.8 13.5 16.2 13.5 14.8C13.5 12.8 16 9.5 16 9.5Z"
                  fill="url(#flameCoreGrad)"
                  className="animate-flame-core"
                />

                {/* Bright Seed Center Point */}
                <ellipse cx="16" cy="14.8" rx="1.2" ry="1.6" fill="#ffffff" />
              </g>
            ) : (
              /* Completely Unlit Dark Wick (0 - 14:59m) */
              <g>
                <line
                  x1="16"
                  y1="13.5"
                  x2="16"
                  y2="17.2"
                  stroke="var(--border, #475569)"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
                {/* Metallic wick tip */}
                <circle cx="16" cy="13.5" r="0.7" fill="#94a3b8" opacity="0.6" />
              </g>
            )}
          </svg>
        </div>

        {/* Text & Streak Count */}
        <div className="flex items-center gap-1.5">
          <span
            className={`text-xs font-bold font-mono ${
              isLit ? "text-[var(--accent)] font-extrabold" : "text-[var(--foreground)]"
            }`}
          >
            {streakData.currentStreak > 0 ? `${streakData.currentStreak}d` : "0d"}
          </span>

          {/* Desktop Label */}
          <span className="hidden sm:inline text-[11px] text-[var(--text-secondary)] font-medium">
            {isLit ? "Streak" : `${todayReadingMinutes}/15m`}
          </span>
        </div>
      </button>

      {/* -------------------------------------------------------------
       * Interactive Streak Details Popover Card
       * ------------------------------------------------------------- */}
      {isOpen && (
        <div className="absolute right-0 top-12 z-50 w-80 sm:w-88 p-5 rounded-3xl glass-panel border border-[var(--border)] bg-[var(--card)]/95 backdrop-blur-2xl shadow-2xl animate-scale-up text-left space-y-4">
          {/* Header with Diya Showcase */}
          <div className="flex items-start justify-between pb-3 border-b border-[var(--border)]">
            <div className="flex items-center gap-3">
              <div
                className={`w-12 h-12 rounded-2xl flex items-center justify-center text-2xl border ${
                  isLit
                    ? "bg-[var(--accent)]/20 border-[var(--accent)]/40 text-[var(--accent)] shadow-[0_0_20px_var(--theme-glow,rgba(245,158,11,0.3))]"
                    : "bg-[var(--secondary)] border-[var(--border)] text-[var(--text-secondary)]"
                }`}
              >
                🪔
              </div>
              <div>
                <h4 className="font-serif font-bold text-sm text-[var(--foreground)] flex items-center gap-1.5">
                  <span>Daily Reading Streak</span>
                </h4>
                <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                  {isLit
                    ? "✨ Your Diwali Diya is lit today!"
                    : todayReadingMinutes > 0
                    ? `🔥 ${15 - todayReadingMinutes} more min of book reading to light your Diya`
                    : "Read 15 min today to light your Diya"}
                </p>
              </div>
            </div>

            <button
              onClick={() => setIsOpen(false)}
              className="text-xs text-[var(--text-secondary)] hover:text-[var(--foreground)] cursor-pointer"
            >
              ✕
            </button>
          </div>

          {/* Today's Reading Goal Progress Bar */}
          <div className="space-y-1.5 bg-[var(--secondary)]/40 p-3.5 rounded-2xl border border-[var(--border)]">
            <div className="flex justify-between text-xs font-semibold">
              <span className="text-[var(--text-secondary)] flex items-center gap-1">
                <span>📖 Today&apos;s Book Reading</span>
              </span>
              <span className={isLit ? "text-[var(--accent)] font-bold" : "text-[var(--foreground)]"}>
                {todayReadingMinutes} / 15 min {isLit && "✓"}
              </span>
            </div>

            <div className="w-full h-2 rounded-full bg-[var(--background)] overflow-hidden border border-[var(--border)]/50">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  isLit
                    ? "bg-gradient-to-r from-[var(--accent)] to-orange-500 shadow-[0_0_10px_var(--theme-glow,rgba(245,158,11,0.5))]"
                    : "bg-gradient-to-r from-[var(--primary)] to-[var(--accent)]"
                }`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[10px] text-[var(--text-secondary)] pt-0.5">
              <span>⚡ Site Active: {todayActiveMinutes}m today</span>
              <span className="italic">
                {isLit ? "Goal achieved!" : "Diya uses book reading only"}
              </span>
            </div>
          </div>

          {/* Last 7 Days Visual Calendar */}
          <div className="space-y-2">
            <span className="text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">
              Last 7 Days Book Reading
            </span>
            <div className="grid grid-cols-7 gap-1.5 text-center">
              {last7Days.map((day) => (
                <div
                  key={day.dateKey}
                  className={`p-2 rounded-xl border flex flex-col items-center justify-center transition-all ${
                    day.isToday
                      ? isLit
                        ? "bg-[var(--accent)]/20 border-[var(--accent)] text-[var(--accent)] font-bold shadow-xs"
                        : "bg-[var(--secondary)] border-[var(--border)] text-[var(--foreground)]"
                      : day.qualified
                      ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
                      : "bg-[var(--card)] border-[var(--border)] text-[var(--text-secondary)] opacity-60"
                  }`}
                >
                  <span className="text-[10px] font-semibold">{day.label}</span>
                  <span className="text-xs my-0.5">
                    {day.qualified ? "🪔" : day.isToday ? (day.minutes > 0 ? "🕯️" : "○") : "—"}
                  </span>
                  <span className="text-[9px] font-mono opacity-80">{day.minutes}m</span>
                </div>
              ))}
            </div>
          </div>

          {/* Streak Stats */}
          <div className="grid grid-cols-2 gap-2 pt-1 border-t border-[var(--border)] text-center text-xs">
            <div className="p-2.5 rounded-xl bg-[var(--secondary)]/40 border border-[var(--border)]">
              <span className="text-[10px] text-[var(--text-secondary)] block">Current Streak</span>
              <strong className="text-base font-serif font-bold text-[var(--accent)]">
                {streakData.currentStreak} {streakData.currentStreak === 1 ? "Day" : "Days"}
              </strong>
            </div>

            <div className="p-2.5 rounded-xl bg-[var(--secondary)]/40 border border-[var(--border)]">
              <span className="text-[10px] text-[var(--text-secondary)] block">Longest Streak</span>
              <strong className="text-base font-serif font-bold text-[var(--foreground)]">
                {streakData.longestStreak} {streakData.longestStreak === 1 ? "Day" : "Days"}
              </strong>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
