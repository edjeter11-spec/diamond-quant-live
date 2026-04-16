import { NextRequest, NextResponse } from "next/server";
import { cloudGet, cloudSet } from "@/lib/supabase/client";
import { loadNbaPropBrainFromCloud } from "@/lib/bot/nba-prop-brain";
import { projectProp } from "@/lib/bot/nba-prop-projector";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export interface PropPickOfDay {
  playerName: string;
  team: string;
  propType: string;       // "Points" | "Rebounds" | "Assists"
  market: string;         // "player_points" etc.
  line: number;
  side: "over" | "under";
  probability: number;    // 0-1
  projectedValue: number;
  odds: number;
  bookmaker: string;
  gameTime: string;
  brainConfidence: number; // 0-100
}

export interface PropPicksToday {
  picks: PropPickOfDay[];
  generatedAt: string;
  updatedAt: string;
  totalPropsAnalyzed: number;
}

const CACHE_KEY_PREFIX = "prop_picks_today_nba";
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const force = searchParams.get("force") === "true";
  const today = new Date().toISOString().split("T")[0];
  const cacheKey = `${CACHE_KEY_PREFIX}_${today}`;

  // Return cached if fresh (< 2 hours)
  if (!force) {
    const cached = await cloudGet<PropPicksToday | null>(cacheKey, null);
    if (cached?.generatedAt) {
      const age = Date.now() - new Date(cached.generatedAt).getTime();
      if (age < CACHE_TTL_MS) {
        return NextResponse.json({ ok: true, ...cached, cached: true });
      }
    }
  }

  try {
    // Load the trained brain
    const brain = await loadNbaPropBrainFromCloud();
    if (!brain?.weights || brain.totalGamesProcessed === 0) {
      return NextResponse.json({ ok: false, error: "Brain not trained yet", picks: [] });
    }

    // Fetch today's props for points, rebounds, assists
    const markets = ["player_points", "player_rebounds", "player_assists"];
    const baseUrl = `https://${process.env.VERCEL_URL || "diamond-quant-live.vercel.app"}`;
    const allProjections: Array<PropPickOfDay & { score: number }> = [];

    for (const market of markets) {
      try {
        const res = await fetch(`${baseUrl}/api/players?sport=basketball_nba&market=${market}`, {
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) continue;
        const data = await res.json();
        const props = data.props ?? [];

        for (const prop of props) {
          if (!prop.playerName || !prop.line || prop.line <= 0) continue;
          // Basic stat mapping from prop line (no individual player stats from API)
          const statApprox = { ppg: prop.line, rpg: prop.line, apg: prop.line };
          const ctx = {
            isHome: false,
            isB2B: false,
            leagueAvgTotal: 224,
          };
          const proj = projectProp(statApprox, market, prop.line, brain.weights, ctx);

          // Only include if brain has strong conviction
          if (proj.confidence < 20) continue;

          const label = market === "player_points" ? "Points"
            : market === "player_rebounds" ? "Rebounds"
            : "Assists";

          // Score: distance from 0.5 (conviction) * confidence
          const conviction = Math.abs(proj.probability - 0.5);
          const score = conviction * proj.confidence;

          allProjections.push({
            playerName: prop.playerName,
            team: prop.team ?? "",
            propType: label,
            market,
            line: prop.line,
            side: proj.side,
            probability: proj.probability,
            projectedValue: Math.round(proj.projectedValue * 10) / 10,
            odds: proj.side === "over" ? (prop.bestOver?.price ?? -110) : (prop.bestUnder?.price ?? -110),
            bookmaker: proj.side === "over" ? (prop.bestOver?.bookmaker ?? "") : (prop.bestUnder?.bookmaker ?? ""),
            gameTime: prop.gameTime ?? "",
            brainConfidence: Math.round(proj.confidence),
            score,
          });
        }
      } catch {}
    }

    // Sort by score, dedupe by player (take their best market), take top 4
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

    await cloudSet(cacheKey, result);
    return NextResponse.json({ ok: true, ...result, cached: false });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message, picks: [] }, { status: 500 });
  }
}
