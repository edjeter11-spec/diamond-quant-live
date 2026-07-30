// ──────────────────────────────────────────────────────────
// SAFE STORAGE — self-healing localStorage JSON reads
// Every loader in the app must validate parsed shape: a single corrupt or
// legacy-schema key (old app version, interrupted write, cloud-sync shape
// mismatch) otherwise crashes whatever component consumes it with
// ".filter is not a function"-style errors that take down the whole tab.
// On any parse/validation failure the bad key is REMOVED so the app heals
// itself on next load instead of crashing forever.
// ──────────────────────────────────────────────────────────

export function loadJSON<T>(
  key: string,
  fallback: T,
  validate?: (v: any) => boolean
): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    const ok = validate
      ? validate(parsed)
      : Array.isArray(fallback)
        ? Array.isArray(parsed)
        : typeof fallback === "object" && fallback !== null
          ? typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
          : typeof parsed === typeof fallback;
    if (!ok) {
      try { localStorage.removeItem(key); } catch {}
      return fallback;
    }
    return parsed as T;
  } catch {
    try { localStorage.removeItem(key); } catch {}
    return fallback;
  }
}

// Common validators
export const isArrayOf = (itemCheck?: (item: any) => boolean) => (v: any): boolean =>
  Array.isArray(v) && (!itemCheck || v.every(itemCheck));

export const isRecord = (v: any): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
