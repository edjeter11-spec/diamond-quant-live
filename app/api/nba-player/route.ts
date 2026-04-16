import { NextResponse } from "next/server";
import { buildNBAPlayerProfile } from "@/lib/nba/player-stats";
import { getCached, setCache } from "@/lib/odds/server-cache";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const name = searchParams.get("name");
  const market = searchParams.get("market") || "player_points";
  const line = parseFloat(searchParams.get("line") || "0");

  if (!name) return NextResponse.json({ error: "Player name required" }, { status: 400 });

  // Cache by player + market (10 min)
  const cacheKey = `nba_player_${name.toLowerCase()}_${market}`;
  const cached = getCached(cacheKey, 600_000);
  if (cached) return NextResponse.json(cached);

  try {
    const profile = await buildNBAPlayerProfile(name, market, line);
    if (!profile) return NextResponse.json({ error: "Player not found" }, { status: 404 });

    // Build recommendation
    const statKey = market;
    const avg = profile.statAvg[statKey] ?? 0;
    const hitRate = profile.hitRates[statKey]?.rate ?? 50;
    const gameLog = profile.gameLog;

    // Trend
    const last5 = gameLog.slice(0, 5);
    const first5 = gameLog.slice(5, 10);
    const statGetter: Record<string, (g: any) => number> = {
      player_points: (g) => g.points,
      player_rebounds: (g) => g.rebounds,
      player_assists: (g) => g.assists,
      player_threes: (g) => g.threes,
      player_pra: (g) => g.pra,
    };
    const getter = statGetter[market] ?? ((g: any) => g.points);
    const avg5 = last5.length > 0 ? last5.reduce((s: number, g: any) => s + getter(g), 0) / last5.length : 0;
    const avgF5 = first5.length > 0 ? first5.reduce((s: number, g: any) => s + getter(g), 0) / first5.length : 0;
    const trend = avg5 > avgF5 + 1 ? "up" : avg5 < avgF5 - 1 ? "down" : "flat";

    // Recommendation
    let side: string;
    let confidence: number;
    const reasons: string[] = [];

    if (hitRate >= 70 && avg > line + 1) {
      side = "over"; confidence = Math.min(hitRate, 85);
      reasons.push(`Averaging ${avg} (line: ${line}) — comfortably above`);
      reasons.push(`Hit the over in ${hitRate}% of recent games`);
    } else if (hitRate <= 30 && avg < line - 1) {
      side = "under"; confidence = Math.min(100 - hitRate, 85);
      reasons.push(`Averaging ${avg} (line: ${line}) — consistently under`);
      reasons.push(`Only hit the over in ${hitRate}% of recent games`);
    } else if (hitRate >= 55) {
      side = "lean_over"; confidence = hitRate;
      reasons.push(`Averaging ${avg} vs line of ${line}`);
      reasons.push(`${hitRate}% over rate — slight edge`);
    } else if (hitRate <= 45) {
      side = "lean_under"; confidence = 100 - hitRate;
      reasons.push(`Averaging ${avg} vs line of ${line}`);
      reasons.push(`Only ${hitRate}% over rate`);
    } else {
      side = "no_edge"; confidence = 40;
      reasons.push(`Averaging ${avg} — right at the line of ${line}`);
    }

    if (trend === "up") reasons.push("Trending up — recent games better than earlier stretch");
    if (trend === "down") reasons.push("Trending down — recent performance declining");

    const response = {
      player: profile,
      recommendation: { side, confidence, reasons },
      trend,
      dataSource: profile.gamesPlayed > 0 ? "current" : "lastYear",
    };

    // ── Brain projection ──
    try {
      const { loadNbaPropBrainFromCloud } = await import("@/lib/bot/nba-prop-brain");
      const { projectProp } = await import("@/lib/bot/nba-prop-projector");
      const { buildReasoning } = await import("@/lib/bot/prop-reasoning");

      const brain = await loadNbaPropBrainFromCloud();
      if (brain?.weights && line > 0) {
        const statKey = market === "player_points" ? "ppg" : market === "player_rebounds" ? "rpg" : "apg";
        const seasonAvg = (profile as any)[statKey] ?? profile.statAvg[market] ?? line;
        const last5 = profile.gameLog.slice(0, 5);
        const getter: Record<string, (g: any) => number> = {
          player_points: (g) => g.points,
          player_rebounds: (g) => g.rebounds,
          player_assists: (g) => g.assists,
        };
        const getVal = getter[market] ?? ((g: any) => g.points);
        const last5Avg = last5.length > 0 ? last5.reduce((s: number, g: any) => s + getVal(g), 0) / last5.length : undefined;

        const recentForm = last5.length >= 5 ? {
          last5Avg: last5Avg!,
          last10Avg: profile.gameLog.slice(0, 10).reduce((s: number, g: any) => s + getVal(g), 0) / Math.min(profile.gameLog.length, 10),
          seasonAvg,
          gamesPlayed: profile.gamesPlayed,
          variance: seasonAvg * 0.3,
        } : undefined;

        const proj = projectProp(
          { ppg: profile.ppg, rpg: profile.rpg, apg: profile.apg },
          market, line, brain.weights,
          { isHome: false, isB2B: false, leagueAvgTotal: 224 },
          recentForm
        );

        const propLabel = market === "player_points" ? "Points" : market === "player_rebounds" ? "Rebounds" : "Assists";
        const reasoning = buildReasoning(proj.factors, line, proj.side, seasonAvg, propLabel, last5Avg);

        (response as any).brainProjection = {
          side: proj.side,
          probability: proj.probability,
          confidence: proj.confidence,
          projectedValue: proj.projectedValue,
          reasoning,
          seasonAvg,
          last5Avg,
        };
      }
    } catch {}

    setCache(cacheKey, response);

    // Save to Supabase — cached for future Brain use + instant loading
    try {
      const { cloudSet } = await import("@/lib/supabase/client");
      await cloudSet(`player_nba_${profile.id}`, {
        name: profile.name,
        team: profile.teamAbbrev,
        ppg: profile.ppg,
        rpg: profile.rpg,
        apg: profile.apg,
        position: profile.position,
        photo: profile.photo,
        hitRates: profile.hitRates,
        cachedAt: new Date().toISOString(),
      });
    } catch {}

    return NextResponse.json(response);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
