"use client";

import { useEffect, useState } from "react";

// Lightweight client-side NBA player index so every PlayerAvatar
// can resolve name → player id → headshot URL without per-row API calls.
// Cached in localStorage for 24h; also kept in-memory for the session.

const CACHE_KEY = "dq_nba_player_index_v1";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const ENDPOINT = "/api/nba-player-index";

interface PlayerEntry {
  id: number;
  firstName: string;
  lastName: string;
  teamAbbrev?: string;
}

let memoryCache: { byNameLower: Map<string, number> } | null = null;
let inflight: Promise<Map<string, number>> | null = null;

function buildMap(entries: PlayerEntry[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of entries) {
    if (!p.id || !p.firstName || !p.lastName) continue;
    const full = `${p.firstName} ${p.lastName}`.toLowerCase().trim();
    map.set(full, p.id);
    // Common last-name only key so "giannis" or "curry" still resolves
    map.set(p.lastName.toLowerCase().trim(), p.id);
  }
  return map;
}

async function loadIndex(): Promise<Map<string, number>> {
  if (memoryCache) return memoryCache.byNameLower;
  if (inflight) return inflight;

  inflight = (async () => {
    // Try localStorage
    if (typeof window !== "undefined") {
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as { ts: number; entries: PlayerEntry[] };
          if (parsed.ts && Date.now() - parsed.ts < CACHE_TTL_MS && parsed.entries?.length > 0) {
            const byNameLower = buildMap(parsed.entries);
            memoryCache = { byNameLower };
            return byNameLower;
          }
        }
      } catch {}
    }

    // Fetch fresh
    try {
      const res = await fetch(ENDPOINT);
      if (!res.ok) return new Map();
      const data = await res.json();
      const entries: PlayerEntry[] = data?.players ?? [];
      if (entries.length === 0) return new Map();
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), entries }));
        } catch {}
      }
      const byNameLower = buildMap(entries);
      memoryCache = { byNameLower };
      return byNameLower;
    } catch {
      return new Map();
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/**
 * Resolve a player name to their NBA player ID.
 * Returns null if not found.
 */
export function useNbaPlayerId(name: string | undefined | null): number | null {
  const [id, setId] = useState<number | null>(null);

  useEffect(() => {
    if (!name) { setId(null); return; }
    let cancelled = false;
    loadIndex().then(map => {
      if (cancelled) return;
      const key = name.toLowerCase().trim();
      // Try exact full name first, then last-name fallback
      let found = map.get(key);
      if (!found) {
        const parts = key.split(/\s+/);
        const last = parts[parts.length - 1];
        if (last) found = map.get(last);
      }
      setId(found ?? null);
    });
    return () => { cancelled = true; };
  }, [name]);

  return id;
}

/**
 * Call once at the top of the app to prime the NBA player index.
 * No return value — just triggers the background load so avatars
 * resolve instantly the first time they render.
 */
export function useWarmNbaPlayerIndex(): void {
  useEffect(() => {
    loadIndex().catch(() => {});
  }, []);
}

// ── MLB parallel ──────────────────────────────────────────
const MLB_CACHE_KEY = "dq_mlb_player_index_v1";
const MLB_ENDPOINT = "/api/mlb-player-index";
let mlbMemoryCache: { byNameLower: Map<string, number> } | null = null;
let mlbInflight: Promise<Map<string, number>> | null = null;

async function loadMlbIndex(): Promise<Map<string, number>> {
  if (mlbMemoryCache) return mlbMemoryCache.byNameLower;
  if (mlbInflight) return mlbInflight;
  mlbInflight = (async () => {
    if (typeof window !== "undefined") {
      try {
        const raw = localStorage.getItem(MLB_CACHE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as { ts: number; entries: PlayerEntry[] };
          if (parsed.ts && Date.now() - parsed.ts < CACHE_TTL_MS && parsed.entries?.length > 0) {
            const byNameLower = buildMap(parsed.entries);
            mlbMemoryCache = { byNameLower };
            return byNameLower;
          }
        }
      } catch {}
    }
    try {
      const res = await fetch(MLB_ENDPOINT);
      if (!res.ok) return new Map();
      const data = await res.json();
      const entries: PlayerEntry[] = data?.players ?? [];
      if (entries.length === 0) return new Map();
      if (typeof window !== "undefined") {
        try { localStorage.setItem(MLB_CACHE_KEY, JSON.stringify({ ts: Date.now(), entries })); } catch {}
      }
      const byNameLower = buildMap(entries);
      mlbMemoryCache = { byNameLower };
      return byNameLower;
    } catch {
      return new Map();
    } finally {
      mlbInflight = null;
    }
  })();
  return mlbInflight;
}

export function useMlbPlayerId(name: string | undefined | null): number | null {
  const [id, setId] = useState<number | null>(null);
  useEffect(() => {
    if (!name) { setId(null); return; }
    let cancelled = false;
    loadMlbIndex().then((map) => {
      if (cancelled) return;
      const key = name.toLowerCase().trim();
      let found = map.get(key);
      if (!found) {
        const parts = key.split(/\s+/);
        const last = parts[parts.length - 1];
        if (last) found = map.get(last);
      }
      setId(found ?? null);
    });
    return () => { cancelled = true; };
  }, [name]);
  return id;
}
