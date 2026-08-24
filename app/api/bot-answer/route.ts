import { NextRequest, NextResponse } from "next/server";
import { getCached, setCache } from "@/lib/odds/server-cache";
import { checkIpRateLimit } from "@/lib/ip-rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// ──────────────────────────────────────────────────────────
// BOT ANSWER — grounded free-form Q&A for Discord @mentions
//
// The old mention flow was two regex routers: "parlay" → parlay-builder,
// anything else → /api/ask's single-player lookup. Competent for exactly
// those two shapes and useless for everything in between — "is the Yankees
// ML good tonight", "what do you like today", "how are we doing this week"
// all dead-ended in "couldn't find that player".
//
// This route answers ANY phrasing by doing the two halves separately:
//   1. Gather real data (today's boards, the graded record, sharp edges,
//      and the /api/ask player payload when a name resolves).
//   2. Let Gemini COMPOSE from that data — and only that data. The model
//      is a writer here, not a source: the prompt forbids invented stats,
//      odds, or picks, and the context block is everything it may cite.
//
// Secret-gated (x-bot-secret): this spends Gemini calls and, on team/board
// questions, 2 Odds API credits via edge-scan — not a public surface.
// If Gemini is unavailable the route returns answer:null and the bot falls
// back to its legacy /api/ask rendering, so mentions never go unanswered.
// ──────────────────────────────────────────────────────────

const SITE = "https://diamond-quant-live.vercel.app";
const GEMINI_KEY = process.env.GEMINI_API_KEY ?? "";
// gemini-2.0-flash was RETIRED by Google (404s as of Aug 2026) — that
// outage was silent everywhere it was used because every caller degrades
// to null on error. 3.6-flash is the current flash tier; its thinking
// tokens count against maxOutputTokens, so budgets need ~3x headroom over
// the visible answer length.
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent";

const j = async (u: string, ms = 12000) => {
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(ms) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
};

/** Compact a board pick to the fields worth citing — the raw rows carry
 *  reasoning arrays and internal ids that just bloat the prompt. */
const slimPick = (p: any) => ({
  player: p.playerName,
  market: p.label ?? p.market,
  side: p.side,
  line: p.line,
  odds: p.odds,
  book: p.bookmaker,
  modelProb: p.fairProb,
  evPct: p.evPercentage,
});

export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-bot-secret") ?? "";
  if (!process.env.BOT_API_SECRET || secret !== process.env.BOT_API_SECRET) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }
  const rl = checkIpRateLimit(req, {
    limit: 20,
    windowMs: 60_000,
    key: "bot-answer",
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate limited" },
      { status: 429 },
    );
  }

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim().slice(0, 300);
  if (!q) return NextResponse.json({ ok: false, error: "q required" });

  // Identical question inside a minute (friends spamming the same @) —
  // answer once, serve the same reply.
  const qKey = `bot_answer_${q.toLowerCase().replace(/\W+/g, "_").slice(0, 80)}`;
  const hit = getCached(qKey, 60_000);
  if (hit) return NextResponse.json(hit);

  // Edge scan costs 2 Odds API credits per call, so it only runs when the
  // question is about teams/sides/the board rather than a specific player
  // stat — and the result is cached 2 min so a burst of mentions still
  // spends one scan. Everything else is internal and free.
  const wantsEdges =
    /\b(ml|moneyline|money\s*line|sharp|edge|side|team|game|tonight|today|best|like|lock|play|bet|board|pick)/i.test(
      q,
    );
  const edgesFor = async (sport: string) => {
    const key = `bot_answer_edges_${sport}`;
    const c = getCached(key, 120_000);
    if (c) return c;
    const d = await j(`${SITE}/api/edge-scan?minEv=1&sport=${sport}`, 15000);
    const out = (d?.edges ?? []).slice(0, 6);
    setCache(key, out);
    return out;
  };

  const [askData, mlbBoard, nflBoard, record, mlbEdges, nflEdges] =
    await Promise.all([
      j(`${SITE}/api/ask?q=${encodeURIComponent(q)}`, 18000),
      j(`${SITE}/api/pinned-props?sport=mlb`),
      j(`${SITE}/api/pinned-props?sport=nfl`),
      j(`${SITE}/api/bot-record?sport=mlb&days=7`),
      wantsEdges ? edgesFor("mlb") : Promise.resolve([]),
      wantsEdges ? edgesFor("nfl") : Promise.resolve([]),
    ]);

  const context = {
    today: new Date().toLocaleDateString("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    playerLookup: askData?.ok
      ? {
          player: askData.player,
          onTodaysBoard: askData.onBoard,
          modelReadNotAPick: askData.liveProp,
          seasonForm: askData.form?.season ?? null,
          projection: askData.form?.projection ?? null,
        }
      : null,
    mlbBoardToday: (mlbBoard?.picks ?? []).slice(0, 12).map(slimPick),
    nflBoardToday: (nflBoard?.picks ?? []).slice(0, 12).map(slimPick),
    nflBoardStatus: nflBoard?.waiting
      ? "waiting for game day"
      : (nflBoard?.picks?.length ?? 0) === 0
        ? "no NFL picks published today"
        : "published",
    last7dRecord: record?.record
      ? {
          ...record.record,
          winRatePct: record.winRate ?? null,
          unitsNet: record.unitsNet ?? null,
        }
      : null,
    sharpEdgesVsPinnacle: {
      mlb: mlbEdges,
      nfl: nflEdges,
      note: "positive evPct = US book beats Pinnacle fair price; these are the only CLV-proven +EV plays",
    },
  };

  if (!GEMINI_KEY) {
    return NextResponse.json({ ok: true, answer: null, reason: "no-gemini" });
  }

  const prompt = `You are Quant, the house model bot in a small Discord of friends who bet recreationally. Someone @mentioned you and asked:

"${q}"

Answer using ONLY the data below. Hard rules:
- NEVER invent a stat, price, pick, player, or game. If the data doesn't cover what they asked, say so plainly and offer the closest thing you DO have (e.g. today's board, the player's form).
- Distinguish clearly between an OFFICIAL board pick (published, with a price) and a model read that did NOT make the board — a good probability at a bad price is not a pick.
- If they ask about a player and playerLookup is null, say you couldn't match the name and ask them to try the full name.
- When you cite a pick or edge, always include the book and price.
- If they ask how we're doing / the record / this week: lead with last7dRecord as "W-L, +X.Xu over the last 7 days" (unitsNet is units won/lost).
- Be direct and a little sharp, like a numbers guy at the table — no hype, no "lock of the century", no guarantees. One short honest caveat max, not a lecture.
- Discord markdown allowed (** bold **, bullet lines). Under 150 words, at most 4 bullets. ALWAYS finish with a complete sentence — never stop mid-list.

DATA:
${JSON.stringify(context)}`;

  try {
    const r = await fetch(`${GEMINI_URL}?key=${GEMINI_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.5, maxOutputTokens: 2048 },
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) return NextResponse.json({ ok: true, answer: null });
    const d = await r.json();
    const answer: string | null =
      d.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
    const out = {
      ok: true,
      answer,
      used: {
        player: Boolean(context.playerLookup),
        mlbPicks: context.mlbBoardToday.length,
        nflPicks: context.nflBoardToday.length,
        edges: wantsEdges,
      },
    };
    if (answer) setCache(qKey, out);
    return NextResponse.json(out);
  } catch {
    return NextResponse.json({ ok: true, answer: null });
  }
}
