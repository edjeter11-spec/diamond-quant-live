// ──────────────────────────────────────────────────────────
// Server-side memory cache for Odds API responses
// Prevents duplicate API calls within the same time window
// ──────────────────────────────────────────────────────────

interface CacheEntry {
  data: any;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();

// Get cached data if still fresh
export function getCached(key: string, maxAgeMs: number): any | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > maxAgeMs) return null;
  return entry.data;
}

// Store data in cache
export function setCache(key: string, data: any) {
  cache.set(key, { data, timestamp: Date.now() });
}

// Cache TTLs
export const CACHE_TTL = {
  ODDS: 60_000,        // 60 seconds for game odds
  PROPS: 120_000,      // 2 minutes for player props
  EVENTS: 300_000,     // 5 minutes for event list
  ANALYSIS: 300_000,   // 5 minutes for team analysis
};
