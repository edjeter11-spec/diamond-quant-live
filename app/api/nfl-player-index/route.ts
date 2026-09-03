import { NextResponse } from "next/server";

// Slim NFL player index — (id, firstName, lastName, teamAbbrev, position)
// for every rostered player, from ESPN's team roster feeds. The client
// resolves a prop's player name to an ESPN id and builds the headshot URL
// (a.espncdn.com/i/headshots/nfl/players/full/<id>.png), the same way the
// MLB/NBA indexes feed PlayerAvatar. Cached in app_state for 24h so the 33
// ESPN calls happen once a day, not once per visitor.

export const dynamic = "force-dynamic";
export const revalidate = 3600;

const ESPN = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";

export async function GET() {
  try {
    const { cloudGet, cloudSet } = await import("@/lib/supabase/client");
    const cached = await cloudGet<{ players: any[]; date: string }>(
      "nfl_player_index_slim",
      null as any,
    );
    if (cached?.players?.length > 0 && cached.date) {
      const age = (Date.now() - new Date(cached.date).getTime()) / 3600000;
      if (age < 24)
        return NextResponse.json({
          players: cached.players,
          count: cached.players.length,
        });
    }

    const teamsRes = await fetch(`${ESPN}/teams`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!teamsRes.ok) throw new Error(`teams api ${teamsRes.status}`);
    const teamsData = await teamsRes.json();
    const teams: Array<{ id: string; abbreviation: string }> = (
      teamsData?.sports?.[0]?.leagues?.[0]?.teams ?? []
    ).map((t: any) => ({ id: t.team.id, abbreviation: t.team.abbreviation }));

    const rosters = await Promise.all(
      teams.map(async (t) => {
        try {
          const r = await fetch(`${ESPN}/teams/${t.id}/roster`, {
            signal: AbortSignal.timeout(15000),
          });
          if (!r.ok) return [];
          const d = await r.json();
          // ESPN groups the roster (offense / defense / special teams /
          // injured reserve...); every group's items are real players.
          const groups: any[] = d?.athletes ?? [];
          const out: any[] = [];
          for (const g of groups) {
            for (const a of g?.items ?? []) {
              const full: string = a.fullName ?? a.displayName ?? "";
              if (!a.id || !full) continue;
              const parts = full.split(/\s+/);
              out.push({
                id: Number(a.id),
                firstName: parts[0] ?? "",
                lastName: parts.slice(1).join(" ") || parts[0] || "",
                teamAbbrev: t.abbreviation,
                position: a.position?.abbreviation ?? null,
              });
            }
          }
          return out;
        } catch {
          return [];
        }
      }),
    );
    const players = rosters.flat();
    if (players.length === 0) throw new Error("empty roster pull");

    await cloudSet("nfl_player_index_slim", {
      players,
      date: new Date().toISOString(),
    });
    return NextResponse.json({ players, count: players.length });
  } catch (e) {
    return NextResponse.json(
      { players: [], count: 0, error: String(e) },
      { status: 200 },
    );
  }
}
