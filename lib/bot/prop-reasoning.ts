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

  const factors = rawFactors.map(f => {
    const direction: "over" | "under" | "neutral" =
      f.signal > 0.05 ? "over" : f.signal < -0.05 ? "under" : "neutral";

    let explanation = "";
    if (f.name === "seasonAverage") {
      const diff = seasonAvg - line;
      explanation = diff > 0
        ? `Season avg ${seasonAvg.toFixed(1)} is ${diff.toFixed(1)} above the line`
        : `Season avg ${seasonAvg.toFixed(1)} is ${Math.abs(diff).toFixed(1)} below the line`;
    } else if (f.name === "recentForm") {
      if (last5Avg !== undefined) {
        const diff = last5Avg - seasonAvg;
        explanation = diff > 1.5 ? `L5 avg ${last5Avg.toFixed(1)} — running hot vs season avg`
          : diff < -1.5 ? `L5 avg ${last5Avg.toFixed(1)} — cooling off vs season avg`
          : `L5 avg ${last5Avg.toFixed(1)} — tracking with season average`;
      } else {
        explanation = f.signal > 0.1 ? "Recent games trending above season average"
          : f.signal < -0.1 ? "Recent games trending below season average"
          : "Recent form in line with season average";
      }
    } else if (f.name === "matchupDefense") {
      explanation = f.signal > 0.15 ? "Weak opponent defense — favorable matchup"
        : f.signal < -0.15 ? "Strong opponent defense — tough matchup"
        : "Average defensive matchup";
    } else if (f.name === "homeAway") {
      explanation = f.signal > 0 ? "Home game — small production boost"
        : f.signal < 0 ? "Road game — small statistical dip"
        : "Neutral venue factor";
    } else if (f.name === "restSchedule") {
      explanation = f.signal < -0.1 ? "Back-to-back fatigue risk"
        : f.signal > 0.05 ? "Well-rested (3+ days off)"
        : "Normal rest";
    } else if (f.name === "paceContext") {
      explanation = f.signal > 0.1 ? "High-paced game projected — more possessions, more stats"
        : f.signal < -0.1 ? "Slow-paced or blowout risk — fewer stats"
        : "Average game pace";
    } else if (f.name === "lineMovement") {
      explanation = f.signal > 0.1 ? "Line moved up — sharp money on the over"
        : f.signal < -0.1 ? "Line moved down — sharp money on the under"
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
    .filter(f => Math.abs(f.signal) > 0.1)
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, 2);

  const summary = topFactors.length > 0
    ? `Brain leans ${side.toUpperCase()}: ${topFactors.map(f => f.explanation.split("—")[0].trim()).join(", ")}`
    : `Brain leans ${side.toUpperCase()} based on overall profile`;

  return { factors, summary, seasonAvg, line, side };
}
