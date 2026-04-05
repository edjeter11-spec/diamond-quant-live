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
  ODDS: 300_000,        // 5 minutes — saves API calls
  PROPS: 600_000,       // 10 minutes — props move slow
  EVENTS: 900_000,      // 15 minutes
  ANALYSIS: 600_000,    // 10 minutes
};

// ── Edge Timestamp Tracking ──
// Tracks when each EV edge was first spotted
const edgeTimestamps = new Map<string, number>();

export function getEdgeAge(pickKey: string): number {
  const first = edgeTimestamps.get(pickKey);
  if (!first) return 0;
  return Math.floor((Date.now() - first) / 1000);
}

export function stampEdge(pickKey: string) {
  if (!edgeTimestamps.has(pickKey)) {
    edgeTimestamps.set(pickKey, Date.now());
  }
}

// Clean old edges (>30 min)
export function cleanEdges() {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [key, ts] of edgeTimestamps) {
    if (ts < cutoff) edgeTimestamps.delete(key);
  }
}
