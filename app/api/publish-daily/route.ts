import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server-auth";
import { etDateString } from "@/lib/sports-date";
import { postPickToDiscord } from "@/lib/bot/discord-bridge";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ──────────────────────────────────────────────────────────
// PUBLISH DAILY BOARD
//
// Posts the pinned board to Discord AND records each pick in manual_picks so
// the results recap has something to grade. Publishing without logging was the
// gap: picks went out, the slate finished, and nothing tied the two together.
//
// Auth: cron secret or admin — same gate as the other write routes.
// Idempotent per (slate, sport, kind): re-running won't double-post.
// ──────────────────────────────────────────────────────────

const MARKET_LABEL: Record<string, string> = {
  batter_hits: "Hits",
  batter_total_bases: "Total Bases",
  batter_rbis: "RBIs",
  batter_runs_scored: "Runs",
  batter_home_runs: "HR",
  batter_stolen_bases: "Steals",
  pitcher_strikeouts: "Ks",
  pitcher_outs: "Outs",
};

function fmtOdds(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

export async function POST(req: NextRequest) {
  const cronSecret = req.headers.get("x-cron-secret");
  if (cronSecret !== process.env.CRON_SECRET) {
    const { getUserFromRequest } = await import("@/lib/supabase/server-auth");
    const user = await getUserFromRequest(req);
    if (!user?.isAdmin)
      return NextResponse.json(
        { ok: false, error: "Admin or cron secret required" },
        { status: 403 },
      );
  }

  if (!supabaseAdmin)
    return NextResponse.json(
      { ok: false, error: "Server not configured" },
      { status: 500 },
    );

  const { searchParams } = new URL(req.url);
  const sport = (searchParams.get("sport") ?? "mlb").toLowerCase();
  const slate = etDateString();
  const batchKey = `${sport}_props_${slate}`;

  // Already published today? Don't post a second board.
  const { data: existing } = await supabaseAdmin
    .from("manual_picks")
    .select("id")
    .eq("batch_key", batchKey)
    .limit(1);
  if (existing && existing.length > 0) {
    return NextResponse.json({
      ok: true,
      alreadyPublished: true,
      batchKey,
    });
  }

  // Pull the same pinned board users see — not a fresh ranking, or Discord
  // and the site could disagree about what "today's picks" are.
  const baseUrl =
    process.env.NODE_ENV === "development"
      ? req.nextUrl.origin
      : "https://diamond-quant-live.vercel.app";

  let picks: any[] = [];
  try {
    const r = await fetch(`${baseUrl}/api/pinned-props?sport=${sport}`, {
      signal: AbortSignal.timeout(20000),
    });
    const d = await r.json();
    picks = d?.picks ?? [];
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `Could not load pinned board: ${e}` },
      { status: 502 },
    );
  }

  if (picks.length === 0)
    return NextResponse.json({
      ok: false,
      error: "No pinned picks to publish",
    });

  // Human-readable lines, same shape as the manual posts.
  const lines = picks.map((p, i) => {
    const label = MARKET_LABEL[p.market] ?? p.label ?? p.market;
    const side = p.side === "over" ? "Over" : "Under";
    return `**${i + 1}.** ${p.playerName} **${side} ${p.line} ${label}** — ${fmtOdds(p.odds)} · ${p.bookmaker}`;
  });

  const probs = picks.map((p) => `**${Math.round(p.fairProb)}%**`).join(", ");

  const discordRes = await postPickToDiscord({
    id: batchKey,
    sport,
    game: "🎯 TODAY'S PLAYER PROPS",
    market: `${picks.length} Picks · Locked In`,
    pick_text: lines.join("\n"),
    units: 1,
    confidence: "Lock",
    writeup: `Today's board is locked. We have these at ${probs}.\n\nSame picks for everyone — no cherry-picking after the fact. Grade goes up tomorrow, win or lose.`,
    status: "published",
  } as any);

  if (!discordRes.ok)
    return NextResponse.json(
      { ok: false, error: `Discord post failed: ${discordRes.error}` },
      { status: 502 },
    );

  // Log each leg individually so the grader can settle them one by one — a
  // single row for the whole board couldn't record per-pick outcomes.
  const rows = picks.map((p) => ({
    created_by: null,
    source: "system",
    sport,
    game: p.team ?? null,
    market: "player_prop",
    market_key: p.market,
    player_name: p.playerName,
    line: p.line,
    side: p.side,
    odds: p.odds,
    bookmaker: p.bookmaker,
    pick_text: `${p.playerName} ${p.side === "over" ? "Over" : "Under"} ${p.line} ${MARKET_LABEL[p.market] ?? p.market}`,
    units: 1,
    confidence: "Lock",
    status: "published",
    slate_date: slate,
    batch_key: batchKey,
    published_at: new Date().toISOString(),
    discord_channel_id: discordRes.channel_id,
    discord_message_id: discordRes.message_id,
  }));

  const { error: insErr } = await supabaseAdmin
    .from("manual_picks")
    .insert(rows);

  if (insErr)
    return NextResponse.json({
      ok: true,
      posted: true,
      logged: false,
      // Surfaced rather than swallowed: the board is live on Discord but
      // won't be graded, and that needs to be visible.
      warning: `Posted to Discord but failed to log for grading: ${insErr.message}`,
      messageId: discordRes.message_id,
    });

  return NextResponse.json({
    ok: true,
    posted: true,
    logged: rows.length,
    batchKey,
    messageId: discordRes.message_id,
  });
}
