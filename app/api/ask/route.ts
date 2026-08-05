import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// ──────────────────────────────────────────────────────────
// ASK — one player, everything we know
//
// Backs the Discord "@quant is Harper getting a hit?" flow. Answers in three
// tiers, and says WHICH tier it's answering from rather than blurring them:
//
//   1. A pinned pick    — this player is on today's board, with a price
//   2. A live prop      — books have a line, the model has a projection,
//                         but it didn't make the board (usually the price)
//   3. Stats only       — no prop posted; season form + last 10 games
//
// Tier 3 is the reason this is worth building. The board only covers players
// with props posted today; the profile endpoint covers ANYONE. Without it the
// bot would have to say "I don't know" about most of the league, which is a
// worse answer than "here's his form, no line posted."
//
// Deliberately does NOT turn a projection into a recommendation. A 61% player
// can be a bad bet at the offered price — the board rejects picks on price all
// the time — so the response separates "how likely" from "worth betting".
// ──────────────────────────────────────────────────────────

const SITE = "https://diamond-quant-live.vercel.app";

const MARKET_LABEL: Record<string, string> = {
  batter_hits: "Hits",
  batter_total_bases: "Total Bases",
  batter_home_runs: "Home Runs",
  batter_rbis: "RBIs",
  batter_runs_scored: "Runs",
  pitcher_strikeouts: "Strikeouts",
  pitcher_outs: "Outs",
};

/** Map loose phrasing to a market key. "get a hit" -> batter_hits. */
function inferMarket(q: string): string | null {
  const s = q.toLowerCase();
  if (/\bhome\s?run|\bhr\b|\bdinger|\bgo\s?yard/.test(s))
    return "batter_home_runs";
  if (/\btotal bases?|\btb\b|\bbases\b/.test(s)) return "batter_total_bases";
  if (/\brbi/.test(s)) return "batter_rbis";
  if (/\brun\b|\bruns\b|\bscore\b/.test(s)) return "batter_runs_scored";
  if (/\bstrikeout|\bstrike out|\bk'?s\b|\bpunch/.test(s))
    return "pitcher_strikeouts";
  if (/\bout(s)?\b|\binnings?\b/.test(s)) return "pitcher_outs";
  if (/\bhit\b|\bhits\b/.test(s)) return "batter_hits";
  return null;
}

const j = async (u: string, ms = 12000) => {
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(ms) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = (searchParams.get("q") ?? "").trim();
  if (!query) return NextResponse.json({ ok: false, error: "q is required" });

  const wantedMarket = inferMarket(query);

  // Strip the market words so "Bryce Harper hit" searches for the player.
  const nameGuess = query
    .replace(
      /\b(is|are|does|will|get|gets|getting|a|an|the|to|hit|hits|home\s?run|hr|rbi|rbis|run|runs|total bases?|tb|strikeouts?|ks?|outs?|today|tonight|over|under|favou?red|likely|odds|chance)\b/gi,
      " ",
    )
    .replace(/[?.!,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const search = await j(
    `${SITE}/api/mlb-player-search?q=${encodeURIComponent(nameGuess || query)}`,
  );
  const player = search?.results?.[0];
  if (!player?.id)
    return NextResponse.json({
      ok: false,
      notFound: true,
      query,
      message: `Couldn't find an MLB player matching "${nameGuess || query}".`,
    });

  // ── Tier 1/2: is there a live prop for him today? ──
  const markets = wantedMarket
    ? [wantedMarket]
    : ["batter_hits", "batter_total_bases", "batter_home_runs"];

  let prop: any = null;
  for (const m of markets) {
    const d = await j(`${SITE}/api/players?sport=baseball_mlb&market=${m}`);
    const found = (d?.props ?? []).find(
      (p: any) =>
        String(p.playerName ?? "").toLowerCase() ===
        String(player.fullName).toLowerCase(),
    );
    if (found?.brainOverProb > 0) {
      prop = { ...found, market: m };
      break;
    }
  }

  // Is he on today's published board?
  const board = await j(`${SITE}/api/pinned-props?sport=mlb`);
  const pinned = (board?.picks ?? []).find(
    (p: any) =>
      String(p.playerName ?? "").toLowerCase() ===
      String(player.fullName).toLowerCase(),
  );

  // ── Tier 3: season form + last 10, available for ANY player ──
  const profile = await j(
    `${SITE}/api/mlb-player-profile?id=${player.id}&name=${encodeURIComponent(player.fullName)}`,
    15000,
  );

  const last10 = (profile?.last10Games ?? []).slice(0, 10);
  const projections = profile?.projections ?? [];
  const proj = wantedMarket
    ? projections.find((p: any) => p.market === wantedMarket)
    : null;

  return NextResponse.json({
    ok: true,
    player: {
      name: player.fullName,
      team: player.team,
      position: player.position,
      photo: profile?.player?.photo ?? null,
    },
    market: wantedMarket ? (MARKET_LABEL[wantedMarket] ?? wantedMarket) : null,
    // Tier 1 — a published pick, price included.
    onBoard: pinned
      ? {
          side: pinned.side,
          line: pinned.line,
          label: pinned.label,
          odds: pinned.odds,
          bookmaker: pinned.bookmaker,
          modelProb: pinned.fairProb,
          evPercentage: pinned.evPercentage,
        }
      : null,
    // Tier 2 — the model has an opinion, but this isn't a published pick.
    // `notAPick` matters: a high probability at a bad price is exactly what
    // the board filters out, and the bot must not imply otherwise.
    liveProp: prop
      ? {
          line: prop.line,
          label: MARKET_LABEL[prop.market] ?? prop.market,
          modelOverProb: prop.brainOverProb,
          bestOver: prop.bestOver ?? null,
          bestUnder: prop.bestUnder ?? null,
          opposingPitcher: prop.opposingPitcher ?? null,
          reasons: prop.brainReasons ?? [],
          notAPick: !pinned,
        }
      : null,
    // Tier 3 — always present. This is what makes the bot answerable about
    // players who have no prop posted at all.
    form: {
      season: profile?.player
        ? {
            games: profile.player.gamesPlayed,
            avg: profile.player.avg,
            ops: profile.player.ops,
            homeRuns: profile.player.homeRuns,
            rbi: profile.player.rbi,
            hitsPerGame: profile.player.hitsPerGame,
          }
        : null,
      projection: proj
        ? {
            market: proj.label,
            seasonAvg: proj.seasonAvg,
            last10Avg: proj.last10Avg,
            last5Avg: proj.last5Avg,
            trend: proj.trend,
            projection: proj.projection,
          }
        : null,
      last10: last10.map((g: any) => ({
        date: g.date,
        opponent: g.opponent,
        hits: g.hitsB ?? g.hits,
        totalBases: g.totalBases,
        homeRuns: g.homeRuns,
        rbi: g.rbi,
      })),
    },
  });
}
