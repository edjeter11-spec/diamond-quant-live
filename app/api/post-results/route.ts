import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server-auth";
import { etDateString } from "@/lib/sports-date";
import {
  fetchFinalGames,
  fetchGamePlayerLines,
  gradeMlbProp,
  type PlayerLine,
} from "@/lib/mlb/prop-grader";
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
// ──────────────────────────────────────────────────────────

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

  if (sport !== "mlb")
    return NextResponse.json({
      ok: false,
      error: "Only MLB grading is implemented",
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
  const finals = await fetchFinalGames(slate);
  if (finals.length === 0)
    return NextResponse.json({
      ok: true,
      message: `No final games for ${slate} yet`,
    });

  const allLines: PlayerLine[] = [];
  for (const g of finals) {
    allLines.push(...(await fetchGamePlayerLines(g.gamePk)));
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
      await recapBatch(batchKey, batchPicks, allLines, slate, sport, force),
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
  slate: string,
  sport: string,
  force: boolean,
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

  const graded: Array<{ text: string; result: string }> = [];
  let ungraded = 0;
  let unitsNet = 0;

  for (const p of picks) {
    if (p.result) {
      graded.push({ text: p.pick_text, result: p.result });
      unitsNet += Number(p.profit_units ?? 0);
      continue;
    }

    const g = gradeMlbProp(
      {
        playerName: p.player_name,
        market: p.market_key,
        line: Number(p.line),
        side: p.side,
      },
      allLines,
    );

    if (!g) {
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
  if (ungraded > 0 && !force)
    return {
      batchKey,
      waiting: true,
      graded: graded.length,
      ungraded,
      message: `${ungraded} pick(s) not final yet — holding recap`,
    };

  if (graded.length === 0)
    return { batchKey, waiting: true, message: "Nothing graded yet" };

  if (!BOT_API_URL)
    return { batchKey, ok: false, error: "BOT_API_URL not configured" };

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
        legs: graded,
        unitsNet: Math.round(unitsNet * 100) / 100,
      }),
      signal: AbortSignal.timeout(10000),
    });
    const posted = await r.json();
    if (!posted.ok) return { batchKey, ok: false, error: posted.error };

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
    return { batchKey, ok: false, error: String(e) };
  }
}
