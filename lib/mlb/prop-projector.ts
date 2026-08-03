// ──────────────────────────────────────────────────────────
// MLB PROP PROJECTOR
//
// Produces an INDEPENDENT probability that a player goes over a given line,
// built from that player's own game logs — not from the odds.
//
// Why this exists: fairProb used to come from de-vigging the market. Comparing
// the market's own opinion to the market's own price measures the vig by
// construction, so every prop priced negative (2026-07-30: 620 sides, best
// -0.3%, median -5.6%). A board built that way can rank honestly but can never
// find an edge. To disagree with a book you need a number the book didn't give
// you.
//
// Approach: model each market with the count distribution that actually fits it
// rather than one generic curve.
//
//   - Per-plate-appearance events (hits, HR, RBI, runs) → BINOMIAL over the
//     expected number of chances. A hitter isn't "1.1 hits per game" so much as
//     ~4 chances at a ~27% success rate, and that distinction is what makes
//     Over 0.5 vs Over 1.5 price differently.
//   - Counting stats with no natural trial cap (strikeouts, total bases, outs)
//     → POISSON on the projected rate.
//
// Rate estimation blends recent form with season baseline, then applies park
// and opponent adjustments. Weights mirror the ones already in
// lib/bot/mlb-prop-brain.ts so the learning loop can tune them later.
//
// Deliberately NOT modelled: umpire assignment, bullpen fatigue, weather, and
// lineup slot. Each is a real effect and each has a module in lib/mlb/, but
// wiring them in without backtesting would be adding unvalidated noise to a
// number the board now depends on. Sequenced as follow-up work.
// ──────────────────────────────────────────────────────────

import { getParkFactor } from "./park-factors";

export interface GameLogRow {
  date: string;
  atBats?: number;
  hits?: number;
  totalBases?: number;
  homeRuns?: number;
  rbi?: number;
  runs?: number;
  strikeouts?: number;
  inningsPitched?: number;
  plateAppearances?: number;
}

export interface ProjectionInput {
  market: string;
  line: number;
  logs: GameLogRow[];
  /** Home park abbreviation, for park factor. */
  parkAbbrev?: string;
  isHome?: boolean;
  /** Opposing team's runs allowed per game, if known. */
  oppRunsAllowedPerGame?: number;
  /**
   * Multiplier on the projected rate from matchup context (opposing starter,
   * platoon split, lineup slot) — see lib/mlb/matchup.ts. Applied AFTER
   * shrinkage, because it adjusts a believed-true rate for tonight's
   * conditions rather than correcting a small sample.
   */
  rateMultiplier?: number;
}

export interface Projection {
  /** Probability the OVER hits, 0-100. */
  overProb: number;
  /** Expected value of the stat. */
  projectedValue: number;
  /** 0-100 — driven by sample size and stability, not by how extreme the pick is. */
  confidence: number;
  /** Human-readable drivers, surfaced in the pick rationale. */
  reasons: string[];
  /** Games of history behind the estimate. */
  sample: number;
}

// Recency weighting. MLB form is genuinely streaky, so recent games carry more
// signal — but a 10-game window alone is far too noisy to price a bet on
// (a hitter can go 2-for-40 and still be a .270 hitter). Blend both.
// Backtest (5,255 held-out predictions, 16 qualified hitters, walk-forward)
// showed a 35% recent weight made things WORSE than season rate alone — MLB
// game-to-game form is mostly noise at this sample size, and chasing it cost
// accuracy. Dropped to 0.15: enough to register a genuine extended hot/cold
// stretch, not enough to let a 3-for-4 night move the line.
const RECENT_WINDOW = 15;
const W_RECENT = 0.15;
const W_SEASON = 0.85;

// Shrinkage toward each market's league mean. A player with 30 games of history
// is not 30/150ths as informative as a full season — small samples produce
// extreme rates that don't repeat. Pulling toward the population mean by a
// sample-dependent amount is standard empirical-Bayes and was the single
// biggest calibration win in the backtest.
const SHRINK_GAMES = 25;

