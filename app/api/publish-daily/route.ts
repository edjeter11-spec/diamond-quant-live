import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server-auth";
import { cloudGet } from "@/lib/supabase/client";
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
  const parlayBatchKey = `${sport}_parlay_${slate}`;

  // Each batch is guarded independently — if the props board went out but the
  // parlay failed, a re-run should publish the parlay without duplicating the
  // props.
  const alreadyDone = async (key: string) => {
    const { data } = await supabaseAdmin!
      .from("manual_picks")
      .select("id")
      .eq("batch_key", key)
      .limit(1);
    return (data?.length ?? 0) > 0;
  };
  const propsDone = await alreadyDone(batchKey);
  const parlayDone = await alreadyDone(parlayBatchKey);

  if (propsDone && parlayDone) {
    return NextResponse.json({
      ok: true,
      alreadyPublished: true,
      batchKey,
      parlayBatchKey,
    });
  }

  // Pull the same pinned board users see — not a fresh ranking, or Discord
  // and the site could disagree about what "today's picks" are.
  const baseUrl =
    process.env.NODE_ENV === "development"
      ? req.nextUrl.origin
      : "https://diamond-quant-live.vercel.app";

  const out: any = { ok: true, props: null, parlay: null };

  // ── 1. Player props board ──
  if (!propsDone) {
    let picks: any[] = [];
    try {
      const r = await fetch(`${baseUrl}/api/pinned-props?sport=${sport}`, {
        signal: AbortSignal.timeout(20000),
      });
      const d = await r.json();
      picks = d?.picks ?? [];
    } catch (e) {
      out.props = { ok: false, error: `Could not load pinned board: ${e}` };
    }

    if (picks.length > 0) {
      const lines = picks.map((p, i) => {
        const label = MARKET_LABEL[p.market] ?? p.label ?? p.market;
        const side = p.side === "over" ? "Over" : "Under";
        return `**${i + 1}.** ${p.playerName} **${side} ${p.line} ${label}** — ${fmtOdds(p.odds)} · ${p.bookmaker}`;
      });
      const probs = picks
        .map((p) => `**${Math.round(p.fairProb)}%**`)
        .join(", ");

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

      if (!discordRes.ok) {
        out.props = { ok: false, error: discordRes.error };
      } else {
        // One row per leg — a single row for the whole board couldn't record
        // per-pick outcomes.
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
        out.props = insErr
          ? {
              ok: true,
              posted: true,
              logged: false,
              // Surfaced, not swallowed: the board is live but ungradeable.
              warning: `Posted but failed to log: ${insErr.message}`,
            }
          : { ok: true, posted: true, logged: rows.length };
      }
    } else if (!out.props) {
      out.props = { ok: false, error: "No pinned picks to publish" };
    }
  } else {
    out.props = { ok: true, alreadyPublished: true };
  }

  // ── 2. Parlay of the Day ──
  if (!parlayDone) {
    let legs: any[] = [];
    let totalOdds = 0;
    let playbookText = "";
    let playbookLink = "";
    try {
      const r = await fetch(`${baseUrl}/api/parlay-today?sport=${sport}`, {
        signal: AbortSignal.timeout(20000),
      });
      const d = await r.json();
      legs = d?.legs ?? [];
      totalOdds = d?.totalOdds ?? 0;
      playbookText = d?.playbookText ?? "";
      // Today's slip link, if an admin pasted one. Keyed per sport per ET day,
      // so a link from an earlier slate can never ride along with today's
      // parlay — that would send readers to bets that already settled.
      const saved = await cloudGet<{ url?: string } | null>(
        `playbook_link_${sport}_${slate}`,
        null,
      );
      playbookLink = saved?.url ?? "";
    } catch (e) {
      out.parlay = { ok: false, error: `Could not load parlay: ${e}` };
    }

    if (legs.length >= 2) {
      const lines = legs.map(
        (l, i) => `**${i + 1}.** ${l.pick} — ${fmtOdds(l.odds)}`,
      );
      const probs = legs
        .map((l) => `**${Math.round(l.fairProb)}%**`)
        .join(", ");

      const discordRes = await postPickToDiscord({
        id: parlayBatchKey,
        sport,
        game: "⚾ PARLAY OF THE DAY",
        market: `${legs.length}-Leg · ${fmtOdds(totalOdds)}`,
        pick_text: lines.join("\n"),
        units: 1,
        confidence: "Lean",
        writeup:
          `${legs.length} legs, ${fmtOdds(totalOdds)}. We have these at ${probs} to land.\n\n` +
          `Tap a book below to fire it — odds are best-available right now and will move.\n\n` +
          // If an admin has pasted today's Playbook slip link (see
          // /api/admin/playbook-link), lead with it — that's one tap straight
          // into a pre-loaded betslip.
          //
          // Otherwise fall back to the copy-paste line. It has to be text
          // rather than tagging @Playbook: their Discord bot rejects MLB
          // player props ("please provide a valid betslip input") while their
          // website parses the identical string fine — the two don't share a
          // parser.
          (playbookLink
            ? `**🎟️ One-tap betslip:** ${playbookLink}\n_Opens Playbook with all ${legs.length} legs loaded — pick your book from there._`
            : `**Build it in one tap:** copy the line below into <https://playbookbot.com>\n` +
              `\`\`\`\n${playbookText || legs.map((l: any) => l.pick).join(", ")}\n\`\`\``),
        status: "published",
      } as any);

      if (!discordRes.ok) {
        out.parlay = { ok: false, error: discordRes.error };
      } else {
        // Parlay legs are graded individually too. `id` encodes the market
        // key (e.g. "prop-batter_rbis-Salvador Perez"), which is what the
        // grader needs — pick text alone isn't reliably parseable.
        const rows = legs.map((l) => {
          const m = /^prop-([a-z_]+)-(.+)$/.exec(l.id ?? "");
          const marketKey = m?.[1] ?? null;
          const player = m?.[2] ?? l.game ?? null;
          // "Salvador Perez Under 0.5 RBIs" → side + line
          const sideMatch = /\b(Over|Under)\s+([\d.]+)/i.exec(l.pick ?? "");
          return {
            created_by: null,
            source: "system",
            sport,
            game: l.game ?? null,
            market: l.market ?? "player_prop",
            market_key: marketKey,
            player_name: marketKey ? player : null,
            line: sideMatch ? Number(sideMatch[2]) : null,
            side: sideMatch ? sideMatch[1].toLowerCase() : null,
            odds: l.odds,
            bookmaker: l.bookmaker,
            pick_text: l.pick,
            units: 1,
            confidence: l.confidence ?? "Lean",
            status: "published",
            slate_date: slate,
            batch_key: parlayBatchKey,
            published_at: new Date().toISOString(),
            discord_channel_id: discordRes.channel_id,
            discord_message_id: discordRes.message_id,
          };
        });
        const { error: insErr } = await supabaseAdmin
          .from("manual_picks")
          .insert(rows);
        out.parlay = insErr
          ? {
              ok: true,
              posted: true,
              logged: false,
              warning: `Posted but failed to log: ${insErr.message}`,
            }
          : { ok: true, posted: true, logged: rows.length };
      }
    } else if (!out.parlay) {
      out.parlay = { ok: false, error: "Not enough parlay legs to publish" };
    }
  } else {
    out.parlay = { ok: true, alreadyPublished: true };
  }

  return NextResponse.json({ ...out, slate, batchKey, parlayBatchKey });
}
