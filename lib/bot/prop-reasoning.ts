import type { ProjectionFactor } from "./nba-prop-projector";

export interface BrainReasoning {
  factors: Array<{
    name: string;
    label: string;
    signal: number;
    contribution: number;
    direction: "over" | "under" | "neutral";
    explanation: string;
  }>;
  summary: string;
  seasonAvg: number;
  line: number;
  side: "over" | "under";
}

export function buildReasoning(
  rawFactors: ProjectionFactor[],
  line: number,
  side: "over" | "under",
  seasonAvg: number,
  propType: string,
  last5Avg?: number,
): BrainReasoning {
  const FACTOR_LABELS: Record<string, string> = {
    seasonAverage: "Season Average",
    recentForm: "Recent Form (L5)",
    matchupDefense: "Matchup Defense",
    homeAway: "Home/Away",
    restSchedule: "Rest & Schedule",
    paceContext: "Game Pace",
    lineMovement: "Line Movement",
  };

  const factors = rawFactors.map((f) => {
    const direction: "over" | "under" | "neutral" =
      f.signal > 0.05 ? "over" : f.signal < -0.05 ? "under" : "neutral";

    let explanation = "";
    if (f.name === "seasonAverage") {
      const diff = seasonAvg - line;
      explanation =
        diff > 0
          ? `Season avg ${seasonAvg.toFixed(1)} is ${diff.toFixed(1)} above the line`
          : `Season avg ${seasonAvg.toFixed(1)} is ${Math.abs(diff).toFixed(1)} below the line`;
    } else if (f.name === "recentForm") {
      if (last5Avg !== undefined) {
        const diff = last5Avg - seasonAvg;
        explanation =
          diff > 1.5
            ? `L5 avg ${last5Avg.toFixed(1)} — running hot vs season avg`
            : diff < -1.5
              ? `L5 avg ${last5Avg.toFixed(1)} — cooling off vs season avg`
              : `L5 avg ${last5Avg.toFixed(1)} — tracking with season average`;
      } else {
        explanation =
          f.signal > 0.1
            ? "Recent games trending above season average"
            : f.signal < -0.1
              ? "Recent games trending below season average"
              : "Recent form in line with season average";
      }
    } else if (f.name === "matchupDefense") {
      explanation =
        f.signal > 0.15
          ? "Weak opponent defense — favorable matchup"
          : f.signal < -0.15
            ? "Strong opponent defense — tough matchup"
            : "Average defensive matchup";
    } else if (f.name === "homeAway") {
      explanation =
        f.signal > 0
          ? "Home game — small production boost"
          : f.signal < 0
            ? "Road game — small statistical dip"
            : "Neutral venue factor";
    } else if (f.name === "restSchedule") {
      explanation =
        f.signal < -0.1
          ? "Back-to-back fatigue risk"
          : f.signal > 0.05
            ? "Well-rested (3+ days off)"
            : "Normal rest";
    } else if (f.name === "paceContext") {
      explanation =
        f.signal > 0.1
          ? "High-paced game projected — more possessions, more stats"
          : f.signal < -0.1
            ? "Slow-paced or blowout risk — fewer stats"
            : "Average game pace";
    } else if (f.name === "lineMovement") {
      explanation =
        f.signal > 0.1
          ? "Line moved up — sharp money on the over"
          : f.signal < -0.1
            ? "Line moved down — sharp money on the under"
            : "No significant line movement";
    }

    return {
      name: f.name,
      label: FACTOR_LABELS[f.name] ?? f.name,
      signal: f.signal,
      contribution: f.contribution,
      direction,
      explanation,
    };
  });

  const topFactors = [...factors]
    .filter((f) => Math.abs(f.signal) > 0.1)
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, 2);

  const summary =
    topFactors.length > 0
      ? `Brain leans ${side.toUpperCase()}: ${topFactors.map((f) => f.explanation.split("—")[0].trim()).join(", ")}`
      : `Brain leans ${side.toUpperCase()} based on overall profile`;

  return { factors, summary, seasonAvg, line, side };
}

// ──────────────────────────────────────────────────────────
// Shared pick-math breakdown — every pick payload carries this so the UI
// can show model prob vs market implied prob, fair odds, and EV%.
// ──────────────────────────────────────────────────────────

import {
  americanToDecimal,
  americanToImpliedProb,
  probToFairAmerican,
  devig,
  evPercentage,
} from "@/lib/model/kelly";

export interface PickMath {
  /** model's probability the pick hits, percent 0-100 */
  modelProb: number;
  /** market implied probability from the odds actually offered, percent (de-vigged when both sides known) */
  impliedProb: number;
  /** model prob converted to fair American odds */
  fairOdds: number;
  /** modelProb − impliedProb, percentage points */
  edgePct: number;
  /** EV% of stake at the offered odds: (p × decimal − 1) × 100 */
  evPct: number;
  /** the American odds used for the market side of the comparison */
  marketOdds: number;
}

