// Display-time helpers for beautifying sport-specific text.

// All four sports the app ships, matching lib/sport-context.ts. This was
// `"mlb" | "nba"`, which is why every caller passed `currentSport as any` —
// and that cast is what let the NBA-only "RL" rewrite silently skip NFL/NHL.
export type Sport = "mlb" | "nba" | "nfl" | "nhl";

/**
 * Replace generic market abbreviations with sport-specific language.
 * - "Warriors ML" on NBA → "Warriors Moneyline"
 * - "Yankees ML" on MLB → "Yankees Moneyline" (uniform is clearer than "ML")
 * - NBA totals already render as "Over/Under N" — no change
 */
export function formatPickLabel(pick: string, sport: Sport): string {
  if (!pick) return pick;
  // Normalize trailing " ML" → " Moneyline" (both sports — less cryptic)
  let out = pick.replace(/\s+ML\s*$/i, " Moneyline");
  // Normalize any "GM: ML" / "G: ML" game-prefixed formats that might leak from older pipelines
  out = out
    .replace(/^GM[:\s-]+ML\b/i, "Moneyline")
    .replace(/^G[:\s-]+ML\b/i, "Moneyline");
  // "RL" (run line) is a BASEBALL term, so every non-MLB sport should read
  // "Spread". This was gated on `sport === "nba"` only, so an NFL or NHL
  // spread pick kept the baseball wording. Callers pass `currentSport as any`,
  // which defeated the Sport type and hid it.
  if (sport !== "mlb") out = out.replace(/\s+RL\s*(?=[-+]?\d|$)/i, " Spread ");
  return out;
}

/** Label for a market code in a user-friendly way. */
export function formatMarketLabel(market: string, sport: Sport): string {
  const lower = (market ?? "").toLowerCase();
  if (lower === "moneyline") return sport === "nba" ? "Moneyline" : "Moneyline";
  if (lower === "spread") return sport === "nba" ? "Spread" : "Run Line";
  if (lower === "total") return "Total";
  if (lower === "player_prop") return "Player Prop";
  return market;
}
