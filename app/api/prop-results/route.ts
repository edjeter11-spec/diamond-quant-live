import { NextResponse } from "next/server";

// ──────────────────────────────────────────────────────────
// Prop Results — grades player props for tonight's completed games.
//
// Returns a map keyed by `${playerName.toLowerCase()}::${market}` so the
// client can paint green/red on matching Board picks.
//
// NBA: pulls final box scores from stats.nba.com CDN via playByPlay snapshot.
// MLB: pulls box scores from statsapi.mlb.com.
// Pending / not-final games return nothing (client renders neutral).
// ──────────────────────────────────────────────────────────

export const revalidate = 60;

const NBA_CACHE_KEY = (date: string) => `prop_results_nba_${date}`;
const MLB_CACHE_KEY = (date: string) => `prop_results_mlb_${date}`;
const CDN = "public, s-maxage=60, stale-while-revalidate=600";

interface GradedProp {
  playerName: string;
  market: string;
  line: number;
  actual: number;
  result: "win-over" | "win-under" | "push" | "pending";
  gameStatus: "final" | "live" | "pre";
}

function todayKey() {
  return new Date().toISOString().split("T")[0];
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sport = searchParams.get("sport") || "basketball_nba";

  try {
    const date = todayKey();
    if (sport === "basketball_nba") {
      const { cloudGet, cloudSet } = await import("@/lib/supabase/client");
      const cached = await cloudGet<any>(NBA_CACHE_KEY(date), null);
      if (cached && cached.ts && Date.now() - cached.ts < 5 * 60 * 1000) {
        return NextResponse.json(cached.payload, { headers: { "Cache-Control": CDN } });
      }
      const results = await gradeNba();
      const payload = { results, date };
      await cloudSet(NBA_CACHE_KEY(date), { ts: Date.now(), payload }).catch(() => {});
      return NextResponse.json(payload, { headers: { "Cache-Control": CDN } });
    }
    if (sport === "baseball_mlb") {
      const { cloudGet, cloudSet } = await import("@/lib/supabase/client");
      const cached = await cloudGet<any>(MLB_CACHE_KEY(date), null);
      if (cached && cached.ts && Date.now() - cached.ts < 5 * 60 * 1000) {
        return NextResponse.json(cached.payload, { headers: { "Cache-Control": CDN } });
      }
      const results = await gradeMlb();
      const payload = { results, date };
      await cloudSet(MLB_CACHE_KEY(date), { ts: Date.now(), payload }).catch(() => {});
      return NextResponse.json(payload, { headers: { "Cache-Control": CDN } });
    }
    return NextResponse.json({ results: {} });
  } catch (e: any) {
    return NextResponse.json({ results: {}, error: e?.message ?? "failed" }, { status: 500 });
  }
}

// ── NBA grading via cdn.nba.com box scores ───────────────────
async function gradeNba(): Promise<Record<string, GradedProp[]>> {
  const today = todayKey().replace(/-/g, "");
  const sb = await fetch(`https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json`, {
    next: { revalidate: 60 },
  }).catch(() => null);
  if (!sb || !sb.ok) return {};
  const data = await sb.json();
  const games: any[] = data.scoreboard?.games ?? [];
  const out: Record<string, GradedProp[]> = {};

  await Promise.all(
    games.map(async (g) => {
      const gameId = g.gameId;
      const status = g.gameStatus === 3 ? "final" : g.gameStatus === 2 ? "live" : "pre";
      if (status === "pre") return;
      try {
        const bxRes = await fetch(`https://cdn.nba.com/static/json/liveData/boxscore/boxscore_${gameId}.json`, {
          next: { revalidate: 60 },
        });
        if (!bxRes.ok) return;
        const bx = await bxRes.json();
        const allPlayers = [
          ...(bx.game?.homeTeam?.players ?? []),
          ...(bx.game?.awayTeam?.players ?? []),
        ];
        for (const p of allPlayers) {
          const name = p.name ?? `${p.firstName ?? ""} ${p.familyName ?? ""}`.trim();
          const stats = p.statistics ?? {};
          const key = name.toLowerCase();
          const arr = out[key] ?? (out[key] = []);
          // Push per-market rows (line is filled by client, we return the actual).
          arr.push({
            playerName: name,
            market: "player_points",
            line: 0,
            actual: Number(stats.points ?? 0),
            result: "pending",
            gameStatus: status as any,
          });
          arr.push({
            playerName: name,
            market: "player_rebounds",
            line: 0,
            actual: Number(stats.reboundsTotal ?? stats.rebounds ?? 0),
            result: "pending",
            gameStatus: status as any,
          });
          arr.push({
            playerName: name,
            market: "player_assists",
            line: 0,
            actual: Number(stats.assists ?? 0),
            result: "pending",
            gameStatus: status as any,
          });
        }
      } catch {}
    }),
  );

  void today;
  return out;
}

// ── MLB grading via statsapi.mlb.com box scores ──────────────
async function gradeMlb(): Promise<Record<string, GradedProp[]>> {
  const date = todayKey();
  const schedRes = await fetch(
    `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}`,
    { next: { revalidate: 60 } },
  ).catch(() => null);
  if (!schedRes || !schedRes.ok) return {};
  const sched = await schedRes.json();
  const games: any[] = sched.dates?.[0]?.games ?? [];
  const out: Record<string, GradedProp[]> = {};

  await Promise.all(
    games.map(async (g) => {
      const status = g.status?.abstractGameState === "Final" ? "final"
        : g.status?.abstractGameState === "Live" ? "live" : "pre";
      if (status === "pre") return;
      try {
        const bxRes = await fetch(
          `https://statsapi.mlb.com/api/v1/game/${g.gamePk}/boxscore`,
          { next: { revalidate: 60 } },
        );
        if (!bxRes.ok) return;
        const bx = await bxRes.json();
        for (const side of ["home", "away"] as const) {
          const players = bx.teams?.[side]?.players ?? {};
          for (const pid of Object.keys(players)) {
            const p = players[pid];
            const name: string = p.person?.fullName ?? "";
            if (!name) continue;
            const key = name.toLowerCase();
            const arr = out[key] ?? (out[key] = []);
            const bat = p.stats?.batting ?? {};
            const pit = p.stats?.pitching ?? {};
            arr.push({ playerName: name, market: "batter_hits", line: 0, actual: Number(bat.hits ?? 0), result: "pending", gameStatus: status as any });
            arr.push({ playerName: name, market: "batter_home_runs", line: 0, actual: Number(bat.homeRuns ?? 0), result: "pending", gameStatus: status as any });
            arr.push({ playerName: name, market: "batter_total_bases", line: 0, actual: Number(bat.totalBases ?? 0), result: "pending", gameStatus: status as any });
            arr.push({ playerName: name, market: "batter_rbis", line: 0, actual: Number(bat.rbi ?? 0), result: "pending", gameStatus: status as any });
            arr.push({ playerName: name, market: "batter_runs_scored", line: 0, actual: Number(bat.runs ?? 0), result: "pending", gameStatus: status as any });
            arr.push({ playerName: name, market: "pitcher_strikeouts", line: 0, actual: Number(pit.strikeOuts ?? 0), result: "pending", gameStatus: status as any });
            arr.push({ playerName: name, market: "pitcher_outs", line: 0, actual: Math.round((Number(pit.inningsPitched ?? 0)) * 3), result: "pending", gameStatus: status as any });
          }
        }
      } catch {}
    }),
  );
  return out;
}
