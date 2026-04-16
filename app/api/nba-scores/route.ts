import { NextResponse } from "next/server";
import { getNBATeamAbbrev } from "@/lib/nba/stats-api";

// Home arena for each NBA team abbreviation
const NBA_ARENAS: Record<string, string> = {
  ATL: "State Farm Arena", BOS: "TD Garden", BKN: "Barclays Center",
  CHA: "Spectrum Center", CHI: "United Center", CLE: "Rocket Mortgage FieldHouse",
  DAL: "American Airlines Center", DEN: "Ball Arena", DET: "Little Caesars Arena",
  GSW: "Chase Center", HOU: "Toyota Center", IND: "Gainbridge Fieldhouse",
  LAC: "Crypto.com Arena", LAL: "Crypto.com Arena", MEM: "FedExForum",
  MIA: "Kaseya Center", MIL: "Fiserv Forum", MIN: "Target Center",
  NOP: "Smoothie King Center", NYK: "Madison Square Garden", OKC: "Paycom Center",
  ORL: "Amway Center", PHI: "Wells Fargo Center", PHX: "Footprint Center",
  POR: "Moda Center", SAC: "Golden 1 Center", SAS: "Frost Bank Center",
  TOR: "Scotiabank Arena", UTA: "Delta Center", WAS: "Capital One Arena",
};

export const revalidate = 30;

// NBA scores from the free scoreboard endpoint
export async function GET() {
  try {
    // Use balldontlie for today's games
    const today = new Date().toISOString().split("T")[0];
    const res = await fetch(
      `https://api.balldontlie.io/v1/games?dates[]=${today}`,
      {
        headers: { "Authorization": "" }, // free tier, no key needed for basic
        next: { revalidate: 30 },
      }
    );

    if (!res.ok) {
      // Fallback: return empty with message
      return NextResponse.json({
        games: [],
        message: "NBA scores temporarily unavailable",
      });
    }

    const data = await res.json();
    const games = (data.data ?? []).map((game: any) => {
      const homeAbbrev = game.home_team?.abbreviation ?? getNBATeamAbbrev(game.home_team?.full_name ?? "");
      const awayAbbrev = game.visitor_team?.abbreviation ?? getNBATeamAbbrev(game.visitor_team?.full_name ?? "");
      const period = game.period ?? 0;
      const isLive = period > 0 && game.status !== "Final";
      const isFinal = game.status === "Final";

      // Parse time remaining from status like "3 qtr 10:35" or game.time
      let timeRemaining = game.time ?? "";
      // balldontlie sometimes returns status like "Q3 10:35"
      if (!timeRemaining && game.status && !isFinal && game.status.match(/\d/)) {
        const timeMatch = game.status.match(/(\d+:\d+)/);
        if (timeMatch) timeRemaining = timeMatch[1];
      }

      const periodLabel = period === 0 ? "" :
        period <= 4 ? `Q${period}` :
        period === 5 ? "OT" : `${period - 4}OT`;

      return {
        id: String(game.id),
        homeTeam: game.home_team?.full_name ?? "",
        awayTeam: game.visitor_team?.full_name ?? "",
        homeAbbrev,
        awayAbbrev,
        homeScore: game.home_team_score ?? 0,
        awayScore: game.visitor_team_score ?? 0,
        status: isFinal ? "final" : isLive ? "live" : "pre",
        period,
        periodLabel,
        timeRemaining,
        // inning/outs not used for NBA but GameCard type expects them
        inning: period,
        inningHalf: "top",
        outs: 0,
        startTime: game.datetime ?? game.date ?? new Date().toISOString(),
        venue: NBA_ARENAS[homeAbbrev] ?? `${game.home_team?.city ?? ""} Arena`,
        homePitcher: "", // N/A for NBA
        awayPitcher: "",
        weather: null,
        detailedStatus: isFinal ? "Final" : isLive ? `${periodLabel} ${timeRemaining}`.trim() : game.status ?? "",
        // NBA-specific
        isNBA: true,
      };
    });

    return NextResponse.json({ games, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error("NBA scores error:", error);
    return NextResponse.json({ games: [], error: "Failed to fetch NBA scores" });
  }
}
