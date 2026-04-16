import { NextRequest, NextResponse } from "next/server";
import { cloudGet, cloudSet } from "@/lib/supabase/client";
import { loadNbaPropBrainFromCloud } from "@/lib/bot/nba-prop-brain";
import { projectProp } from "@/lib/bot/nba-prop-projector";
import { buildReasoning, type BrainReasoning } from "@/lib/bot/prop-reasoning";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export interface PropPickOfDay {
  playerName: string;
  team: string;
  propType: string;
  market: string;
  line: number;
  side: "over" | "under";
  probability: number;
  projectedValue: number;
  odds: number;
  bookmaker: string;
  gameTime: string;
  brainConfidence: number;
  tier: "HIGH" | "MEDIUM" | "LEAN";
  liveOdds: boolean; // true = from today's Odds API, false = brain projection only
  reasoning?: BrainReasoning;
  seasonAvg?: number;
  last5Avg?: number;
}

export interface PropPicksToday {
  picks: PropPickOfDay[];
  generatedAt: string;
  updatedAt: string;
  totalPropsAnalyzed: number;
}

const CACHE_KEY_PREFIX = "prop_picks_today_nba";
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

// Fallback: top NBA stars with 2024-25 season averages
// Used when no live odds are posted yet so the section is never blank
const NBA_STAR_FALLBACK = [
  { playerName: "Shai Gilgeous-Alexander", team: "OKC", ppg: 32.3, rpg: 5.2, apg: 6.4 },
  { playerName: "Nikola Jokic",            team: "DEN", ppg: 29.6, rpg: 13.0, apg: 10.2 },
  { playerName: "Giannis Antetokounmpo",   team: "MIL", ppg: 30.4, rpg: 11.9, apg: 6.5 },
  { playerName: "Luka Doncic",             team: "LAL", ppg: 28.7, rpg: 8.5, apg: 7.8 },
  { playerName: "Jayson Tatum",            team: "BOS", ppg: 26.9, rpg: 8.3, apg: 5.2 },
  { playerName: "Anthony Davis",           team: "LAL", ppg: 26.2, rpg: 12.6, apg: 3.5 },
  { playerName: "Donovan Mitchell",        team: "CLE", ppg: 24.9, rpg: 4.5, apg: 5.0 },
  { playerName: "Kevin Durant",            team: "PHX", ppg: 27.1, rpg: 6.3, apg: 4.0 },
  { playerName: "Joel Embiid",             team: "PHI", ppg: 24.5, rpg: 7.8, apg: 5.7 },
  { playerName: "LeBron James",            team: "LAL", ppg: 23.7, rpg: 8.3, apg: 9.0 },
  { playerName: "Stephen Curry",           team: "GSW", ppg: 26.4, rpg: 4.8, apg: 5.2 },
  { playerName: "Trae Young",              team: "ATL", ppg: 22.6, rpg: 3.0, apg: 11.1 },
  { playerName: "Damian Lillard",          team: "MIL", ppg: 24.3, rpg: 4.4, apg: 7.2 },
  { playerName: "Devin Booker",            team: "PHX", ppg: 25.1, rpg: 4.9, apg: 7.1 },
  { playerName: "Tyrese Haliburton",       team: "IND", ppg: 20.1, rpg: 4.7, apg: 9.2 },
];

