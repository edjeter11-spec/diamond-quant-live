import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server-auth";
import { etDateString } from "@/lib/sports-date";
import { fetchGamePlayerLines, type PlayerLine } from "@/lib/mlb/prop-grader";

export const dynamic = "force-dynamic";

// ──────────────────────────────────────────────────────────
// LIVE LEG STATUS
//
// Marks a published leg as HIT the moment the box score shows it cleared,
// rather than making everyone wait until the slate settles. MLB's boxscore
// endpoint updates during play, so "Ruiz already has his hit" is knowable in
// real time.
//
// Deliberately one-directional: a leg goes pending -> hit, never
// pending -> miss. Mid-game, "0 hits" means "no hits YET" — the player has
// more plate appearances coming, and showing a red X on a live over would be
// simply wrong. Misses are settled by /api/post-results once games are final,
// which is also what writes to the database. This endpoint is read-only and
// never persists anything.
// ──────────────────────────────────────────────────────────

const MARKET_STAT: Record<string, string> = {
  batter_hits: "hits",
  batter_total_bases: "totalBases",
  batter_rbis: "rbi",
  batter_runs_scored: "runs",
  batter_home_runs: "homeRuns",
  batter_stolen_bases: "stolenBases",
};
const PITCHING_STAT: Record<string, string> = {
  pitcher_strikeouts: "strikeOuts",
  pitcher_outs: "outs",
};

/** Loose match — box scores print "Keibert Ruiz", picks may carry suffixes. */
function findLine(lines: PlayerLine[], name: string): PlayerLine | null {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z ]/g, "")
      .trim();
  const target = norm(name);
  return (
    lines.find((l) => norm(l.name) === target) ??
    lines.find((l) => {
      const a = norm(l.name).split(" ");
      const b = target.split(" ");
      return a[a.length - 1] === b[b.length - 1] && a[0][0] === b[0][0];
    }) ??
    null
  );
}

export async function GET(req: NextRequest) {
  if (!supabaseAdmin)
    return NextResponse.json({ ok: false, error: "Not configured" });

  const { searchParams } = new URL(req.url);
  const slate = searchParams.get("slate") ?? etDateString();

  const { data: picks } = await supabaseAdmin
    .from("manual_picks")
    .select("id, player_name, market_key, line, side, result, batch_key")
    .eq("slate_date", slate)
    .eq("status", "published");

  if (!picks?.length)
    return NextResponse.json({ ok: true, slate, legs: [], allFinal: true });

  // Every game on the slate, so we can report whether the day is done.
  let games: any[] = [];
  try {
    const r = await fetch(
      `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${slate}`,
      { signal: AbortSignal.timeout(8000) },
    );
    games = (await r.json())?.dates?.[0]?.games ?? [];
  } catch {
    return NextResponse.json({ ok: false, error: "schedule unavailable" });
  }

  const active = games.filter((g) => g.status?.abstractGameState !== "Preview");
  const allFinal =
    games.length > 0 &&
    games.every((g) => g.status?.abstractGameState === "Final");

  // Box scores for games that have started. Failures are skipped, not fatal —
  // a missing box score just leaves those legs pending.
  const lines: PlayerLine[] = [];
  await Promise.all(
    active.map(async (g) => {
      try {
        lines.push(...(await fetchGamePlayerLines(g.gamePk)));
      } catch {}
    }),
  );

  const legs = picks.map((p: any) => {
    // Already settled in the DB — trust that over anything live.
    if (p.result && p.result !== "pending")
      return { id: p.id, status: p.result, live: false };

    const statKey =
      MARKET_STAT[p.market_key] ?? PITCHING_STAT[p.market_key] ?? null;
    if (!statKey || !p.player_name)
      return { id: p.id, status: "pending", live: false };

    const line = findLine(lines, p.player_name);
    const block = MARKET_STAT[p.market_key] ? line?.batting : line?.pitching;
    const actual = block?.[statKey];
    if (line == null || actual == null)
      return { id: p.id, status: "pending", live: false };

    // Only OVERs can be confirmed early: once the number is cleared it can't
    // un-clear. An UNDER isn't safe until the player is done playing, so it
    // stays pending until final grading.
    const cleared = p.side === "over" && actual > Number(p.line);
    return {
      id: p.id,
      // The board renders from /api/parlay-today, whose leg ids don't match
      // manual_picks rows. Player + market is the stable join between them.
      player: p.player_name,
      market: p.market_key,
      status: cleared ? "hit" : "pending",
      live: true,
      actual,
      needed: Number(p.line),
    };
  });

  return NextResponse.json({
    ok: true,
    slate,
    allFinal,
    gamesTotal: games.length,
    gamesFinal: games.filter((g) => g.status?.abstractGameState === "Final")
      .length,
    legs,
  });
}
