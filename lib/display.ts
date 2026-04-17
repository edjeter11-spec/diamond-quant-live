// Display-time helpers for beautifying sport-specific text.

export type Sport = "mlb" | "nba";

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
  out = out.replace(/^GM[:\s-]+ML\b/i, "Moneyline").replace(/^G[:\s-]+ML\b/i, "Moneyline");
  // NBA-specific: "RL" (run-line leftover) → "Spread"
  if (sport === "nba") out = out.replace(/\s+RL\s*(?=[-+]?\d|$)/i, " Spread ");
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
