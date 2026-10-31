"use client";

import React, { useState, useRef, useEffect } from "react";
import { useTheme, THEMES, DEFAULT_THEME } from "./ThemeProvider";

interface NavbarThemeControlProps {
  compact?: boolean;
}

export default function NavbarThemeControl({ compact = false }: NavbarThemeControlProps) {
  const { theme, setTheme, toggleLightDark, isLight, currentThemeConfig } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  return (
    <div ref={dropdownRef} className="relative inline-block text-left">
      {/* Navbar Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 bg-[var(--card)] hover:bg-[var(--secondary)] text-[var(--foreground)] border border-[var(--border)] hover:border-[var(--accent)]/50 px-2.5 py-2 rounded-xl text-xs font-semibold shadow-sm transition-all cursor-pointer group focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        aria-label={`Select theme appearance (current: ${currentThemeConfig.name})`}
        title={`Theme: ${currentThemeConfig.name}`}
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        {/* Current theme's main colour with an ivory highlight (Architect → gold/ivory, Dark/Midnight → blue,
            Sunset → pink…); follows the selection automatically */}
        <span
          aria-hidden="true"
          data-theme-indicator={currentThemeConfig.id}
          className={`block w-3.5 h-3.5 rounded-full border border-white/30 shadow-sm transition-transform duration-200 ${
            isOpen ? "scale-110 ring-2 ring-[var(--accent)]/40" : ""
          }`}
          style={{ background: `radial-gradient(circle at 35% 30%, #fffdf8 0%, ${currentThemeConfig.primaryColor} 62%)` }}
        />
      </button>

      {/* Floating Theme Popover Dropdown */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-72 rounded-2xl glass-panel shadow-2xl p-3 z-50 animate-scale-up space-y-3">
          {/* Header & Quick Light/Dark Segmented Switch */}
          <div className="flex items-center justify-between pb-2 border-b border-[var(--border)]">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
              Appearance
            </span>
            <div className="flex items-center gap-1 bg-[var(--background)] p-0.5 rounded-lg border border-[var(--border)]">
              <button
                onClick={() => setTheme(isLight ? theme : DEFAULT_THEME)}
                className={`px-2 py-1 rounded-md text-xs transition-all cursor-pointer flex items-center gap-1 ${
                  isLight
                    ? "bg-[var(--card)] text-[var(--accent)] font-bold shadow-sm"
                    : "text-[var(--text-secondary)] hover:text-[var(--foreground)]"
                }`}
                title="Light Mode"
              >
                <span>☀️</span>
                <span className="text-[10px]">Light</span>
              </button>
              <button
                onClick={() => setTheme(isLight ? "original" : theme)}
                className={`px-2 py-1 rounded-md text-xs transition-all cursor-pointer flex items-center gap-1 ${
                  !isLight
                    ? "bg-[var(--card)] text-[var(--accent)] font-bold shadow-sm"
                    : "text-[var(--text-secondary)] hover:text-[var(--foreground)]"
                }`}
                title="Dark Mode"
              >
                <span>🌙</span>
                <span className="text-[10px]">Dark</span>
              </button>
            </div>
          </div>

          {/* Color Themes List */}
          <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
            <div className="text-[10px] font-semibold text-[var(--text-secondary)] px-2 py-0.5 uppercase tracking-wider">
              Curated Color Themes
            </div>
            {THEMES.map((item) => {
              const isSelected = theme === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setTheme(item.id);
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-center justify-between p-2 rounded-xl text-left transition-all cursor-pointer ${
                    isSelected
                      ? "bg-[var(--accent)]/15 border border-[var(--accent)] text-[var(--foreground)]"
                      : "hover:bg-[var(--secondary)] border border-transparent text-[var(--text-secondary)] hover:text-[var(--foreground)]"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className="w-4 h-4 rounded-full flex-shrink-0 border border-white/20 shadow-sm"
                      style={{
                        background: `linear-gradient(135deg, ${item.primaryColor}, ${item.accentColor})`,
                        boxShadow: isSelected ? `0 0 10px ${item.primaryColor}aa` : undefined,
                      }}
                    />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-[var(--foreground)] flex items-center gap-1.5 truncate">
                        <span>{item.name}</span>
                        {item.id === DEFAULT_THEME && (
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-[var(--accent)]/20 text-[var(--accent)] font-normal">
                            Default
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-[var(--text-secondary)] truncate max-w-[170px]">
                        {item.description}
                      </div>
                    </div>
                  </div>

                  {isSelected && (
                    <span className="text-xs text-[var(--accent)] font-bold ml-1.5 flex-shrink-0">
                      ✓
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