/**
 * Build the math block for one pick.
 * @param modelProb   model probability (0-1 or 0-100, auto-detected)
 * @param marketOdds  American odds actually offered for the pick
 * @param oppositeOdds American odds for the other side (enables de-vig); omit if unknown
 */
export function buildPickMath(
  modelProb: number,
  marketOdds: number,
  oppositeOdds?: number,
): PickMath {
  let p = Number.isFinite(modelProb) ? modelProb : 50;
  if (p > 1) p = p / 100;
  p = Math.min(0.99, Math.max(0.01, p));

  const hasOdds = Number.isFinite(marketOdds) && marketOdds !== 0;
  const implied =
    hasOdds &&
    oppositeOdds &&
    Number.isFinite(oppositeOdds) &&
    oppositeOdds !== 0
      ? devig(marketOdds, oppositeOdds).prob1 // proper two-sided normalization
      : hasOdds
        ? americanToImpliedProb(marketOdds)
        : 0.5;
  const dec = hasOdds ? americanToDecimal(marketOdds) : 1;

  return {
    modelProb: Math.round(p * 1000) / 10,
    impliedProb: Math.round(implied * 1000) / 10,
    fairOdds: probToFairAmerican(p),
    edgePct: Math.round((p - implied) * 1000) / 10,
    evPct: hasOdds ? Math.round(evPercentage(p, dec) * 10) / 10 : 0,
    marketOdds: hasOdds ? marketOdds : 0,
  };
}

/**
 * Flatten a BrainReasoning object + math block into 3-6 plain-English strings
 * that cite the actual numbers used. Works for any sport's factor trace.
 */
export function reasoningToStrings(
  r: BrainReasoning | null | undefined,
  opts?: {
    projection?: number;
    math?: PickMath;
    bookmaker?: string;
    extra?: string[];
  },
): string[] {
  const out: string[] = [];
  const side = r?.side ?? "over";

  if (r && opts?.projection !== undefined && Number.isFinite(opts.projection)) {
    out.push(
      `Projects ${opts.projection.toFixed(1)} vs line ${r.line} — model leans ${side.toUpperCase()}`,
    );
  }

  if (r) {
    const ranked = [...r.factors]
      .filter((f) => f.explanation && Math.abs(f.signal) > 0.05)
      .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
      .slice(0, 3);
    for (const f of ranked) out.push(`${f.label}: ${f.explanation}`);
  }

  if (opts?.math) {
    const m = opts.math;
    if (m.marketOdds !== 0) {
      const oddsStr = m.marketOdds > 0 ? `+${m.marketOdds}` : `${m.marketOdds}`;
      const bookStr = opts.bookmaker ? ` at ${opts.bookmaker}` : "";
      out.push(
        `Model ${m.modelProb.toFixed(1)}% vs ${m.impliedProb.toFixed(1)}% implied (${oddsStr}${bookStr}) → ${m.edgePct >= 0 ? "+" : ""}${m.edgePct.toFixed(1)} pt edge, EV ${m.evPct >= 0 ? "+" : ""}${m.evPct.toFixed(1)}%`,
      );
    } else {
      out.push(
        `Model probability ${m.modelProb.toFixed(1)}% (fair odds ${m.fairOdds > 0 ? "+" : ""}${m.fairOdds}) — no live market line to compare`,
      );
    }
  }

  for (const e of opts?.extra ?? []) {
    if (out.length >= 6) break;
    if (e) out.push(e);
  }

  if (out.length === 0) out.push("Model sees value based on overall profile");
  return out.slice(0, 6);
}

/**
 * Build plain-English reasoning strings from a generic factor trace that
 * already carries explanations (NFL/NHL/MLB projectors emit this shape).
 */
export function factorsToReasonStrings(
  factors: Array<{
    name: string;
    signal: number;
    contribution: number;
    explanation?: string;
  }>,
  header?: string,
  math?: PickMath,
  bookmaker?: string,
): string[] {
  const out: string[] = [];
  if (header) out.push(header);
  const ranked = [...factors]
    .filter((f) => f.explanation && Math.abs(f.signal) > 0.05)
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, 4);
  for (const f of ranked) out.push(f.explanation as string);
  if (math && math.marketOdds !== 0) {
    const oddsStr =
      math.marketOdds > 0 ? `+${math.marketOdds}` : `${math.marketOdds}`;
    const bookStr = bookmaker ? ` at ${bookmaker}` : "";
    out.push(
      `Model ${math.modelProb.toFixed(1)}% vs ${math.impliedProb.toFixed(1)}% implied (${oddsStr}${bookStr}) → EV ${math.evPct >= 0 ? "+" : ""}${math.evPct.toFixed(1)}%`,
    );
  }
  if (out.length === 0) out.push("Model sees value based on overall profile");
  return out.slice(0, 6);
}
