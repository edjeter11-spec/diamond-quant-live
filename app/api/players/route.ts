import { NextResponse } from "next/server";
import { fetchMLBOdds, fetchPlayerProps, parsePlayerProps } from "@/lib/odds/the-odds-api";
import { devig } from "@/lib/model/kelly";

export const revalidate = 60;

const PROP_MARKETS = [
  "pitcher_strikeouts",
  "batter_hits",
  "batter_total_bases",
  "batter_home_runs",
  "batter_rbis",
  "batter_runs_scored",
  "batter_stolen_bases",
  "pitcher_outs",
];

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const market = searchParams.get("market") || "pitcher_strikeouts";
  const apiKey = process.env.THE_ODDS_API_KEY;

  if (!apiKey) {
    return NextResponse.json({
      props: getDemoProps(),
      markets: PROP_MARKETS,
      demo: true,
    });
  }

  try {
    // Fetch all MLB events first
    const games = await fetchMLBOdds(apiKey);

    // Fetch props for today's games (limit to first 3 to conserve API calls)
    const todayGames = games
      .filter((g) => {
        const gameTime = new Date(g.commence_time);
        const now = new Date();
        // Only games within next 12 hours
        return gameTime.getTime() - now.getTime() < 12 * 60 * 60 * 1000 &&
               gameTime.getTime() > now.getTime() - 4 * 60 * 60 * 1000;
      })
      .slice(0, 4);

    const allProps: any[] = [];

    for (const game of todayGames) {
      try {
        const data = await fetchPlayerProps(apiKey, game.id, market);
        const props = parsePlayerProps(data);
        // Tag each prop with the game name
        for (const prop of props) {
          prop.team = `${game.away_team} @ ${game.home_team}`;
        }
        allProps.push(...props);
      } catch {
        // Some games may not have props yet
      }
    }

    // Group by player, find best lines
    const grouped = groupByPlayer(allProps);

    return NextResponse.json({
      props: grouped.length > 0 ? grouped : getDemoProps(),
      markets: PROP_MARKETS,
      events: todayGames.map((g) => ({
        id: g.id,
        game: `${g.away_team} @ ${g.home_team}`,
        time: g.commence_time,
      })),
      demo: grouped.length === 0,
    });
  } catch (error) {
    console.error("Props API error:", error);
    return NextResponse.json({
      props: getDemoProps(),
      markets: PROP_MARKETS,
      demo: true,
      error: "Failed to fetch live props",
    });
  }
}

function groupByPlayer(props: ReturnType<typeof parsePlayerProps>) {
  const grouped = new Map<string, typeof props>();

  for (const prop of props) {
    const key = `${prop.playerName}-${prop.market}`;
    const existing = grouped.get(key) || [];
    existing.push(prop);
    grouped.set(key, existing);
  }

  return Array.from(grouped.entries()).map(([_key, lines]) => {
    const bestOver = lines.reduce((best, l) => l.overPrice > best.overPrice ? l : best, lines[0]);
    const bestUnder = lines.reduce((best, l) => l.underPrice > best.underPrice ? l : best, lines[0]);

    const { prob1: fairOverProb } = devig(bestOver.overPrice, bestUnder.underPrice);

    return {
      playerName: lines[0].playerName,
      line: lines[0].line,
      market: lines[0].market,
      team: lines[0].team,
      books: lines.map((l) => ({
        bookmaker: l.bookmaker,
        overPrice: l.overPrice,
        underPrice: l.underPrice,
      })),
      bestOver: { bookmaker: bestOver.bookmaker, price: bestOver.overPrice },
      bestUnder: { bookmaker: bestUnder.bookmaker, price: bestUnder.underPrice },
      fairOverProb: Math.round(fairOverProb * 10000) / 100,
      fairUnderProb: Math.round((1 - fairOverProb) * 10000) / 100,
    };
  });
}

function getDemoProps() {
  const players = [
    { name: "Gerrit Cole", line: 7.5, market: "pitcher_strikeouts", team: "NYY" },
    { name: "Clayton Kershaw", line: 5.5, market: "pitcher_strikeouts", team: "LAD" },
    { name: "Aaron Judge", line: 1.5, market: "batter_total_bases", team: "NYY" },
    { name: "Mookie Betts", line: 1.5, market: "batter_hits", team: "LAD" },
    { name: "Shohei Ohtani", line: 0.5, market: "batter_home_runs", team: "LAD" },
    { name: "Rafael Devers", line: 1.5, market: "batter_total_bases", team: "BOS" },
    { name: "Bobby Witt Jr.", line: 1.5, market: "batter_hits", team: "KC" },
    { name: "Framber Valdez", line: 5.5, market: "pitcher_strikeouts", team: "HOU" },
  ];

  return players.map((p) => ({
    playerName: p.name,
    line: p.line,
    market: p.market,
    team: p.team,
    books: [
      { bookmaker: "DraftKings", overPrice: -115 + Math.floor(Math.random() * 20), underPrice: -105 + Math.floor(Math.random() * 15) },
      { bookmaker: "FanDuel", overPrice: -120 + Math.floor(Math.random() * 25), underPrice: -100 + Math.floor(Math.random() * 15) },
      { bookmaker: "BetMGM", overPrice: -110 + Math.floor(Math.random() * 20), underPrice: -110 + Math.floor(Math.random() * 15) },
    ],
    bestOver: { bookmaker: "FanDuel", price: -105 },
    bestUnder: { bookmaker: "DraftKings", price: -100 },
    fairOverProb: 48 + Math.floor(Math.random() * 8),
    fairUnderProb: 48 + Math.floor(Math.random() * 8),
  }));
}
