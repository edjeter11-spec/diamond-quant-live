import { NextResponse } from "next/server";
import { fetchMLBOdds, parseOddsLines, findBestLine } from "@/lib/odds/the-odds-api";
import { findArbitrage, findEVBets } from "@/lib/odds/arbitrage";

export const revalidate = 30;

export async function GET() {
  const apiKey = process.env.THE_ODDS_API_KEY;

  if (!apiKey) {
    // Return demo data when no API key is configured
    return NextResponse.json({
      games: getDemoOdds(),
      timestamp: new Date().toISOString(),
      demo: true,
    });
  }

  try {
    const rawGames = await fetchMLBOdds(apiKey);

    const games = rawGames.map((game) => {
      const oddsLines = parseOddsLines(game);
      const arbitrage = findArbitrage(oddsLines, `${game.away_team} @ ${game.home_team}`);
      const evBets = findEVBets(oddsLines, `${game.away_team} @ ${game.home_team}`);

      const bestHomeML = findBestLine(oddsLines, "home", "ml");
      const bestAwayML = findBestLine(oddsLines, "away", "ml");
      const bestOver = findBestLine(oddsLines, "home", "total_over");
      const bestUnder = findBestLine(oddsLines, "home", "total_under");

      return {
        id: game.id,
        homeTeam: game.home_team,
        awayTeam: game.away_team,
        commenceTime: game.commence_time,
        oddsLines,
        arbitrage,
        evBets,
        bestLines: { bestHomeML, bestAwayML, bestOver, bestUnder },
      };
    });

    return NextResponse.json({
      games,
      timestamp: new Date().toISOString(),
      demo: false,
    });
  } catch (error) {
    console.error("Odds API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch odds", games: getDemoOdds() },
      { status: 500 }
    );
  }
}

// Demo data for development / when no API key
function getDemoOdds() {
  const books = ["DraftKings", "FanDuel", "BetMGM", "PointsBet", "Caesars"];
  const games = [
    { home: "New York Yankees", away: "Boston Red Sox", homeBase: -145, total: 9.0 },
    { home: "Los Angeles Dodgers", away: "San Francisco Giants", homeBase: -180, total: 8.5 },
    { home: "Houston Astros", away: "Texas Rangers", homeBase: -130, total: 8.0 },
    { home: "Atlanta Braves", away: "Philadelphia Phillies", homeBase: 105, total: 8.5 },
    { home: "Chicago Cubs", away: "St. Louis Cardinals", homeBase: -115, total: 7.5 },
    { home: "San Diego Padres", away: "Arizona Diamondbacks", homeBase: -155, total: 8.0 },
  ];

  return games.map((g, idx) => {
    const oddsLines = books.map((book) => {
      const variance = Math.floor(Math.random() * 20) - 10;
      const homeML = g.homeBase + variance;
      const awayML = homeML < 0 ? Math.abs(homeML) - 20 + Math.floor(Math.random() * 15) : -(homeML + 20 + Math.floor(Math.random() * 15));

      return {
        bookmaker: book,
        bookmakerKey: book.toLowerCase().replace(/\s/g, ""),
        homeML,
        awayML,
        homeSpread: -1.5,
        awaySpread: 1.5,
        spreadPrice: -110 + Math.floor(Math.random() * 20) - 10,
        total: g.total,
        overPrice: -110 + Math.floor(Math.random() * 15) - 7,
        underPrice: -110 + Math.floor(Math.random() * 15) - 7,
        lastUpdate: new Date().toISOString(),
      };
    });

    const arbitrage = findArbitrage(oddsLines, `${g.away} @ ${g.home}`);
    const evBets = findEVBets(oddsLines, `${g.away} @ ${g.home}`);

    return {
      id: `demo-${idx}`,
      homeTeam: g.home,
      awayTeam: g.away,
      commenceTime: new Date(Date.now() + idx * 3600000).toISOString(),
      oddsLines,
      arbitrage,
      evBets,
      bestLines: {
        bestHomeML: findBestLine(oddsLines, "home", "ml"),
        bestAwayML: findBestLine(oddsLines, "away", "ml"),
        bestOver: findBestLine(oddsLines, "home", "total_over"),
        bestUnder: findBestLine(oddsLines, "home", "total_under"),
      },
    };
  });
}
