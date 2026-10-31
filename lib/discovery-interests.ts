"use client";

/**
 * Optional reading interests for recommendations.
 * Stored only on this device, per account (or guest), in its own key; never synced or shared.
 */

import { useCallback, useEffect, useState } from "react";
import type { DiscoveryInterests } from "@/lib/recommendations";

const KEY_PREFIX = "readershub:discovery-interests:v1";
const CHANGE_EVENT = "readershub:discovery-interests-changed";

export const EMPTY_INTERESTS: DiscoveryInterests = { categories: [], subgroups: [], languages: [] };

const keyFor = (uid?: string | null) => `${KEY_PREFIX}:${uid || "guest"}`;

function sanitize(value: unknown): DiscoveryInterests {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string").slice(0, 30) : []);
  return { categories: list(v.categories), subgroups: list(v.subgroups), languages: list(v.languages) };
}

export function readInterests(uid?: string | null): DiscoveryInterests {
  if (typeof window === "undefined") return EMPTY_INTERESTS;
  try {
    const raw = localStorage.getItem(keyFor(uid));
    return raw ? sanitize(JSON.parse(raw)) : EMPTY_INTERESTS;
  } catch {
    return EMPTY_INTERESTS;
  }
}

export function writeInterests(uid: string | null | undefined, interests: DiscoveryInterests): void {
  try {
    const clean = sanitize(interests);
    const empty = !clean.categories.length && !clean.subgroups.length && !clean.languages.length;
    if (empty) localStorage.removeItem(keyFor(uid));
    else localStorage.setItem(keyFor(uid), JSON.stringify({ ...clean, updatedAt: Date.now() }));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {}
}

export function useDiscoveryInterests(uid?: string | null) {
  const [interests, setInterests] = useState<DiscoveryInterests>(EMPTY_INTERESTS);

  useEffect(() => {
    const load = () => setInterests(readInterests(uid));
    load();
    window.addEventListener(CHANGE_EVENT, load);
    window.addEventListener("storage", load);
    return () => {
      window.removeEventListener(CHANGE_EVENT, load);
      window.removeEventListener("storage", load);
    };
  }, [uid]);

  const save = useCallback((next: DiscoveryInterests) => writeInterests(uid, next), [uid]);
  return { interests, save };
}
