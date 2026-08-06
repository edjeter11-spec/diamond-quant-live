import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server-auth";
import { cloudGet } from "@/lib/supabase/client";
import { etDateString } from "@/lib/sports-date";
import * as mlbGrader from "@/lib/mlb/prop-grader";
import * as nbaGrader from "@/lib/nba/prop-grader";
import * as nflGrader from "@/lib/nfl/prop-grader";
import { americanToDecimal } from "@/lib/model/kelly";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ──────────────────────────────────────────────────────────
// DAILY RESULTS RECAP
//
// Grades the picks published via /api/publish-daily against final box scores,
// writes the outcome back to manual_picks, then posts one recap to Discord.
//
// Deliberately conservative about WHEN it posts: only once every pick for the
// slate is graded. Posting a partial recap while games are live would show a
// losing record that later turns into a winning one, which is worse than
// posting nothing.
//
// Sport dispatch: each sport supplies its own box-score source and grading
// function behind a common shape ({fetchFinalGames, fetchGamePlayerLines,
// gradeProp}) — see lib/mlb/prop-grader.ts, lib/nba/prop-grader.ts,
// lib/nfl/prop-grader.ts. The recap-posting/Discord/claim-dedup logic below
// is sport-agnostic and shared by all three.
// ──────────────────────────────────────────────────────────

type PlayerLine =
  mlbGrader.PlayerLine | nbaGrader.PlayerLine | nflGrader.PlayerLine;

interface SportGrader {
  fetchFinalGames(
    dateISO: string,
  ): Promise<Array<{ home: string; away: string; [k: string]: any }>>;
  fetchGamePlayerLines(gameId: any): Promise<PlayerLine[]>;
  gradeProp(
    pick: {
      playerName: string;
      market: string;
      line: number;
      side: "over" | "under";
    },
    lines: PlayerLine[],
  ): any;
}

const GRADERS: Record<string, SportGrader> = {
  mlb: {
    fetchFinalGames: mlbGrader.fetchFinalGames,
    fetchGamePlayerLines: (g: any) => mlbGrader.fetchGamePlayerLines(g.gamePk),
    gradeProp: mlbGrader.gradeMlbProp,
  } as any,
  nba: {
    fetchFinalGames: nbaGrader.fetchFinalGames,
    fetchGamePlayerLines: (g: any) => nbaGrader.fetchGamePlayerLines(g.gameId),
    gradeProp: nbaGrader.gradeNbaProp,
  } as any,
  nfl: {
    fetchFinalGames: nflGrader.fetchFinalGames,
    fetchGamePlayerLines: (g: any) => nflGrader.fetchGamePlayerLines(g.gameId),
    gradeProp: nflGrader.gradeNflProp,
  } as any,
};

const BOT_API_URL = process.env.BOT_API_URL || "";
const BOT_API_SECRET = process.env.BOT_API_SECRET || "";

/** Yesterday in ET — the slate that's actually finished. */
function previousSlate(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return etDateString(d);
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
  const slate = searchParams.get("slate") ?? previousSlate();
  const force = searchParams.get("force") === "true";

  const grader = GRADERS[sport];
  if (!grader)
    return NextResponse.json({
      ok: false,
      error: `Grading not implemented for sport "${sport}"`,
    });

  // Pull that slate's published picks.
  const { data: picks, error } = await supabaseAdmin
    .from("manual_picks")
    .select("*")
    .eq("slate_date", slate)
    .eq("sport", sport)
    .eq("status", "published");

  if (error)
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  if (!picks || picks.length === 0)
    return NextResponse.json({
      ok: true,
      message: `No published picks for ${slate}`,
    });

  // Box scores for every final game on that slate.
  const finals = await grader.fetchFinalGames(slate);
  if (finals.length === 0)
    return NextResponse.json({
      ok: true,
      message: `No final games for ${slate} yet`,
    });

  const allLines: PlayerLine[] = [];
  for (const g of finals) {
    allLines.push(...(await grader.fetchGamePlayerLines(g)));
  }
  if (allLines.length === 0)
    return NextResponse.json({ ok: true, message: "Box scores unavailable" });

  // Props and the parlay are separate posts, so they get separate recaps —
  // a combined record would blur "4 of 5 props hit" with "the parlay lost",
  // which are different things to a reader.
  const batches = new Map<string, any[]>();
  for (const p of picks) {
    const k = p.batch_key ?? "ungrouped";
    if (!batches.has(k)) batches.set(k, []);
    batches.get(k)!.push(p);
  }

  const results: any[] = [];
  for (const [batchKey, batchPicks] of batches) {
    results.push(
      await recapBatch(
        batchKey,
        batchPicks,
        allLines,
        finals,
        slate,
        sport,
        force,
        grader,
      ),
    );
  }

  return NextResponse.json({ ok: true, slate, batches: results });
}

