// ──────────────────────────────────────────────────────────
// Shared prop-quality filters.
//
// Extracted so pinned-props and parlay-today apply the SAME thresholds,
// same as the precedent set by lib/lineup-gate.ts. Prior to extraction the
// bullpen-pitcher filter existed in two places at the same 4.5/12 thresholds;
// last time an identical guard drifted (lineup gate lived in pinned-props but
// not parlay-today), a parlay published at 4:01 AM on 2026-08-10 off morning-
// blind numbers. One filter, one place, both routes import it.
// ──────────────────────────────────────────────────────────

/** Real MLB starters' K lines are 5.5–8.5. Below 4.5 = the "starter" is a
 *  reliever spot-starting (2-3 IP) or an opener piggybacked by long relief.
 *  Verified 2026-08-11: Drew Anderson opened for the Tigers with a 3.5 K line —
 *  41 games, 3 starts on the year, 10.4 K/9 in relief. The projector saw a
 *  high K/9 and priced Under 3.5 as high-confidence without knowing he'd pitch
 *  two innings. Any prop on him is a workload lottery, not a repeatable edge. */
export const MIN_STARTER_KS_LINE = 4.5;

/** Real starters' outs line is 15.5+. Under 12 = bullpen game. */
export const MIN_STARTER_OUTS_LINE = 12;

/** True when this pitcher prop is really on a reliever making a spot start.
 *  Bullpen games are unpublishable — the projector's rate-per-inning inputs
 *  don't map to the innings the pitcher will actually see. */
export function isBullpenPitcherProp(market: string, line: number): boolean {
  if (market === "pitcher_strikeouts" && line < MIN_STARTER_KS_LINE)
    return true;
  if (market === "pitcher_outs" && line < MIN_STARTER_OUTS_LINE) return true;
  return false;
}
