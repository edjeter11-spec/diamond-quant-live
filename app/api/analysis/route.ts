import { NextResponse } from "next/server";
import {
  fetchTodayGames,
  getGameStatus,
  getTeamAbbrev,
} from "@/lib/mlb/stats-api";
import { buildTeamStats, buildGameState } from "@/lib/mlb/team-ratings";
import { calculateLiveEdge, generateReasoning } from "@/lib/model/engine";
import { getGameWeather, getTeamFatigue } from "@/lib/mlb/weather-fatigue";
import {
  fetchOdds,
  parseOddsLines,
  findBestLine,
} from "@/lib/odds/the-odds-api";
import { getApiKey } from "@/lib/odds/api-keys";
import { buildPickMath, type PickMath } from "@/lib/bot/prop-reasoning";
import type { OddsLine } from "@/lib/model/types";

export const revalidate = 60;
export const maxDuration = 60;

// Team ID lookup for MLB Stats API
const TEAM_IDS: Record<string, number> = {
  "Arizona Diamondbacks": 109,
  "Atlanta Braves": 144,
  "Baltimore Orioles": 110,
  "Boston Red Sox": 111,
  "Chicago Cubs": 112,
  "Chicago White Sox": 145,
  "Cincinnati Reds": 113,
  "Cleveland Guardians": 114,
  "Colorado Rockies": 115,
  "Detroit Tigers": 116,
  "Houston Astros": 117,
  "Kansas City Royals": 118,
  "Los Angeles Angels": 108,
  "Los Angeles Dodgers": 119,
  "Miami Marlins": 146,
  "Milwaukee Brewers": 158,
  "Minnesota Twins": 142,
  "New York Mets": 121,
  "New York Yankees": 147,
  Athletics: 133,
  "Oakland Athletics": 133,
  "Philadelphia Phillies": 143,
  "Pittsburgh Pirates": 134,
  "San Diego Padres": 135,
  "San Francisco Giants": 137,
  "Seattle Mariners": 136,
  "St. Louis Cardinals": 138,
  "Tampa Bay Rays": 139,
  "Texas Rangers": 140,
  "Toronto Blue Jays": 141,
  "Washington Nationals": 120,
};

export async function GET() {
  try {
    const games = await fetchTodayGames();

    // Fetch live MLB odds once for the whole slate (best-effort — if the key
    // is exhausted or the fetch fails, picks still render without odds/value).
    let oddsByGame: Map<string, OddsLine[]> = new Map();
    try {
      const apiKey = getApiKey();
      if (apiKey) {
        const rawOddsGames = await fetchOdds(apiKey, "baseball_mlb");
        for (const og of rawOddsGames) {
          const key = `${og.away_team}@${og.home_team}`;
          oddsByGame.set(key, parseOddsLines(og));
        }
      }
    } catch {}

    const analyses = await Promise.all(
      games.slice(0, 8).map(async (game) => {
        const homeName = game.teams.home.team.name;
        const awayName = game.teams.away.team.name;
        const homeId = TEAM_IDS[homeName];
        const awayId = TEAM_IDS[awayName];

        const homeAbbrev = getTeamAbbrev(homeName);

        // Build team stats, weather, and fatigue in parallel
        const [homeStats, awayStats, weather, homeFatigue, awayFatigue] =
          await Promise.all([
            buildTeamStats(homeName, homeId),
            buildTeamStats(awayName, awayId),
            getGameWeather(homeAbbrev).catch(() => null),
            getTeamFatigue(homeName).catch(() => null),
            getTeamFatigue(awayName).catch(() => null),
          ]);

        // Build game state
        const gameState = buildGameState(
          {
            inning: game.linescore?.currentInning ?? 0,
            inningHalf: game.linescore?.inningHalf ?? "top",
            outs: game.linescore?.outs ?? 0,
            homeScore: game.teams.home.score ?? 0,
            awayScore: game.teams.away.score ?? 0,
            status: getGameStatus(game),
          },
          game.teams.home.probablePitcher?.fullName ?? "TBD",
          game.teams.away.probablePitcher?.fullName ?? "TBD",
        );

        // Run the quant engine
        const homeWinProb = calculateLiveEdge(homeStats, awayStats, gameState);
        const reasoning = generateReasoning(homeStats, awayStats, gameState);

        // Add weather + fatigue reasoning
        if (weather) reasoning.push(weather.summary);
        if (homeFatigue && homeFatigue.fatigueScore > 25)
          reasoning.push(homeFatigue.summary);
        if (awayFatigue && awayFatigue.fatigueScore > 25)
          reasoning.push(awayFatigue.summary);

        // ── Sportsbook value: best price on the model's favored side ──
        const oddsLines = oddsByGame.get(`${awayName}@${homeName}`) ?? [];
        const isHomeFavored = homeWinProb >= 0.5;
        let math: PickMath | undefined;
        let bestBook = "";
        let bestOdds = 0;
        let pick = "";
        if (oddsLines.length > 0) {
          const bestHome = findBestLine(oddsLines, "home", "ml");
          const bestAway = findBestLine(oddsLines, "away", "ml");
          const pickSide = isHomeFavored ? bestHome : bestAway;
          const oppSide = isHomeFavored ? bestAway : bestHome;
          if (pickSide.odds !== -Infinity) {
            bestBook = pickSide.bookmaker;
            bestOdds = pickSide.odds;
            pick = `${isHomeFavored ? homeName : awayName} ML`;
            math = buildPickMath(
              isHomeFavored ? homeWinProb : 1 - homeWinProb,
              pickSide.odds,
              oppSide.odds !== -Infinity ? oppSide.odds : undefined,
            );
            reasoning.push(
              `Best price: ${pick} ${bestOdds > 0 ? "+" : ""}${bestOdds} at ${bestBook} (model ${math.modelProb.toFixed(1)}% vs ${math.impliedProb.toFixed(1)}% implied, EV ${math.evPct >= 0 ? "+" : ""}${math.evPct.toFixed(1)}%)`,
            );
          }
        }

        return {
          gameId: String(game.gamePk),
          homeTeam: homeName,
          awayTeam: awayName,
          homeAbbrev,
          awayAbbrev: getTeamAbbrev(awayName),
          homeWinProb: Math.round(homeWinProb * 1000) / 10,
          awayWinProb: Math.round((1 - homeWinProb) * 1000) / 10,
          weather: weather ?? undefined,
          homeFatigue: homeFatigue ?? undefined,
          awayFatigue: awayFatigue ?? undefined,
          homeStats: {
            pitching: homeStats.pitching,
            hitting: homeStats.hitting,
            bullpen: homeStats.bullpen,
            defense: homeStats.defense,
          },
          awayStats: {
            pitching: awayStats.pitching,
            hitting: awayStats.hitting,
            bullpen: awayStats.bullpen,
            defense: awayStats.defense,
          },
          reasoning,
          status: getGameStatus(game),
          // ── Math breakdown + sportsbook value (additive) ──
          pick: pick || undefined,
          bookmaker: bestBook || undefined,
          bestBook: bestBook || undefined,
          marketOdds: bestOdds || undefined,
          bestOdds: bestOdds || undefined,
          modelProb: math?.modelProb,
          impliedProb: math?.impliedProb,
          fairOdds: math?.fairOdds,
          edgePct: math?.edgePct,
          evPct: math?.evPct,
        };
      }),
    );

    return NextResponse.json({
      analyses,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Analysis API error:", error);
    return NextResponse.json({
      analyses: [],
      message: "Analysis temporarily unavailable",
    });
  }
}
