import { NextResponse } from "next/server";

// Lightweight endpoint — returns a slim (id, firstName, lastName, teamAbbrev) list
// of every NBA player, for the client-side headshot lookup cache.
// Delegates to the server-cached NBA player index loader.

export const dynamic = "force-dynamic";
export const revalidate = 3600; // 1 hour

export async function GET() {
  try {
    const { searchNBAPlayer } = await import("@/lib/nba/player-stats");
    // searchNBAPlayer internally calls loadPlayerIndex() which caches globally.
    // We need to access the full list. Use a separate loader.
    const raw: any[] = await loadAllNbaPlayers();
    const slim = raw.map(p => ({
      id: p.id,
      firstName: p.firstName,
      lastName: p.lastName,
      teamAbbrev: p.teamAbbrev,
    }));
    return NextResponse.json({ players: slim, count: slim.length });
  } catch (e: any) {
    return NextResponse.json({ players: [], error: e.message ?? "failed" });
  }
}

// Re-implement the minimal fetch here so we avoid coupling to private helpers.
async function loadAllNbaPlayers(): Promise<any[]> {
  const NBA_CDN = "https://cdn.nba.com/static/json/staticData/playerIndex.json";
  try {
    const { cloudGet, cloudSet } = await import("@/lib/supabase/client");
    const cached = await cloudGet<{ players: any[]; date: string }>("nba_player_index_slim", null as any);
    if (cached?.players?.length > 0 && cached.date) {
      const age = (Date.now() - new Date(cached.date).getTime()) / 3600000;
      if (age < 24) return cached.players;
    }

    const res = await fetch(NBA_CDN, { next: { revalidate: 3600 } });
    if (!res.ok) return cached?.players ?? [];
    const data = await res.json();
    const headers = data.resultSets?.[0]?.headers ?? [];
    const rows = data.resultSets?.[0]?.rowSet ?? [];
    const idIdx = headers.indexOf("PERSON_ID");
    const lastIdx = headers.indexOf("PLAYER_LAST_NAME");
    const firstIdx = headers.indexOf("PLAYER_FIRST_NAME");
    const teamAbbrIdx = headers.indexOf("TEAM_ABBREVIATION");
    const rosterIdx = headers.indexOf("ROSTER_STATUS");

    const players = rows
      .filter((r: any[]) => rosterIdx < 0 || r[rosterIdx] === 1)
      .map((r: any[]) => ({
        id: r[idIdx],
        firstName: r[firstIdx],
        lastName: r[lastIdx],
        teamAbbrev: r[teamAbbrIdx],
      }));

    await cloudSet("nba_player_index_slim", { players, date: new Date().toISOString() });
    return players;
  } catch {
    return [];
  }
}
