import { NextResponse } from "next/server";
import { analyzeAllGames } from "@/lib/bot/three-models";
import { getCached, setCache } from "@/lib/odds/server-cache";
import {
  fetchMLBOdds,
  parseOddsLines,
  findBestLine,
} from "@/lib/odds/the-odds-api";
import {
  getApiKey,
  markKeyExhausted,
  getActiveKeyCount,
  getKeyCount,
} from "@/lib/odds/api-keys";
import { getFreeEvents } from "@/lib/odds/free-events";
import {
  fetchTodayGames,
  getGameStatus,
  getTeamAbbrev,
} from "@/lib/mlb/stats-api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CACHE_KEY = "bot_analysis";
const CACHE_TTL = 600_000; // 10 min
const STALE_TTL = 6 * 60 * 60 * 1000; // serve up to 6h-old data instead of an empty tab

export async function GET() {
  const cached = getCached(CACHE_KEY, CACHE_TTL);
  if (cached) return NextResponse.json(cached);

  try {
    // Scores from the free MLB Stats API (no key required)
    const scoresRaw = await fetchTodayGames().catch(() => [] as any[]);

    // Odds with key rotation — mirrors /api/odds. Previously a single
    // exhausted/dead key returned [] silently and the whole MLB bot tab
    // showed "waiting for game data" forever.
    let oddsRaw: any[] = [];
    // Try every configured key — see app/api/odds/route.ts for why 3 wasn't
    // enough (in-memory exhausted-set doesn't survive cold starts).
    const maxAttempts = getKeyCount();
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const key = getApiKey();
      if (!key) break;
      try {
        const raw = await fetchMLBOdds(key);
        const hasData = raw.some((g: any) => (g.bookmakers ?? []).length > 0);
        if (!hasData && getActiveKeyCount() > 1) {
          markKeyExhausted(key);
          continue;
        }
        oddsRaw = raw;
        break;
      } catch (e) {
        console.error(
          `Bot-analysis odds fetch failed (attempt ${attempt + 1}):`,
          e instanceof Error ? e.message : e,
        );
        markKeyExhausted(key);
      }
    }
    {
      const activeAfter = getActiveKeyCount();
      if (activeAfter <= 1) {
        console.warn(
          `[ODDS QUOTA CRITICAL] only ${activeAfter}/${getKeyCount()} keys active`,
        );
      }
    }

    // Build scores
    const scores = scoresRaw.map((game: any) => ({
      id: String(game.gamePk),
      homeTeam: game.teams?.home?.team?.name ?? "",
      awayTeam: game.teams?.away?.team?.name ?? "",
      homeAbbrev: getTeamAbbrev(game.teams?.home?.team?.name ?? ""),
      awayAbbrev: getTeamAbbrev(game.teams?.away?.team?.name ?? ""),
      homeScore: game.teams?.home?.score ?? 0,
      awayScore: game.teams?.away?.score ?? 0,
      status: getGameStatus(game),
      venue: game.venue?.name ?? "",
      homePitcher: game.teams?.home?.probablePitcher?.fullName ?? "TBD",
      awayPitcher: game.teams?.away?.probablePitcher?.fullName ?? "TBD",
    }));

    // Build odds - filter to TODAY's games only (ET)
    const now = Date.now();
    const todayET = new Date().toLocaleDateString("en-US", {
      timeZone: "America/New_York",
    });
    const isTodayGame = (commenceTime: string) => {
      const t = new Date(commenceTime).getTime();
      const gameDay = new Date(commenceTime).toLocaleDateString("en-US", {
        timeZone: "America/New_York",
      });
      return t > now - 4 * 60 * 60 * 1000 && gameDay === todayET;
    };
    let oddsGames = oddsRaw
      .filter((g: any) => isTodayGame(g.commence_time))
      .map((game: any) => {
        const oddsLines = parseOddsLines(game);
        return {
          id: game.id,
          homeTeam: game.home_team,
          awayTeam: game.away_team,
          commenceTime: game.commence_time,
          oddsLines,
          evBets: [],
          bestLines: {
            bestHomeML: findBestLine(oddsLines, "home", "ml"),
            bestAwayML: findBestLine(oddsLines, "away", "ml"),
            bestOver: findBestLine(oddsLines, "home", "total_over"),
            bestUnder: findBestLine(oddsLines, "home", "total_under"),
          },
        };
      });

    // Free-events fallback (same pattern as /api/nba-analysis): when no odds
    // are available, still analyze today's slate off the free MLB schedule so
    // the bot tab shows pitcher/Elo analysis instead of nothing.
    if (oddsGames.length === 0) {
      const events = await getFreeEvents("baseball_mlb").catch(
        () => [] as any[],
      );
      oddsGames = events
        .filter((e: any) => isTodayGame(e.commence_time))
        .map((e: any) => ({
          id: String(e.id),
          homeTeam: e.home_team,
          awayTeam: e.away_team,
          commenceTime: e.commence_time,
          oddsLines: [] as any[],
          evBets: [],
          bestLines: {
            bestHomeML: { bookmaker: "", odds: 0 },
            bestAwayML: { bookmaker: "", odds: 0 },
            bestOver: { bookmaker: "", odds: 0 },
            bestUnder: { bookmaker: "", odds: 0 },
          },
        }));
    }

    const analyses = await analyzeAllGames(oddsGames, scores);

    const response = {
      analyses,
      timestamp: new Date().toISOString(),
      gamesAnalyzed: analyses.length,
      debug: { oddsGamesCount: oddsGames.length, scoresCount: scores.length },
      highConfidence: analyses.filter(
        (a: any) => a.consensus.confidence === "HIGH",
      ).length,
      disagreements: analyses.filter((a: any) => !a.consensus.modelsAgree)
        .length,
    };

    // Only cache non-empty results — a transient empty flake shouldn't blank
    // the tab for the next 10 minutes when we have recent good data.
    if (analyses.length > 0) {
      setCache(CACHE_KEY, response);
    } else {
      const stale = getCached(CACHE_KEY, STALE_TTL);
      if (stale) return NextResponse.json({ ...stale, stale: true });
    }
    return NextResponse.json(response);
  } catch (error: any) {
    console.error("Bot analysis error:", error);
    // Stale-while-error: last good analysis beats an empty tab
    const stale = getCached(CACHE_KEY, STALE_TTL);
    if (stale) return NextResponse.json({ ...stale, stale: true });
    return NextResponse.json({
      analyses: [],
      message: "Analysis temporarily unavailable",
    });
  }
}
