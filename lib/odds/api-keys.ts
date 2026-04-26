// ──────────────────────────────────────────────────────────
// Odds API Key Rotation
// Tries paid key first; falls back through THE_ODDS_API_KEY_2..9
// when one returns OUT_OF_USAGE_CREDITS. Exhausted keys are
// remembered for the rest of the process lifetime.
// ──────────────────────────────────────────────────────────

const ALL_KEYS: string[] = [
  process.env.THE_ODDS_API_KEY_PAID,
  process.env.THE_ODDS_API_KEY,
  process.env.THE_ODDS_API_KEY_2,
  process.env.THE_ODDS_API_KEY_3,
  process.env.THE_ODDS_API_KEY_4,
  process.env.THE_ODDS_API_KEY_5,
  process.env.THE_ODDS_API_KEY_6,
  process.env.THE_ODDS_API_KEY_7,
  process.env.THE_ODDS_API_KEY_8,
  process.env.THE_ODDS_API_KEY_9,
].filter((k): k is string => !!k && k.length > 10);

const exhausted = new Set<string>();

export function getApiKey(): string | null {
  for (const k of ALL_KEYS) {
    if (!exhausted.has(k)) return k;
  }
  return null;
}

export function markKeyExhausted(key: string) {
  if (key) exhausted.add(key);
}

export function getKeyCount(): number {
  return ALL_KEYS.length;
}

export function getActiveKeyCount(): number {
  return ALL_KEYS.filter((k) => !exhausted.has(k)).length;
}

export function resetExhaustedKeys() {
  exhausted.clear();
}
