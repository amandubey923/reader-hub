"use client";

import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useReaderSnapshot } from "@/lib/companion/reader-bridge";
import BodhiRobot, { BodhiMood } from "./BodhiRobot";
import CompanionPanel from "./CompanionPanel";

// Companion-only preferences, isolated from reading progress and existing preference keys
const PREFS_KEY = "readershub:companion:prefs:v1";
const HIDDEN_SESSION_KEY = "readershub:companion:hidden:v1";

interface CompanionPrefs {
  minimized: boolean;
  hideOnReader: boolean;
  voiceReplies: boolean;
}

const DEFAULT_PREFS: CompanionPrefs = { minimized: false, hideOnReader: false, voiceReplies: false };

function readPrefs(): CompanionPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      minimized: parsed.minimized === true,
      hideOnReader: parsed.hideOnReader === true,
      voiceReplies: parsed.voiceReplies === true,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

/** Follows native fullscreen so the companion stays reachable inside the fullscreen reader. */
function useFullscreenElement(): Element | null {
  const [el, setEl] = useState<Element | null>(null);
  useEffect(() => {
    const update = () => setEl(document.fullscreenElement);
    update();
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  return el;
}

/**
 * Bodhi — AI Reading Companion. Mounted once globally (components/GlobalModals.tsx).
 * Coexists with the Library Assistant (bottom-right) by living on the left side.
 */
export default function CompanionRoot() {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const snapshot = useReaderSnapshot();
  const fullscreenElement = useFullscreenElement();

  const [prefs, setPrefs] = useState<CompanionPrefs>(DEFAULT_PREFS);
  const [hiddenForSession, setHiddenForSession] = useState(false);
  const [open, setOpen] = useState(false);
  const [mood, setMood] = useState<BodhiMood>("idle");
  const [ready, setReady] = useState(false);

  const onReaderRoute = Boolean(pathname?.startsWith("/book/"));

  useEffect(() => {
    setPrefs(readPrefs());
    try {
      setHiddenForSession(sessionStorage.getItem(HIDDEN_SESSION_KEY) === "1");
    } catch {}
    setReady(true);
  }, []);

  const updatePrefs = useCallback((patch: Partial<CompanionPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  const setSessionHidden = useCallback((hidden: boolean) => {
    setHiddenForSession(hidden);
    try {
      if (hidden) sessionStorage.setItem(HIDDEN_SESSION_KEY, "1");
      else sessionStorage.removeItem(HIDDEN_SESSION_KEY);
    } catch {}
  }, []);

  // Alt+K toggles Bodhi from anywhere (also brings it back after hiding); Escape closes the panel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSessionHidden(false);
        if (onReaderRoute && prefs.hideOnReader) updatePrefs({ hideOnReader: false });
        updatePrefs({ minimized: false });
        setOpen((o) => !o);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onReaderRoute, prefs.hideOnReader, setSessionHidden, updatePrefs]);

  const navigate = useCallback((href: string) => router.push(href), [router]);
  const stableMood = useCallback((m: BodhiMood) => setMood(m), []);

  if (!ready) return null;
  const suppressed = hiddenForSession || (onReaderRoute && prefs.hideOnReader);
  if (suppressed && !open) return null;

  const target = fullscreenElement ?? document.body;
  // Same robot everywhere: large on normal pages, compact while the reader is fullscreen.
  // Compact sits low on the left, clear of the vertically centred page-turn buttons and the bottom toolbar.
  const compact = Boolean(fullscreenElement);

  const launcherPosition = compact ? "left-2 bottom-24 sm:left-3 sm:bottom-28" : "left-3 bottom-3 sm:left-5 sm:bottom-4";

  const content = (
    <div className="bodhi-companion">
      {open ? (
        <div
          className={`fixed z-[58] flex flex-col overflow-hidden border border-[var(--border)] bg-[var(--background)] shadow-[0_30px_80px_-24px_rgba(20,27,45,0.55)]
            inset-x-2 top-2 bottom-2 rounded-2xl
            sm:inset-x-auto sm:left-5 sm:w-[min(600px,calc(100vw-2.5rem))] sm:rounded-3xl lg:w-[640px] ${compact ? "sm:top-4 sm:bottom-4" : "sm:top-[4.75rem] sm:bottom-4"}`}
        >
          <CompanionPanel
            snapshot={snapshot}
            signedIn={Boolean(user)}
            onReaderRoute={onReaderRoute}
            voiceReplies={prefs.voiceReplies}
            hideOnReader={prefs.hideOnReader}
            onToggleVoiceReplies={() => updatePrefs({ voiceReplies: !prefs.voiceReplies })}
            onToggleHideOnReader={() => updatePrefs({ hideOnReader: !prefs.hideOnReader })}
            onHideForSession={() => {
              setSessionHidden(true);
              setOpen(false);
            }}
            onMinimize={() => {
              updatePrefs({ minimized: true });
              setOpen(false);
            }}
            onClose={() => setOpen(false)}
            onMoodChange={stableMood}
            navigate={navigate}
          />
        </div>
      ) : prefs.minimized ? (
        <button
          type="button"
          onClick={() => {
            updatePrefs({ minimized: false });
            setOpen(true);
          }}
          className={`fixed z-[58] flex cursor-pointer items-center gap-1 rounded-r-xl border border-l-0 border-[var(--border)] bg-[var(--card)]/95 py-2 pl-1 pr-2 shadow-lg backdrop-blur transition-transform hover:translate-x-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] left-0 ${
            compact ? "top-1/2 -translate-y-1/2" : "bottom-24"
          }`}
          aria-label="Open Bodhi, your AI reading companion"
          title="Bodhi (Alt+K)"
        >
          <BodhiRobot mood={mood} size={46} interactive={false} showBook={false} />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`group fixed z-[58] cursor-pointer rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${launcherPosition}`}
          aria-label={snapshot?.isLoaded ? `Ask Bodhi about “${snapshot.title}”` : "Open Bodhi, your AI reading companion"}
          title="Bodhi · AI reading companion (Alt+K)"
        >
          <span className="relative flex flex-col items-start">
            <span className="block sm:hidden">
              <BodhiRobot mood={mood} size={compact ? 64 : 118} />
            </span>
            <span className="hidden sm:block">
              {/* Fills the empty margin beside the content on wide screens without reaching into it */}
              <BodhiRobot mood={mood} size={compact ? 92 : "clamp(156px, calc(((100vw - 1280px) / 2 + 8px) / 0.56), 330px)"} />
            </span>
            {!compact && (
              <span className="mt-1 rounded-full border border-[var(--border)] bg-[var(--card)]/95 px-2.5 py-1 text-left leading-tight shadow-md backdrop-blur">
                <span className="block font-serif text-[12px] font-bold text-[var(--foreground)] sm:text-[13px]">Bodhi</span>
                <span className="hidden whitespace-nowrap text-[10px] font-medium text-[var(--text-secondary)] sm:block">AI Reading Companion</span>
              </span>
            )}
            {!compact && (
              <span className="pointer-events-none absolute -right-2 top-1 hidden translate-x-full whitespace-nowrap rounded-full border border-[var(--border)] bg-[var(--card)] px-2.5 py-1 text-[11px] font-semibold text-[var(--foreground)] opacity-0 shadow-md transition-opacity group-hover:opacity-100 sm:block">
                Ask Bodhi
              </span>
            )}
          </span>
        </button>
      )}
    </div>
  );

  return createPortal(content, target);
}
