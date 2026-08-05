import { NextResponse } from "next/server";
import { etDateString } from "@/lib/sports-date";
import { cloudGet, cloudSet } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ──────────────────────────────────────────────────────────
// LINEUP WATCH — the timing edge
//
// Confirmed lineups drop 2-4 hours before first pitch. A star sitting moves
// the moneyline 10-20 cents, and soft books lag that news by minutes — which
// is one of the few windows where a retail bettor can genuinely act before
// the price does. This endpoint detects "star sitting" the cheap, robust way:
//
//   star  = batted in the top 5 of the order in BOTH of the team's last two
//           completed games (order slot is the manager's own ranking — no
//           roster-stats calls, no season-PA table needed)
//   alert = that player is absent from today's CONFIRMED lineup
//
// Only confirmed lineups fire alerts. A missing lineup means "not posted
// yet", which is silence, not news. Cross-checking two prior games instead of
// one filters routine platoon rotation — a platoon bat sits every other day
// and would spam alerts under a one-game lookback.
//
// Data: MLB StatsAPI, free. ~1 schedule call per day-side + ~15 boxscores,
// with yesterday's starters cached in app_state so repeat cron ticks cost
// two schedule calls and nothing else.
// ──────────────────────────────────────────────────────────

const API = "https://statsapi.mlb.com/api/v1";

const j = async (u: string, ms = 15000) => {
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(ms) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
};

type Starter = { id: number; name: string; slot: number };

/** Top-5 batting-order starters per team for one date's completed games. */
async function startersForDate(
  dateISO: string,
): Promise<Record<number, Starter[]>> {
  const sched = await j(`${API}/schedule?sportId=1&date=${dateISO}`);
  const byTeam: Record<number, Starter[]> = {};
  const games = (sched?.dates?.[0]?.games ?? []).filter(
    (g: any) => g.status?.abstractGameState === "Final",
  );
  for (const g of games) {
    const box = await j(`${API}/game/${g.gamePk}/boxscore`);
    if (!box) continue;
    for (const side of ["home", "away"] as const) {
      const teamId = box.teams?.[side]?.team?.id;
      if (!teamId) continue;
      const players = box.teams[side].players ?? {};
      const starters: Starter[] = [];
      for (const key of Object.keys(players)) {
        const p = players[key];
        // battingOrder "100".."900" = lineup slots 1-9; bench/subs get
        // fractional codes like "401" which round out of the whole-hundreds.
        const bo = Number(p.battingOrder);
        if (!Number.isFinite(bo) || bo % 100 !== 0) continue;
        const slot = bo / 100;
        if (slot >= 1 && slot <= 5)
          starters.push({
            id: p.person?.id,
            name: p.person?.fullName,
            slot,
          });
      }
      // A doubleheader can produce two lineups for one team-date; keep the
      // first — either is a fine "who are this team's regulars" sample.
      if (!byTeam[teamId]) byTeam[teamId] = starters;
    }
  }
  return byTeam;
}

/** Same-shaped starters map, cached per date — historical lineups never
 *  change, so one build per date is enough forever. */
async function cachedStarters(
  dateISO: string,
): Promise<Record<number, Starter[]>> {
  const key = `lineup_starters_${dateISO}`;
  const hit = await cloudGet<Record<number, Starter[]> | null>(key, null);
  if (hit && Object.keys(hit).length > 0) return hit;
  const built = await startersForDate(dateISO);
  if (Object.keys(built).length > 0) await cloudSet(key, built);
  return built;
}

function daysAgoET(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return etDateString(d);
}

export async function GET() {
  const today = etDateString();

  // Today's confirmed lineups.
  const sched = await j(
    `${API}/schedule?sportId=1&date=${today}&hydrate=lineups`,
  );
  const games = sched?.dates?.[0]?.games ?? [];
  if (games.length === 0)
    return NextResponse.json({ ok: true, alerts: [], note: "No games today" });

  const [prev1, prev2] = await Promise.all([
    cachedStarters(daysAgoET(1)),
    cachedStarters(daysAgoET(2)),
  ]);

  const alerts: any[] = [];
  let confirmedLineups = 0;

  for (const g of games) {
    if (g.status?.abstractGameState !== "Preview") continue; // already started
    for (const side of ["home", "away"] as const) {
      const teamId = g.teams?.[side]?.team?.id;
      const teamName = g.teams?.[side]?.team?.name;
      const lineup: any[] = g.lineups?.[`${side}Players`] ?? [];
      if (!teamId || lineup.length < 9) continue; // not confirmed yet
      confirmedLineups++;

      const todayIds = new Set(lineup.map((p: any) => p.id));
      const recent1 = prev1[teamId] ?? [];
      const recent2 = new Set((prev2[teamId] ?? []).map((s) => s.id));

      for (const s of recent1) {
        // Star = top-5 in the order in BOTH of the last two games.
        if (!recent2.has(s.id)) continue;
        if (todayIds.has(s.id)) continue;
        alerts.push({
          gamePk: g.gamePk,
          commence: g.gameDate,
          team: teamName,
          game: `${g.teams.away.team.name} @ ${g.teams.home.team.name}`,
          player: s.name,
          playerId: s.id,
          usualSlot: s.slot,
          note: `${s.name} (batted ${s.slot}${["st", "nd", "rd"][s.slot - 1] ?? "th"} last 2 games) NOT in ${teamName}'s confirmed lineup`,
        });
      }
    }
  }

  return NextResponse.json({
    ok: true,
    date: today,
    confirmedLineups,
    alerts,
    note:
      confirmedLineups === 0
        ? "No lineups confirmed yet — they post 2-4h before first pitch."
        : alerts.length === 0
          ? "All recent top-5 regulars present in confirmed lineups."
          : "Star(s) sitting — check the line before the book moves it.",
  });
}
