import { NextResponse } from "next/server";
import { getNBATeamAbbrev } from "@/lib/nba/stats-api";

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
    const games = (data.data ?? []).map((game: any) => ({
      id: String(game.id),
      homeTeam: game.home_team?.full_name ?? "",
      awayTeam: game.visitor_team?.full_name ?? "",
      homeAbbrev: game.home_team?.abbreviation ?? getNBATeamAbbrev(game.home_team?.full_name ?? ""),
      awayAbbrev: game.visitor_team?.abbreviation ?? getNBATeamAbbrev(game.visitor_team?.full_name ?? ""),
      homeScore: game.home_team_score ?? 0,
      awayScore: game.visitor_team_score ?? 0,
      status: game.status === "Final" ? "final" : game.period > 0 ? "live" : "pre",
      period: game.period ?? 0,
      startTime: game.datetime ?? game.date,
      venue: "",
      homePitcher: "", // N/A for NBA
      awayPitcher: "",
      detailedStatus: game.status ?? "",
    }));

    return NextResponse.json({ games, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error("NBA scores error:", error);
    return NextResponse.json({ games: [], error: "Failed to fetch NBA scores" });
  }
}