// Regression toward the mean at the probability level. The binomial treats
// plate appearances as independent, but they aren't — same pitcher, same game
// context, same defensive alignment — so true variance is higher than modelled
// and extreme probabilities are overstated. The backtest showed exactly this:
// the 85% bucket hit 69%, the 75% bucket hit 66.5%. This pulls predictions
// toward 50% enough to fix the tails without flattening genuine signal.
const PROB_REGRESSION = 0.18;

// Markets driven by discrete plate appearances → binomial.
// Markets where a plate appearance really is close to an independent trial.
// A hit or a home run depends on THIS batter against THIS pitcher, so
// modelling ~4 PA at rate p is sound.
//
// RBIs and runs scored are deliberately NOT here. Both require game state the
// batter doesn't control — an RBI needs runners already on base, a run needs
// someone behind you to drive you in — so they arrive in clusters rather than
// as independent per-PA events. Treating them as binomial badly overstates
// P(at least one): the model had CJ Abrams at 57.5% to record an RBI on
// 2026-08-03 when his own 109-game history says 45.0% and the market said
// 38.8%. Modelling them as Poisson on the per-game rate reproduces the
// clustering and lands much closer to the observed base rate.
const PA_MARKETS = new Set(["batter_hits", "batter_home_runs"]);

// Markets whose events cluster within a game — see the overdispersion note in
// projectProp. Total bases is included because extra-base hits bunch together
// the same way (a 2-for-4 with a double is one good night, not four
// independent draws).
const CLUSTERED_MARKETS = new Set([
  "batter_rbis",
  "batter_runs_scored",
  "batter_total_bases",
]);

// League-average park factor is 1.0; clamp adjustments so a single extreme
// park can't dominate a projection.
const PARK_MIN = 0.92;
const PARK_MAX = 1.08;

// Approximate league per-game means, used as the shrinkage target. These are
// stable year to year and only need to be roughly right — they set where a
// thin sample gets pulled toward, not the final answer.
const LEAGUE_MEAN: Record<string, number> = {
  batter_hits: 0.85,
  batter_total_bases: 1.38,
  batter_home_runs: 0.14,
  batter_rbis: 0.45,
  batter_runs_scored: 0.45,
  pitcher_strikeouts: 5.1,
  pitcher_outs: 16.5,
};

