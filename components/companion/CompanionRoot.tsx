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
  const compact = onReaderRoute;

  const launcherPosition = compact
    ? "left-2 top-1/2 -translate-y-1/2 sm:left-3"
    : "left-4 bottom-4 sm:left-6 sm:bottom-6";

  const content = (
    <div className="bodhi-companion">
      {open ? (
        <div
          className={`fixed z-[58] flex flex-col overflow-hidden border border-[var(--border)] bg-[var(--background)] shadow-[0_30px_80px_-24px_rgba(20,27,45,0.55)]
            inset-x-2 bottom-2 h-[78dvh] rounded-2xl
            sm:inset-x-auto sm:left-6 sm:w-[400px] sm:rounded-3xl ${compact ? "sm:top-24 sm:bottom-6 sm:h-auto" : "sm:bottom-6 sm:h-[min(640px,calc(100dvh-7rem))]"}`}
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
          <BodhiRobot mood={mood} size={34} interactive={false} showBook={false} />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`group fixed z-[58] cursor-pointer rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${launcherPosition}`}
          aria-label={snapshot?.isLoaded ? `Ask Bodhi about “${snapshot.title}”` : "Open Bodhi, your AI reading companion"}
          title="Bodhi · AI reading companion (Alt+K)"
        >
          <span className="relative block">
            <span className="block sm:hidden">
              <BodhiRobot mood={mood} size={compact ? 54 : 64} />
            </span>
            <span className="hidden sm:block">
              <BodhiRobot mood={mood} size={compact ? 70 : 92} />
            </span>
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
