// ──────────────────────────────────────────────────────────
// Odds API Key Rotation
// Cycles through multiple keys when one hits quota limit
// ──────────────────────────────────────────────────────────

// Order keys with most quota first — keys 1,2,3,5 are burned for this month
// Key 4 has ~196 remaining. Reorder monthly or add new keys at the top.
const KEYS = [
  process.env.THE_ODDS_API_KEY_4,  // ~196 remaining
  process.env.THE_ODDS_API_KEY_5,  // burned but may reset
  process.env.THE_ODDS_API_KEY_3,
  process.env.THE_ODDS_API_KEY_2,
  process.env.THE_ODDS_API_KEY,
].filter(Boolean) as string[];

let currentIndex = 0; // start from first (highest quota)
const exhaustedKeys = new Set<string>();

export function getApiKey(): string | null {
  // Try keys from newest to oldest (newest are most likely to have quota)
  for (let i = 0; i < KEYS.length; i++) {
    const idx = (currentIndex - i + KEYS.length) % KEYS.length;
    const key = KEYS[idx];
    if (!exhaustedKeys.has(key)) {
      return key;
    }
  }
  // All exhausted — try the last one anyway
  return KEYS[KEYS.length - 1] ?? null;
}

export function markKeyExhausted(key: string) {
  exhaustedKeys.add(key);
  // Rotate to next key
  const idx = KEYS.indexOf(key);
  if (idx >= 0) {
    currentIndex = (idx + 1) % KEYS.length;
  }
}

export function getKeyCount(): number {
  return KEYS.length;
}

export function getActiveKeyCount(): number {
  return KEYS.filter((k) => !exhaustedKeys.has(k)).length;
}

// Reset exhausted status (call periodically or on new day)
export function resetExhaustedKeys() {
  exhaustedKeys.clear();
}
