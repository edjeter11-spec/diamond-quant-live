// ──────────────────────────────────────────────────────────
// Odds API Key Rotation
// Cycles through multiple keys when one hits quota limit
// ──────────────────────────────────────────────────────────

const KEYS = [
  process.env.THE_ODDS_API_KEY,
  process.env.THE_ODDS_API_KEY_2,
  process.env.THE_ODDS_API_KEY_3,
  process.env.THE_ODDS_API_KEY_4,
  process.env.THE_ODDS_API_KEY_5,
].filter(Boolean) as string[];

let currentIndex = 0;
const exhaustedKeys = new Set<string>();

export function getApiKey(): string | null {
  // Try keys in order, skip exhausted ones
  for (let i = 0; i < KEYS.length; i++) {
    const idx = (currentIndex + i) % KEYS.length;
    const key = KEYS[idx];
    if (!exhaustedKeys.has(key)) {
      return key;
    }
  }
  // All exhausted — try the first one anyway (might have reset)
  return KEYS[0] ?? null;
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