// Lines to test per player (slightly offset from their average to create over/under signal)
function getFallbackLines(player: typeof NBA_STAR_FALLBACK[0]) {
  return [
    { market: "player_points", label: "Points", line: Math.round(player.ppg * 2) / 2, stat: { ppg: player.ppg, rpg: player.rpg, apg: player.apg } },
    { market: "player_rebounds", label: "Rebounds", line: Math.round(player.rpg * 2) / 2, stat: { ppg: player.ppg, rpg: player.rpg, apg: player.apg } },
    { market: "player_assists", label: "Assists", line: Math.round(player.apg * 2) / 2, stat: { ppg: player.ppg, rpg: player.rpg, apg: player.apg } },
  ];
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const force = searchParams.get("force") === "true";
  const today = new Date().toISOString().split("T")[0];
  const cacheKey = `${CACHE_KEY_PREFIX}_${today}`;

  // Return cached if fresh and not forced
  if (!force) {
    const cached = await cloudGet<PropPicksToday | null>(cacheKey, null);
    if (cached?.generatedAt) {
      const age = Date.now() - new Date(cached.generatedAt).getTime();
      if (age < CACHE_TTL_MS && cached.picks?.length > 0) {
        return NextResponse.json({ ok: true, ...cached, cached: true });
      }
    }
  }

  try {
    // Load the trained brain (use default weights if not trained — will still produce picks)
    const brain = await loadNbaPropBrainFromCloud();
    const weights = brain?.weights;
    if (!weights) {
      return NextResponse.json({ ok: false, error: "Brain weights missing", picks: [] });
    }

    const allProjections: Array<PropPickOfDay & { score: number }> = [];

    // ── Step 1: Try live odds from the Odds API ──
    let livePropsFound = 0;
    try {
      const markets = ["player_points", "player_rebounds", "player_assists"];
      const baseUrl = `https://${process.env.VERCEL_URL || "diamond-quant-live.vercel.app"}`;

      for (const market of markets) {
        try {
          const res = await fetch(`${baseUrl}/api/players?sport=basketball_nba&market=${market}`, {
            signal: AbortSignal.timeout(7000),
          });
          if (!res.ok) continue;
          const data = await res.json();
          const props = data.props ?? [];
          livePropsFound += props.length;

          for (const prop of props) {
            if (!prop.playerName || !prop.line || prop.line <= 0) continue;
            const seasonAvg = prop.line; // best approx for live odds without real stats
            const statApprox = { ppg: prop.line, rpg: prop.line, apg: prop.line };
            const proj = projectProp(statApprox, market, prop.line, weights, { isHome: false, isB2B: false, leagueAvgTotal: 224 });
            const label = market === "player_points" ? "Points" : market === "player_rebounds" ? "Rebounds" : "Assists";
            const conviction = Math.abs(proj.probability - 0.5);
            const score = conviction * proj.confidence;
            const tier: "HIGH" | "MEDIUM" | "LEAN" = proj.confidence >= 60 ? "HIGH" : proj.confidence >= 40 ? "MEDIUM" : "LEAN";
            const reasoning = buildReasoning(proj.factors, prop.line, proj.side, seasonAvg, label, undefined);
            allProjections.push({
              playerName: prop.playerName, team: prop.team ?? "", propType: label, market,
              line: prop.line, side: proj.side, probability: proj.probability,
              projectedValue: Math.round(proj.projectedValue * 10) / 10,
              odds: proj.side === "over" ? (prop.bestOver?.price ?? -110) : (prop.bestUnder?.price ?? -110),
              bookmaker: proj.side === "over" ? (prop.bestOver?.bookmaker ?? "") : (prop.bestUnder?.bookmaker ?? ""),
              gameTime: prop.gameTime ?? "", brainConfidence: Math.round(proj.confidence),
              tier, liveOdds: true, score, reasoning, seasonAvg,
            });
          }
        } catch {}
      }
    } catch {}

    // ── Step 2: Fallback — run brain on top NBA stars if no live odds ──
    if (livePropsFound === 0) {
      for (const player of NBA_STAR_FALLBACK) {
        for (const { market, label, line, stat } of getFallbackLines(player)) {
          if (line <= 0) continue;
          const proj = projectProp(stat, market, line, weights, { isHome: false, isB2B: false, leagueAvgTotal: 224 });
          const conviction = Math.abs(proj.probability - 0.5);
          const score = conviction * proj.confidence;
          const tier: "HIGH" | "MEDIUM" | "LEAN" = proj.confidence >= 60 ? "HIGH" : proj.confidence >= 40 ? "MEDIUM" : "LEAN";
          const seasonAvg = market === "player_points" ? player.ppg
            : market === "player_rebounds" ? player.rpg
            : player.apg;
          const reasoning = buildReasoning(proj.factors, line, proj.side, seasonAvg, label, undefined);
          allProjections.push({
            playerName: player.playerName, team: player.team, propType: label, market,
            line, side: proj.side, probability: proj.probability,
            projectedValue: Math.round(proj.projectedValue * 10) / 10,
            odds: -110, bookmaker: "", gameTime: "",
            brainConfidence: Math.round(proj.confidence),
            tier, liveOdds: false, score, reasoning, seasonAvg,
          });
        }
      }
    }

    // ── Sort, dedupe by player, take top 4 ──
    allProjections.sort((a, b) => b.score - a.score);
    const seen = new Set<string>();
    const top4: PropPickOfDay[] = [];
    for (const proj of allProjections) {
      if (seen.has(proj.playerName)) continue;
      seen.add(proj.playerName);
      const { score: _, ...pick } = proj;
      top4.push(pick);
      if (top4.length >= 4) break;
    }

    const result: PropPicksToday = {
      picks: top4,
      generatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      totalPropsAnalyzed: allProjections.length,
    };

    if (top4.length > 0) await cloudSet(cacheKey, result);
    return NextResponse.json({ ok: true, ...result, cached: false });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message, picks: [] }, { status: 500 });
  }
}