/** Grade one batch and post its recap. Isolated so props and parlay can
 *  complete independently — a stuck parlay leg shouldn't hold the props
 *  recap hostage. */
async function recapBatch(
  batchKey: string,
  picks: any[],
  allLines: PlayerLine[],
  finals: Array<{ home: string; away: string; [k: string]: any }>,
  slate: string,
  sport: string,
  force: boolean,
  grader: SportGrader,
): Promise<any> {
  const recapKey = `recap_posted_${batchKey}`;
  if (!force) {
    const { data: flag } = await supabaseAdmin!
      .from("app_state")
      .select("value")
      .eq("key", recapKey)
      .maybeSingle();
    if (flag?.value) return { batchKey, alreadyPosted: true };
  }

  // Claim the recap BEFORE posting, using an INSERT rather than an upsert.
  //
  // The read above is not a guard on its own: it's separated from the write at
  // the end of this function by grading work and a Discord round-trip, so two
  // concurrent cron invocations — or a retry after the 10s post timeout where
  // the post actually succeeded — both saw no flag and both posted. `key` is
  // the PRIMARY KEY of app_state, so a plain insert makes the claim atomic:
  // exactly one caller wins, the loser gets a duplicate-key error and bails.
  //
  // The row is deleted again if we end up not posting (nothing graded yet, or
  // the send failed), so a claim never permanently blocks a legitimate recap.
  if (!force) {
    const { error: claimErr } = await supabaseAdmin!.from("app_state").insert({
      key: recapKey,
      value: { claimedAt: new Date().toISOString(), pending: true },
    });
    if (claimErr) return { batchKey, alreadyPosted: true };
  }
  const releaseClaim = async () => {
    if (!force)
      await supabaseAdmin!.from("app_state").delete().eq("key", recapKey);
  };

  const graded: Array<{ text: string; result: string }> = [];
  let ungraded = 0;
  let unitsNet = 0;

  for (const p of picks) {
    if (p.result) {
      graded.push({ text: p.pick_text, result: p.result });
      unitsNet += Number(p.profit_units ?? 0);
      continue;
    }

    // ── Moneyline picks — graded separately from props ──
    //
    // A moneyline row (market='moneyline') has no player_name/market_key —
    // it's a team-vs-team bet, not a prop — so grader.gradeProp can never
    // match it against box-score PLAYER lines. Before this branch existed,
    // every moneyline pick sat as `ungraded++` forever: the void-fallback
    // below only fires for player props (checks p.player_name), so a
    // moneyline never voided either — it just held the whole batch's recap
    // claim in `pending: true` indefinitely. That's exactly what happened to
    // the 2026-08-05 mlb_parlay batch: 2 moneylines never graded, so the
    // parlay recap never posted even though the props batch (same slate)
    // went out fine.
    if (p.market === "moneyline") {
      const [pickAway, pickHome] = String(p.game).split(" @ ");
      const norm = (s: string) => (s ?? "").toLowerCase().trim();
      const final = finals.find((f) => {
        const h = norm(f.home),
          a = norm(f.away);
        return (
          (h && norm(pickHome).includes(h)) ||
          (h && h.includes(norm(pickHome))) ||
          (a && norm(pickAway).includes(a)) ||
          (a && a.includes(norm(pickAway)))
        );
      });
      // Game not in today's finals list — not over yet. Same "wait" path a
      // prop takes when its game hasn't finished.
      if (
        !final ||
        !Number.isFinite(final.homeScore) ||
        !Number.isFinite(final.awayScore)
      ) {
        ungraded++;
        continue;
      }
      const homeWon = final.homeScore > final.awayScore;
      const awayWon = final.awayScore > final.homeScore;
      const pushed = final.homeScore === final.awayScore;
      const pickedTeam = String(p.pick_text ?? "").replace(/\s*ML$/i, "");
      const pickedHome =
        pickedTeam && norm(pickHome).includes(norm(pickedTeam));
      const pickedAway =
        pickedTeam && norm(pickAway).includes(norm(pickedTeam));
      const won = (pickedHome && homeWon) || (pickedAway && awayWon);

      const stake = Number(p.units ?? 1);
      const result = pushed ? "push" : won ? "win" : "loss";
      const profit = pushed
        ? 0
        : won
          ? stake * (americanToDecimal(Number(p.odds ?? -110)) - 1)
          : -stake;

      await supabaseAdmin!
        .from("manual_picks")
        .update({
          result,
          actual_value: pickedHome ? final.homeScore : final.awayScore,
          profit_units: Math.round(profit * 100) / 100,
          settled_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", p.id)
        .is("result", null);

      unitsNet += profit;
      graded.push({ text: p.pick_text, result });
      continue;
    }

    const g = grader.gradeProp(
      {
        playerName: p.player_name,
        market: p.market_key,
        line: Number(p.line),
        side: p.side,
      },
      allLines,
    );

    if (!g) {
      // Distinguish "not final yet" from "will never grade".
      //
      // gradeProp returns null both for a game still in progress AND for a
      // player who never entered a game that has already ended — a scratch, a
      // late lineup change, a pitcher who didn't take the mound. Treating both
      // as "wait" meant one scratched player held the entire recap forever:
      // the slate was complete, every other leg was settled, and the post just
      // never came.
      //
      // If the player's game is FINAL and there's still no line for him, the
      // pick can't be graded and never will be. That's a void, which is how a
      // sportsbook treats a scratch too — stake back, excluded from the record
      // rather than counted as a loss.
      const gameFinal = allLines.length > 0;
      if (gameFinal && p.player_name) {
        const played = allLines.some(
          (l) =>
            l.name.toLowerCase().trim() ===
            String(p.player_name).toLowerCase().trim(),
        );
        if (!played) {
          await supabaseAdmin!
            .from("manual_picks")
            .update({
              result: "void",
              settled_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", p.id)
            .is("result", null);
          graded.push({ text: p.pick_text, result: "void" });
          continue;
        }
      }
      ungraded++;
      continue;
    }

    const stake = Number(p.units ?? 1);
    const profit =
      g.result === "win"
        ? stake * (americanToDecimal(Number(p.odds ?? -110)) - 1)
        : g.result === "push"
          ? 0
          : -stake;

    await supabaseAdmin!
      .from("manual_picks")
      .update({
        result: g.result,
        actual_value: g.actualValue,
        profit_units: Math.round(profit * 100) / 100,
        settled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", p.id)
      .is("result", null); // no double-settling

    unitsNet += profit;
    graded.push({ text: p.pick_text, result: g.result });
  }

  // Hold the recap until the slate is fully settled — see header note.
  if (ungraded > 0 && !force) {
    await releaseClaim();
    return {
      batchKey,
      waiting: true,
      graded: graded.length,
      ungraded,
      message: `${ungraded} pick(s) not final yet — holding recap`,
    };
  }

  if (graded.length === 0) {
    await releaseClaim();
    return { batchKey, waiting: true, message: "Nothing graded yet" };
  }

  if (!BOT_API_URL) {
    await releaseClaim();
    return { batchKey, ok: false, error: "BOT_API_URL not configured" };
  }

  const dateLabel = new Date(slate + "T12:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  // Title mirrors the pick post it's settling, so the pair reads as a set.
  const isParlay = batchKey.includes("_parlay_");
  const title = isParlay ? "PARLAY OF THE DAY" : "PLAYER PROPS";

  try {
    const r = await fetch(`${BOT_API_URL}/results/post`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-bot-secret": BOT_API_SECRET,
      },
      body: JSON.stringify({
        sport,
        dateLabel,
        title,
        // Echoed back on a sweep so the recap can show the exact slip that
        // cashed — see buildResultsEmbed. Same key the admin panel writes.
        betslip_url:
          (
            await cloudGet<{ url?: string } | null>(
              `playbook_link_${sport}_${slate}`,
              null,
            )
          )?.url ?? undefined,
        legs: graded,
        unitsNet: Math.round(unitsNet * 100) / 100,
      }),
      signal: AbortSignal.timeout(10000),
    });
    const posted = await r.json();
    if (!posted.ok) {
      await releaseClaim();
      return { batchKey, ok: false, error: posted.error };
    }

    // Mark done so the next cron tick doesn't repost.
    await supabaseAdmin!.from("app_state").upsert({
      key: recapKey,
      value: { messageId: posted.message_id, at: new Date().toISOString() },
    });

    return {
      batchKey,
      ok: true,
      posted: true,
      title,
      graded: graded.length,
      unitsNet: Math.round(unitsNet * 100) / 100,
      messageId: posted.message_id,
    };
  } catch (e: any) {
    // Release so a transient failure doesn't permanently suppress the recap.
    await releaseClaim().catch(() => {});
    return { batchKey, ok: false, error: String(e) };
  }
}
