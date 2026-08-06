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
  // "Done" must NOT be inferred from manual_picks rows existing.
  //
  // Rows are only written AFTER the Discord post succeeds (see below), so a
  // failed insert left the board live in Discord with zero rows — and then
  // every subsequent cron tick read zero rows, concluded "not published yet",
  // and posted the board to Discord AGAIN. A transient DB blip became a
  // duplicate post every 15 minutes, forever. The read is also separated from
  // the insert by two 20s fetches and a Discord round-trip, so two concurrent
  // ticks could both pass it and both post.
  //
  // Same fix as post-results: an atomic claim on app_state, whose `key` is the
  // PRIMARY KEY, so exactly one caller wins the INSERT and the loser bails.
  // The claim is taken BEFORE any posting and only released if we post
  // nothing, so it survives a failed insert and the board never double-posts.
  const claimKey = (key: string) => `publish_claim_${key}`;
  const claim = async (key: string): Promise<boolean> => {
    const { error } = await supabaseAdmin!.from("app_state").insert({
      key: claimKey(key),
      value: { claimedAt: new Date().toISOString(), pending: true },
    });
    return !error; // duplicate-key error = someone else owns this batch
  };
  const releaseClaim = async (key: string) => {
    await supabaseAdmin!.from("app_state").delete().eq("key", claimKey(key));
  };
  const alreadyDone = async (key: string) => {
    // Belt and suspenders: an existing claim OR existing rows both mean done.
    const [{ data: claimRow }, { data: rows }] = await Promise.all([
      supabaseAdmin!
        .from("app_state")
        .select("value")
        .eq("key", claimKey(key))
        .maybeSingle(),
      supabaseAdmin!
        .from("manual_picks")
        .select("id")
        .eq("batch_key", key)
        .limit(1),
    ]);
    if (rows?.length) return true;
    const v: any = claimRow?.value;
    if (!v) return false;
    // A claim stuck `pending` from a run that died mid-publish shouldn't block
    // forever — reclaim after 15 min, same rule post-results uses.
    const stale =
      v.pending === true &&
      Date.now() - Date.parse(v.claimedAt ?? 0) > 15 * 60_000;
    if (stale) {
      await releaseClaim(key);
      return false;
    }
    return true;
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
  if (!propsDone && (await claim(batchKey))) {
    let picks: any[] = [];
    try {
      const r = await fetch(`${baseUrl}/api/pinned-props?sport=${sport}`, {
        signal: AbortSignal.timeout(20000),
      });
      const d = await r.json();
      picks = d?.picks ?? [];
    } catch (e) {
      await releaseClaim(batchKey);
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
        // Nothing was posted — give the claim back so the next tick retries.
        await releaseClaim(batchKey);
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
        // Retry once — the board is already live in Discord, so failing to
        // log here leaves it permanently ungradeable. The claim is NOT
        // released on failure: releasing it would make the next tick re-post
        // the same board to Discord, which is worse than an ungraded board.
        let insErr = (await supabaseAdmin.from("manual_picks").insert(rows))
          .error;
        if (insErr) {
          await new Promise((r) => setTimeout(r, 750));
          insErr = (await supabaseAdmin.from("manual_picks").insert(rows))
            .error;
        }
        out.props = insErr
          ? {
              ok: true,
              posted: true,
              logged: false,
              // Surfaced, not swallowed: the board is live but ungradeable.
              // scripts/audit-stuck-picks.mts will not catch this (there are
              // no rows to be stuck), so this warning is the only signal.
              warning: `Posted but failed to log after retry: ${insErr.message}`,
            }
          : { ok: true, posted: true, logged: rows.length };
      }
    } else if (!out.props) {
      // Nothing to publish — release so a later tick with a real board can.
      await releaseClaim(batchKey);
      out.props = { ok: false, error: "No pinned picks to publish" };
    }
  } else {
    out.props = { ok: true, alreadyPublished: true };
  }

  // ── 2. Parlay of the Day ──
  if (!parlayDone && (await claim(parlayBatchKey))) {
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
      await releaseClaim(parlayBatchKey);
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
          // When a link exists it goes in its own embed field (betslip_url,
          // below) rather than here, so it reads as a button and not a
          // footnote. The copy-paste fallback stays in the write-up.
          (playbookLink
            ? ""
            : `**Build it in one tap:** copy the line below into <https://playbookbot.com>\n` +
              `\`\`\`\n${playbookText || legs.map((l: any) => l.pick).join(", ")}\n\`\`\``),
        betslip_url: playbookLink || undefined,
        status: "published",
      } as any);

      if (!discordRes.ok) {
        // Nothing was posted — give the claim back so the next tick retries.
        await releaseClaim(parlayBatchKey);
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
          // A leg whose id/pick doesn't parse would be written with null
          // market_key/line/side. post-results can't grade that: it isn't a
          // moneyline (so it skips the team branch), gradeProp gets
          // market:null/line:NaN and returns null, and the void fallback
          // requires player_name — also null. The leg becomes permanently
          // ungraded and holds the entire parlay recap forever. Log it loudly
          // so it's visible rather than silently stalling the batch.
          if (!marketKey && !/\bML\b/i.test(l.pick ?? ""))
            console.error(
              `publish-daily: unparseable parlay leg, will be ungradeable — id=${l.id} pick=${l.pick}`,
            );
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
        // Retry once — the parlay is already live in Discord, so failing to
        // log leaves it permanently ungradeable. Claim deliberately NOT
        // released: releasing would re-post the same parlay next tick.
        let insErr = (await supabaseAdmin.from("manual_picks").insert(rows))
          .error;
        if (insErr) {
          await new Promise((r) => setTimeout(r, 750));
          insErr = (await supabaseAdmin.from("manual_picks").insert(rows))
            .error;
        }
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
      // Nothing to publish — release so a later tick with real legs can.
      await releaseClaim(parlayBatchKey);
      out.parlay = { ok: false, error: "Not enough parlay legs to publish" };
    }
  } else {
    out.parlay = { ok: true, alreadyPublished: true };
  }

  return NextResponse.json({ ...out, slate, batchKey, parlayBatchKey });
}
