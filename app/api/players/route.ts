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
  const eventId = searchParams.get("eventId");
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
    if (eventId) {
      const data = await fetchPlayerProps(apiKey, eventId, market);
      const props = parsePlayerProps(data);

      // Group by player, find best lines
      const grouped = groupByPlayer(props);

      return NextResponse.json({
        props: grouped,
        market,
        eventId,
      });
    }

    // If no eventId, return list of available events
    const games = await fetchMLBOdds(apiKey);
    return NextResponse.json({
      events: games.map((g) => ({
        id: g.id,
        game: `${g.away_team} @ ${g.home_team}`,
        time: g.commence_time,
      })),
      markets: PROP_MARKETS,
    });
  } catch (error) {
    console.error("Props API error:", error);
    return NextResponse.json({ error: "Failed to fetch props" }, { status: 500 });
  }
}

function groupByPlayer(props: ReturnType<typeof parsePlayerProps>) {
  const grouped = new Map<string, typeof props>();

  for (const prop of props) {
    const existing = grouped.get(prop.playerName) || [];
    existing.push(prop);
    grouped.set(prop.playerName, existing);
  }

  return Array.from(grouped.entries()).map(([player, lines]) => {
    // Find best over and under across books
    const bestOver = lines.reduce((best, l) => l.overPrice > best.overPrice ? l : best, lines[0]);
    const bestUnder = lines.reduce((best, l) => l.underPrice > best.underPrice ? l : best, lines[0]);

    // De-vig using best lines for fair probability
    const { prob1: fairOverProb } = devig(bestOver.overPrice, bestUnder.underPrice);

    return {
      playerName: player,
      line: lines[0].line,
      market: lines[0].market,
      books: lines,
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
