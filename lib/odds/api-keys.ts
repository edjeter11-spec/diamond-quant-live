// ──────────────────────────────────────────────────────────
// Odds API Key — Single paid key, no rotation needed
// ──────────────────────────────────────────────────────────

const PAID_KEY = process.env.THE_ODDS_API_KEY_PAID;

export function getApiKey(): string | null {
  return PAID_KEY ?? null;
}

// These are no-ops now but kept for compatibility
export function markKeyExhausted(_key: string) {}
export function getKeyCount(): number { return PAID_KEY ? 1 : 0; }
export function getActiveKeyCount(): number { return PAID_KEY ? 1 : 0; }
export function resetExhaustedKeys() {}
