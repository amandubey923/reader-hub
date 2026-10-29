"use client";

import React, { createContext, useContext, useEffect, useState, ReactNode } from "react";

export type ThemeMode =
  | "architect"
  | "original"
  | "light"
  | "dark"
  | "midnight"
  | "aurora"
  | "sunset"
  | "forest";

export interface ThemeConfig {
  id: ThemeMode;
  name: string;
  category: "dark" | "light";
  primaryColor: string;
  accentColor: string;
  bgPreview: string;
  description: string;
  icon?: string;
}

// Applied when a visitor has no saved theme preference
export const DEFAULT_THEME: ThemeMode = "architect";

export const THEMES: ThemeConfig[] = [
  {
    id: "architect",
    name: "Architect Ivory & Gold",
    category: "light",
    primaryColor: "#e8a23a",
    accentColor: "#1f5f7a",
    bgPreview: "#f7f4ec",
    description: "Warm ivory, brushed gold & sapphire slate luxury",
    icon: "◆",
  },
  {
    id: "original",
    name: "Original",
    category: "dark",
    primaryColor: "#f59e0b",
    accentColor: "#d97706",
    bgPreview: "#0b0d13",
    description: "Classic warm amber & dark cinematic baseline",
    icon: "✦",
  },
  {
    id: "light",
    name: "Light Mode",
    category: "light",
    primaryColor: "#b45309",
    accentColor: "#92400e",
    bgPreview: "#fbf9f4",
    description: "Refined light editorial parchment & espresso",
    icon: "☀️",
  },
  {
    id: "dark",
    name: "Dark Mode",
    category: "dark",
    primaryColor: "#60a5fa",
    accentColor: "#3b82f6",
    bgPreview: "#090b10",
    description: "Pure slate charcoal & crisp modern contrast",
    icon: "🌙",
  },
  {
    id: "midnight",
    name: "Midnight",
    category: "dark",
    primaryColor: "#38bdf8",
    accentColor: "#0284c7",
    bgPreview: "#060813",
    description: "Deep obsidian with sapphire cyan glow",
    icon: "🌌",
  },
  {
    id: "aurora",
    name: "Aurora",
    category: "dark",
    primaryColor: "#2dd4bf",
    accentColor: "#0d9488",
    bgPreview: "#051412",
    description: "Mystic teal & luminous emerald radiance",
    icon: "✨",
  },
  {
    id: "sunset",
    name: "Sunset",
    category: "dark",
    primaryColor: "#fb7185",
    accentColor: "#e11d48",
    bgPreview: "#120910",
    description: "Dusk twilight with warm coral & crimson embers",
    icon: "🌅",
  },
  {
    id: "forest",
    name: "Forest",
    category: "dark",
    primaryColor: "#4ade80",
    accentColor: "#16a34a",
    bgPreview: "#08130a",
    description: "Deep cedar pine & botanical spring leaf",
    icon: "🌲",
  },
];

interface ThemeContextType {
  theme: ThemeMode;
  setTheme: (mode: ThemeMode) => void;
  toggleLightDark: () => void;
  isLight: boolean;
  currentThemeConfig: ThemeConfig;
  allThemes: ThemeConfig[];
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const THEME_STORAGE_KEY = "readers_hub_theme_v3";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(DEFAULT_THEME);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // A returning reader's explicit choice always wins; only first-time visitors get the default.
    try {
      const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null;
      if (savedTheme && THEMES.some((t) => t.id === savedTheme)) {
        setThemeState(savedTheme);
        document.documentElement.setAttribute("data-theme", savedTheme);
      } else {
        document.documentElement.setAttribute("data-theme", DEFAULT_THEME);
      }
    } catch {
      document.documentElement.setAttribute("data-theme", DEFAULT_THEME);
    }
    setMounted(true);
  }, []);

  const setTheme = (mode: ThemeMode) => {
    setThemeState(mode);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, mode);
      document.documentElement.setAttribute("data-theme", mode);
    } catch (e) {
      console.warn("Could not persist theme", e);
    }
  };

  const currentThemeConfig = THEMES.find((t) => t.id === theme) || THEMES[0];
  const isLight = currentThemeConfig.category === "light";

  const toggleLightDark = () => {
    if (isLight) {
      setTheme("original");
    } else {
      setTheme(DEFAULT_THEME);
    }
  };

  return (
    <ThemeContext.Provider
      value={{
        theme,
        setTheme,
        toggleLightDark,
        isLight,
        currentThemeConfig,
        allThemes: THEMES,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
