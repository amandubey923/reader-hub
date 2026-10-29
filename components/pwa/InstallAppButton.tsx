"use client";

import React, { useState, useEffect, useCallback } from "react";

declare global {
  interface Window {
    __pwaInstallPrompt?: any;
  }
}

interface InstallAppButtonProps {
  className?: string;
  variant?: "navbar" | "mobile-menu" | "banner";
  onInstalled?: () => void;
}

export default function InstallAppButton({
  className = "",
  variant = "navbar",
  onInstalled,
}: InstallAppButtonProps) {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstallable, setIsInstallable] = useState<boolean>(false);
  const [isInstalled, setIsInstalled] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Check if already running in standalone PWA mode
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true;

    if (isStandalone) {
      setIsInstalled(true);
      return;
    }

    // Check if prompt was captured early in layout script
    if (window.__pwaInstallPrompt) {
      setDeferredPrompt(window.__pwaInstallPrompt);
      setIsInstallable(true);
    }

    const handlePrompt = (e: any) => {
      e.preventDefault();
      window.__pwaInstallPrompt = e;
      setDeferredPrompt(e);
      setIsInstallable(true);
    };

    const handlePromptAvailable = () => {
      if (window.__pwaInstallPrompt) {
        setDeferredPrompt(window.__pwaInstallPrompt);
        setIsInstallable(true);
      }
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setIsInstallable(false);
      setDeferredPrompt(null);
      window.__pwaInstallPrompt = null;
      if (onInstalled) onInstalled();
    };

    window.addEventListener("beforeinstallprompt", handlePrompt);
    window.addEventListener("pwa-prompt-available", handlePromptAvailable);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handlePrompt);
      window.removeEventListener("pwa-prompt-available", handlePromptAvailable);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, [onInstalled]);

  const handleInstallClick = useCallback(async () => {
    const promptToUse = deferredPrompt || window.__pwaInstallPrompt;
    if (!promptToUse) return;

    try {
      promptToUse.prompt();
      const choiceResult = await promptToUse.userChoice;
      if (choiceResult.outcome === "accepted") {
        setIsInstallable(false);
        setIsInstalled(true);
        setDeferredPrompt(null);
        window.__pwaInstallPrompt = null;
      }
    } catch (err) {
      console.warn("[PWA] Install prompt error:", err);
    }
  }, [deferredPrompt]);

  if (!isInstallable || isInstalled) {
    return null;
  }

  if (variant === "mobile-menu") {
    return (
      <button
        onClick={handleInstallClick}
        className={`w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-[var(--primary)] to-[var(--accent)] text-[var(--primary-foreground)] font-bold text-xs flex items-center justify-center gap-2 shadow-md cursor-pointer active:scale-95 transition-all ${className}`}
        aria-label="Install Reader's HUB App"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        <span>Install App</span>
      </button>
    );
  }

  return (
    <div className="relative group inline-flex items-center">
      {/* Icon-Only Install App Button */}
      <button
        onClick={handleInstallClick}
        className={`relative flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-[var(--card)] hover:bg-[var(--secondary)] text-[var(--foreground)] border border-[var(--border)] hover:border-[var(--accent)]/60 shadow-xs transition-all duration-200 hover:scale-105 hover:shadow-[0_0_12px_var(--accent-glow)] cursor-pointer active:scale-95 select-none ${className}`}
        title="Install App"
        aria-label="Install App"
      >
        {/* Prominent, Bold Install/Download Icon */}
        <svg
          className="w-4 h-4 sm:w-[18px] sm:h-[18px] text-[var(--accent)] transition-transform duration-200 group-hover:scale-110"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.4}
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1.5a2.5 2.5 0 002.5 2.5h11a2.5 2.5 0 002.5-2.5V16" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3.5v10m0 0l-3.5-3.5m3.5 3.5l3.5-3.5" />
        </svg>
      </button>

      {/* Clean Tooltip on Hover */}
      <div
        role="tooltip"
        className="pointer-events-none absolute -bottom-9 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-all duration-150 transform group-hover:translate-y-0 translate-y-1 z-50 whitespace-nowrap hidden sm:block"
      >
        <div className="px-2.5 py-1 rounded-lg bg-[var(--card)]/95 backdrop-blur-md border border-[var(--border)] text-[11px] font-semibold text-[var(--foreground)] shadow-lg shadow-black/40 flex items-center gap-1.5">
          <span className="text-[var(--accent)]">📥</span>
          <span>Install App</span>
        </div>
      </div>
    </div>
  );
}
