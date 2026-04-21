import { NextResponse } from "next/server";

// Slim MLB player index — (id, firstName, lastName, teamAbbrev) for every
// active-roster player. Used client-side to resolve headshots on the MLB
// side of the app. The Odds API doesn't provide player IDs, so we look
// them up here.

export const dynamic = "force-dynamic";
export const revalidate = 3600;

const MLB_API = "https://statsapi.mlb.com/api/v1";

export async function GET() {
  try {
    const { cloudGet, cloudSet } = await import("@/lib/supabase/client");
    const cached = await cloudGet<{ players: any[]; date: string }>(
      "mlb_player_index_slim",
      null as any,
    );
    if (cached?.players?.length > 0 && cached.date) {
      const age = (Date.now() - new Date(cached.date).getTime()) / 3600000;
      if (age < 24) return NextResponse.json({ players: cached.players, count: cached.players.length });
    }

    // Pull every team's 40-man roster in parallel
    const teamsRes = await fetch(`${MLB_API}/teams?sportId=1`, { next: { revalidate: 86400 } });
    if (!teamsRes.ok) throw new Error(`teams api ${teamsRes.status}`);
    const teamsData = await teamsRes.json();
    const teams: Array<{ id: number; abbreviation: string }> = teamsData.teams ?? [];

    const rosters = await Promise.all(
      teams.map(async (t) => {
        try {
          const rRes = await fetch(
            `${MLB_API}/teams/${t.id}/roster?rosterType=active`,
            { next: { revalidate: 3600 } },
          );
          if (!rRes.ok) return [];
          const rData = await rRes.json();
          const rows: any[] = rData.roster ?? [];
          return rows.map((r) => {
            const person = r.person ?? {};
            const full: string = person.fullName ?? "";
            const parts = full.split(/\s+/);
            const firstName = parts[0] ?? "";
            const lastName = parts.slice(1).join(" ") || parts[0] || "";
            return {
              id: person.id,
              firstName,
              lastName,
              teamAbbrev: t.abbreviation,
            };
          });
        } catch {
          return [];
        }
      }),
    );

    const players = rosters.flat().filter((p) => p.id && p.lastName);
    if (players.length > 0) {
      await cloudSet("mlb_player_index_slim", { players, date: new Date().toISOString() });
    }
    return NextResponse.json({ players, count: players.length });
  } catch (e: any) {
    return NextResponse.json({ players: [], error: e?.message ?? "failed" });
  }
}
