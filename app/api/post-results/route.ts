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

/** Lowercase + strip diacritics. Every name/team comparison in this file must
 *  go through this: an exact-string check is what turned a real "Jeremy Peña"
 *  loss into a void, because the box score spells it with ñ and the stored
 *  pick doesn't. */
function deaccent(s: string): string {
  return (s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

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
    // A claim with a real messageId means the recap genuinely posted — never
    // touch it. But a claim still marked `pending: true` means a previous run
    // claimed the batch and then died before finishing (Vercel's 60s
    // maxDuration, a thrown grader, a failed releaseClaim). Nothing expires
    // those, so the batch was blocked FOREVER: every later tick read a truthy
    // flag and returned alreadyPosted. That's what stranded the 2026-08-05
    // parlay until it was cleared by hand. Treat a pending claim older than
    // 15 minutes as abandoned and take it over.
    const claimVal: any = flag?.value;
    if (claimVal) {
      const stale =
        claimVal.pending === true &&
        Date.now() - Date.parse(claimVal.claimedAt ?? 0) > 15 * 60_000;
      if (!stale) return { batchKey, alreadyPosted: true };
      await supabaseAdmin!.from("app_state").delete().eq("key", recapKey);
    }
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
  //
  // `force=true` deliberately bypasses the whole claim mechanism — it exists
  // so an admin can re-post a recap that went out wrong. Be aware that means
  // it WILL post a duplicate to Discord if the original send succeeded; it is
  // a manual override, not something cron should ever pass.
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

  // Broadened per the Discord hype pass: `actualValue` and `line` let the bot
  // render "Judge o0.5 HR — 0-4" instead of naked "Judge Over 0.5 HR", which
  // is the difference between "the score" and "a receipt". Optional so old
  // rows without an actual grade fall through cleanly.
  const graded: Array<{
    text: string;
    result: string;
    actualValue?: number | null;
    line?: number | null;
    odds?: number | null;
  }> = [];
  let ungraded = 0;
  let unitsNet = 0;

  for (const p of picks) {
    if (p.result) {
      graded.push({
        text: p.pick_text,
        result: p.result,
        actualValue: p.actual_value ?? null,
        line: p.line ?? null,
        odds: p.odds ?? null,
      });
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
      const norm = deaccent;
      // Require BOTH sides of the matchup to line up, not either one. A
      // one-sided match cross-matches teams that share a city or nickname
      // (Chicago, New York, the several Rangers/Giants/Cardinals across
      // leagues) and would grade a pick against the wrong game's score.
      // Empty names can't match: `.includes("")` is always true, so a feed
      // that returns blank team names would otherwise match every game.
      const sideMatch = (pickSide: string, apiSide: string) => {
        const p1 = norm(pickSide),
          a1 = norm(apiSide);
        if (!p1 || !a1) return false;
        return p1.includes(a1) || a1.includes(p1);
      };
      const final = finals.find(
        (f) => sideMatch(pickHome, f.home) && sideMatch(pickAway, f.away),
      );
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
      graded.push({
        text: p.pick_text,
        result,
        actualValue: p.actual_value ?? null,
        line: p.line ?? null,
        odds: p.odds ?? null,
      });
      continue;
    }

    // A row that is neither a moneyline nor a gradeable player prop — e.g. a
    // game TOTAL or spread that leaked into a parlay — has null player_name /
    // market_key. Passing that to gradeProp reaches findPlayer(null) →
    // null.normalize() → TypeError, which throws AFTER the recap claim is
    // taken: the batch 500s, the claim goes stale, the next tick reclaims and
    // crashes again — an infinite crash loop that also kills every later
    // batch in the cron loop. Skip-and-void it instead so the recap can
    // proceed. (The moneyline branch above already handled market:"moneyline".)
    if (!p.player_name || !p.market_key) {
      await supabaseAdmin!
        .from("manual_picks")
        .update({
          result: "void",
          settled_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", p.id)
        .is("result", null);
      graded.push({
        text: p.pick_text,
        result: "void",
        actualValue: null,
        line: p.line ?? null,
        odds: p.odds ?? null,
      });
      console.error(
        `post-results: ungradeable non-prop row voided — market=${p.market} pick=${p.pick_text}`,
      );
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
      //
      // "FINAL" must mean THIS PICK'S game, not "some game on the slate".
      // This previously read `allLines.length > 0` — but allLines is the
      // concatenation of every final game's box score, so the instant ONE
      // early game ended, every pick on the other 14 still-playing games
      // looked final, wasn't found in the (partial) line set, and got voided.
      // That mass-destroys real gradeable picks mid-slate, with no timer
      // needed — a worse version of the staleness bug that voided four wins
      // on 2026-07-30. Resolve the pick's own game and require IT to be done.
      const pickGame = p.game ? String(p.game) : "";
      const [pgAway, pgHome] = pickGame.split(" @ ");
      const sideMatches = (pickSide: string, apiSide: string) => {
        const p1 = deaccent(pickSide),
          a1 = deaccent(apiSide);
        if (!p1 || !a1) return false;
        return p1.includes(a1) || a1.includes(p1);
      };
      const thisGameFinal =
        !!pgHome &&
        !!pgAway &&
        finals.some(
          (f) => sideMatches(pgHome, f.home) && sideMatches(pgAway, f.away),
        );
      // A prop's stored `game` is not trustworthy on its own: /api/players
      // attributes some props to the wrong matchup (Bo Bichette, a Blue Jay,
      // came through tagged "Mets @ Pirates" on 2026-08-07). Voiding off a
      // wrong game would mark a pick unplayable while its REAL game was
      // still in progress. Requiring the player to be absent from a
      // FULLY-final slate removes the dependency on that field: if every
      // game is done and he appears nowhere, he genuinely didn't play.
      const wholeSlateFinal =
        finals.length > 0 &&
        finals.every(
          (f) => Number.isFinite(f.homeScore) && Number.isFinite(f.awayScore),
        ) &&
        allLines.length > 0;
      if (thisGameFinal && wholeSlateFinal && p.player_name) {
        // Accent-insensitive, same as the graders — an exact-string check
        // here is what turned a real Peña loss into a void.
        const target = deaccent(String(p.player_name));
        const played = allLines.some((l) => deaccent(l.name) === target);
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
          graded.push({
            text: p.pick_text,
            result: "void",
            actualValue: null,
            line: p.line ?? null,
            odds: p.odds ?? null,
          });
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
    graded.push({
      text: p.pick_text,
      result: g.result,
      actualValue: g.actualValue ?? null,
      line: p.line ?? null,
      odds: p.odds ?? null,
    });
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
  //
  // "PLAYER PROPS" was hardcoded for every non-parlay batch, but the props
  // batch also carries sharp-anchor MONEYLINES (see the edge-scan block in
  // pinned-props). So a recap settling "Arizona Diamondbacks ML" was headed
  // PLAYER PROPS — a team bet announced as a player prop. Derive the title
  // from what the batch actually settled, matching the section split in
  // publish-daily.
  const isParlay = batchKey.includes("_parlay_");
  const mlCount = picks.filter((p) => p.market === "moneyline").length;
  const propCount = picks.length - mlCount;
  const kind = isParlay
    ? "PARLAY"
    : mlCount > 0 && propCount > 0
      ? "BOARD"
      : mlCount > 0
        ? "SHARP MONEYLINES"
        : "PLAYER PROPS";

  // Trailing 7-day rollup for the recap's second line. `daily_picks_log`
  // does not exist in this DB (the recap in lib/email/daily-recap.ts queries
  // it and silently gets zeros); the authoritative source is manual_picks.
  // Excludes today's slate so the week line reads as PRIOR context — the
  // day's own record is already the headline.
  let weekLine: string | undefined = undefined;
  try {
    const weekAgo = new Date(slate + "T12:00:00Z");
    weekAgo.setUTCDate(weekAgo.getUTCDate() - 7);
    const weekStart = weekAgo.toISOString().slice(0, 10);
    const { data: weekRows } = await supabaseAdmin!
      .from("manual_picks")
      .select("result,profit_units,slate_date")
      .eq("sport", sport)
      .gte("slate_date", weekStart)
      .lt("slate_date", slate)
      .in("result", ["win", "loss"]);
    const wins = (weekRows ?? []).filter((r) => r.result === "win").length;
    const losses = (weekRows ?? []).filter((r) => r.result === "loss").length;
    const u =
      Math.round(
        (weekRows ?? []).reduce((s, r) => s + Number(r.profit_units ?? 0), 0) *
          10,
      ) / 10;
    if (wins + losses > 0) {
      weekLine = `Prior 7 days: ${wins}-${losses}, ${u >= 0 ? "+" : ""}${u.toFixed(1)}u`;
    }
  } catch {
    // Rollup is nice-to-have; missing it must not block the recap.
  }

  // Day W-L and net-u LIVE IN THE TITLE — mobile users see the title first,
  // and burying the score in the footer is what made the recap read like a
  // spreadsheet instead of a receipt.
  const wDay = graded.filter((g) => g.result === "win").length;
  const lDay = graded.filter((g) => g.result === "loss").length;
  const unitsRounded = Math.round(unitsNet * 10) / 10;
  const sportEmoji =
    sport === "mlb"
      ? "⚾"
      : sport === "nba"
        ? "🏀"
        : sport === "nfl"
          ? "🏈"
          : "🎯";
  const title = isParlay
    ? `${sportEmoji} ${dateLabel} · PARLAY — ${wDay > lDay ? "CASHED" : lDay > wDay ? "BUSTED" : ""}${unitsRounded !== 0 ? ` ${unitsRounded >= 0 ? "+" : ""}${unitsRounded}u` : ""}`.trim()
    : `${sportEmoji} ${dateLabel} · ${kind} — ${wDay}-${lDay}${unitsRounded !== 0 ? `, ${unitsRounded >= 0 ? "+" : ""}${unitsRounded}u` : ""}`;

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
        // Idempotency key — the bot returns the original message_id instead
        // of sending again if it sees this key twice. Covers the case where
        // Discord accepted the send but our fetch timed out waiting.
        batchKey,
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
        // Optional context lines the bot can render below the title. Older
        // bot builds ignore unknown fields — safe to add without breaking
        // existing embeds.
        weekLine,
      }),
      // 25s, not 10s. Discord's send regularly exceeds 10s under rate
      // limiting, and a timeout here does NOT mean the post failed — see the
      // catch block, which deliberately keeps the claim for exactly that
      // reason.
      signal: AbortSignal.timeout(25000),
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
    // A TIMEOUT IS NOT A FAILURE TO POST.
    //
    // This used to release the claim on any throw. But the throw is usually
    // AbortSignal.timeout firing on a SLOW response — Discord frequently
    // accepts the message and replies late under rate limiting. Releasing
    // then let the next tick re-claim and post the identical recap a second
    // time, which is precisely the double-post the claim exists to prevent.
    //
    // So: leave the claim in place on a timeout/network error. It stays
    // `pending: true`, and the 15-minute staleness rule at the top of this
    // function reclaims it if the post genuinely never landed. That trades a
    // possible 15-minute delay for never double-posting — the right way
    // round for something users see.
    const isTimeout =
      e?.name === "TimeoutError" ||
      e?.name === "AbortError" ||
      /timeout|aborted/i.test(String(e?.message ?? e));
    if (!isTimeout) await releaseClaim().catch(() => {});
    return {
      batchKey,
      ok: false,
      error: String(e),
      claimHeld: isTimeout || undefined,
    };
  }
}