function mean(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** P(X = k) for Binomial(n, p). */
function binomPmf(k: number, n: number, p: number): number {
  if (k > n || k < 0) return 0;
  if (p <= 0) return k === 0 ? 1 : 0;
  if (p >= 1) return k === n ? 1 : 0;
  // Work in logs — n choose k overflows fast and these are hot-path calls.
  let logC = 0;
  for (let i = 1; i <= k; i++) logC += Math.log((n - k + i) / i);
  return Math.exp(logC + k * Math.log(p) + (n - k) * Math.log(1 - p));
}

/** P(X = k) for Poisson(lambda). */
function poissonPmf(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logFact = 0;
  for (let i = 2; i <= k; i++) logFact += Math.log(i);
  return Math.exp(-lambda + k * Math.log(lambda) - logFact);
}

/**
 * P(X > line). Lines are half-numbers (0.5, 1.5), so "over 0.5" is P(X >= 1) —
 * floor(line) is the largest losing count.
 */
function probOverBinomial(line: number, n: number, p: number): number {
  const maxLosing = Math.floor(line);
  let cum = 0;
  for (let k = 0; k <= maxLosing; k++) cum += binomPmf(k, n, p);
  return 1 - cum;
}

function probOverPoisson(line: number, lambda: number): number {
  const maxLosing = Math.floor(line);
  let cum = 0;
  for (let k = 0; k <= maxLosing; k++) cum += poissonPmf(k, lambda);
  return 1 - cum;
}

function statFor(row: GameLogRow, market: string): number {
  switch (market) {
    case "batter_hits":
      return row.hits ?? 0;
    case "batter_total_bases":
      return row.totalBases ?? 0;
    case "batter_home_runs":
      return row.homeRuns ?? 0;
    case "batter_rbis":
      return row.rbi ?? 0;
    case "batter_runs_scored":
      return row.runs ?? 0;
    case "pitcher_strikeouts":
      return row.strikeouts ?? 0;
    case "pitcher_outs":
      return Math.round((row.inningsPitched ?? 0) * 3);
    default:
      return 0;
  }
}

/**
 * Project a prop. Returns null when there isn't enough history to say anything
 * honest — the caller falls back to market devig rather than inventing a number.
 */
export function projectProp(input: ProjectionInput): Projection | null {
  const {
    market,
    line,
    logs,
    parkAbbrev,
    isHome,
    oppRunsAllowedPerGame,
    rateMultiplier,
  } = input;

  // Pitchers start ~30 times a season; hitters play ~150. Requiring 10 games of
  // a starter's log would rule out most of the season, so the bar is lower for
  // pitcher markets — but never low enough to project off one or two outings.
  const isPitcher =
    market === "pitcher_strikeouts" || market === "pitcher_outs";
  // Raised from 10 to 40 for hitters. At 10 games the shrinkage prior is
  // doing nearly all the work, and what survives is noise dressed as signal:
  // on 2026-08-03 the board's top pick was a 14-game rookie the model had at
  // 62.4% against a 50.0% actual rate, producing a fake +21.8% EV. Against a
  // market that has scouted the player properly, a 14-game log is not an
  // edge — it's the model not knowing enough to disagree.
  //
  // Pitchers stay low because starters make ~30 appearances a season, so 8
  // is already a quarter of their year.
  const MIN_GAMES = isPitcher ? 8 : 40;

  const played = logs.filter(
    (g) => (g.atBats ?? 0) > 0 || (g.inningsPitched ?? 0) > 0,
  );
  if (played.length < MIN_GAMES) return null;

  const seasonVals = played.map((g) => statFor(g, market));
  const recentVals = played
    .slice(-RECENT_WINDOW)
    .map((g) => statFor(g, market));

  const seasonRate = mean(seasonVals);
  const recentRate = mean(recentVals);
  if (seasonRate <= 0 && recentRate <= 0) return null;

  const blended = W_SEASON * seasonRate + W_RECENT * recentRate;

  // Empirical-Bayes shrinkage toward the league mean, weighted by sample size.
  // A 12-game sample lands ~2/3 of the way to league average; a full season
  // barely moves. Without this, thin samples produced extreme rates that the
  // backtest showed simply don't repeat.
  const leagueMean = LEAGUE_MEAN[market] ?? blended;
  const shrinkW = played.length / (played.length + SHRINK_GAMES);
  let rate = shrinkW * blended + (1 - shrinkW) * leagueMean;

  const reasons: string[] = [];
  reasons.push(
    `${seasonRate.toFixed(2)}/gm over ${played.length} games; ${recentRate.toFixed(2)}/gm last ${Math.min(RECENT_WINDOW, played.length)}`,
  );

  // Form adjustment is already inside the blend; this only narrates it when the
  // gap is big enough to matter.
  if (seasonRate > 0) {
    const delta = (recentRate - seasonRate) / seasonRate;
    if (delta >= 0.2) reasons.push("trending up recently");
    else if (delta <= -0.2) reasons.push("cooled off lately");
  }

  // Park factor. Only meaningful for offensive markets — a pitcher's strikeout
  // rate isn't much moved by park dimensions.
  if (parkAbbrev && !isPitcher) {
    const pf = getParkFactor(parkAbbrev);
    const raw =
      market === "batter_home_runs" ? (pf.hr ?? pf.runs ?? 1) : (pf.runs ?? 1);
    const clamped = Math.min(PARK_MAX, Math.max(PARK_MIN, raw));
    if (Math.abs(clamped - 1) > 0.02) {
      rate *= clamped;
      reasons.push(
        clamped > 1
          ? `hitter-friendly park (${parkAbbrev})`
          : `pitcher-friendly park (${parkAbbrev})`,
      );
    }
  }

  // Opponent strength, for hitters only. League average is ~4.3 R/G; scale
  // gently and clamp — this is a coarse proxy for pitching quality.
  if (
    !isPitcher &&
    typeof oppRunsAllowedPerGame === "number" &&
    oppRunsAllowedPerGame > 0
  ) {
    const oppAdj = Math.min(1.08, Math.max(0.92, oppRunsAllowedPerGame / 4.3));
    if (Math.abs(oppAdj - 1) > 0.02) {
      rate *= oppAdj;
      reasons.push(
        oppAdj > 1 ? "favorable pitching matchup" : "tough pitching matchup",
      );
    }
  }

  // Small home-field bump, well documented and modest.
  if (typeof isHome === "boolean" && !isPitcher) {
    rate *= isHome ? 1.02 : 0.98;
  }

  // Matchup context — the signal a game log cannot contain. Applied last, on
  // top of the shrunk rate, because it adjusts a believed-true rate for
  // tonight's opponent rather than correcting for a thin sample. Clamped by
  // the caller (see matchupMultiplier).
  if (typeof rateMultiplier === "number" && rateMultiplier > 0) {
    rate *= rateMultiplier;
  }

  let overProb: number;

  if (PA_MARKETS.has(market)) {
    // Binomial over expected chances. Use real PA when logged, else AB + ~0.12
    // to approximate walks/HBP that don't show as at-bats.
    const paPerGame = mean(
      played.map((g) => g.plateAppearances ?? (g.atBats ?? 0) * 1.12),
    );
    const chances = Math.max(1, Math.round(paPerGame));
    const perChance = Math.min(0.95, Math.max(0.001, rate / chances));
    overProb = probOverBinomial(line, chances, perChance);
    reasons.push(
      `${(perChance * 100).toFixed(1)}% per PA across ~${chances} PA`,
    );
  } else {
    overProb = probOverPoisson(line, rate);

    // Overdispersion correction for run-scoring events.
    //
    // Poisson assumes events arrive independently at a constant rate. RBIs and
    // runs violate that hard: a batter's chances depend on runners being on
    // base (or on teammates behind him), so multi-RBI games and zero-RBI games
    // both cluster more than Poisson allows. The variance is larger than the
    // mean, which inflates P(at least one).
    //
    // Measured against seven hitters' own full-season base rates, the raw
    // Poisson ran +6.2 points high on EVERY player — a systematic bias, not
    // noise. Shrinking the excess over the empirical base rate corrects it
    // without flattening genuine differences between players.
    if (CLUSTERED_MARKETS.has(market)) {
      const empirical =
        seasonVals.filter((v) => v > line).length / seasonVals.length;
      // Trust the player's own observed frequency more as his sample grows.
      const w = Math.min(0.75, played.length / 150);
      overProb = (1 - w) * overProb + w * empirical;
    }

    reasons.push(`projecting ${rate.toFixed(2)}`);
  }

  // Confidence reflects how much we trust the estimate: sample size plus
  // consistency (low variance relative to mean = more repeatable). It is
  // deliberately NOT a function of how far overProb sits from 50% — a confident
  // coinflip and a shaky blowout are different things.
  const sampleScore = Math.min(1, played.length / 40);
  const m = mean(seasonVals);
  const variance = mean(seasonVals.map((v) => (v - m) ** 2));
  const cv = m > 0 ? Math.sqrt(variance) / m : 2;
  const stabilityScore = Math.min(1, Math.max(0, 1.5 - cv) / 1.5);
  const confidence = Math.round(40 + 40 * sampleScore + 20 * stabilityScore);

  // Pull toward 50%. See PROB_REGRESSION — the binomial's independence
  // assumption understates real variance, so raw tails are overconfident.
  let regressed = 0.5 + (overProb - 0.5) * (1 - PROB_REGRESSION);

  // Empirical bias correction, measured on 4,295 held-out predictions across
  // 40 qualified hitters. The mid-range ran consistently hot — the 45% bucket
  // hit 40.6%, the 35% bucket hit 30.2% — because the binomial assumes a
  // hitter gets his full complement of plate appearances, while real games
  // lose PA to blowout pinch-hits, early exits, and short games. That costs
  // roughly a fifth of a PA on average and it lands almost entirely on
  // marginal props. A flat shave is the honest fix at this sample size;
  // anything shaped would be fitting noise.
  regressed -= 0.022;

  return {
    overProb: Math.min(97, Math.max(3, regressed * 100)),
    projectedValue: Math.round(rate * 100) / 100,
    confidence: Math.min(95, confidence),
    reasons,
    sample: played.length,
  };
}
