// ──────────────────────────────────────────────────────────
// Aggressive caching layer for API calls
// Conserves Odds API quota, provides fallback data
// ──────────────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

const memoryCache = new Map<string, CacheEntry<any>>();

export async function cachedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlSeconds: number = 60
): Promise<T> {
  const cached = memoryCache.get(key);
  if (cached && Date.now() - cached.timestamp < cached.ttl * 1000) {
    return cached.data;
  }

  try {
    const data = await fetcher();
    memoryCache.set(key, { data, timestamp: Date.now(), ttl: ttlSeconds });
    return data;
  } catch (error) {
    // Return stale cache if available
    if (cached) {
      console.warn(`[Cache] Returning stale data for ${key}`);
      return cached.data;
    }
    throw error;
  }
}

// Store odds in localStorage as backup when API quota runs out
export function backupOddsToStorage(data: any) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem("dq_odds_backup", JSON.stringify({
      data,
      timestamp: Date.now(),
    }));
  } catch {}
}

export function getOddsBackup(): { data: any; age: number } | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem("dq_odds_backup");
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    return {
      data: parsed.data,
      age: Math.floor((Date.now() - parsed.timestamp) / 60000), // minutes ago
    };
  } catch {
    return null;
  }
}
