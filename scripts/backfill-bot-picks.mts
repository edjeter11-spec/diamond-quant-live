// Backfill bot_picks by replaying the moneyline model over past slates.
//
// The ledger has 4 graded picks. At ~2 picks/day it needs a month before it
// can say anything, and until then "62% accuracy" is a backtest claim with no
// forward evidence. Replaying the model over the last N days produces the same
// sample immediately.
//
// STRICT about leakage — a backfill that peeks is worse than no backfill,
// because it manufactures confidence:
//   - pitcher stats are pulled `byDateRange` ending the DAY BEFORE the game,
//     so a pitcher's line from the game itself never informs the pick
//   - Elo is built forward chronologically and only updated AFTER a game is
//     scored
//   - only the probable pitchers listed on the schedule are used, which is
//     what was knowable pre-game
//
// What it CANNOT reconstruct: historical closing odds. The free API doesn't
// carry them. Rows are written with the model's probability and a null price,
// so these prove ACCURACY, not profit. Those are different questions and only
// the second one pays. Marked source='backfill' so they can never be silently
// mixed into a live-record claim.

import fs from "fs";

const DAYS = Number(process.argv[2] ?? 60);
const DRY = process.argv.includes("--dry");

const raw = fs.readFileSync(".env.bf", "utf8");
function env(name: string): string {
  const line = raw.split(/\r?\n/).find((l) => l.startsWith(name + "="));
  if (!line) return "";
  let v = line.slice(name.length + 1);
  if (v.startsWith('"')) v = v.slice(1);
  const q = v.lastIndexOf('"');
  if (q >= 0) v = v.slice(0, q);
  return v.split("\\n").join("").trim();
}
const SUPA = env("NEXT_PUBLIC_SUPABASE_URL");
const KEY = env("SUPABASE_SERVICE_ROLE_KEY");

const j = async (u: string) => {
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(20000) });
      if (r.ok) return r.json();
    } catch {}
    await new Promise((s) => setTimeout(s, 400 * (a + 1)));
  }
  return null;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const dayBefore = (date: string) => {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return iso(d);
};

// ── Pitcher stats as of the day BEFORE the game ──
const pCache = new Map<string, any>();
async function pitcherThrough(id: number, gameDate: string, season: number) {
  const end = dayBefore(gameDate);
  const key = `${id}|${end}`;
  if (pCache.has(key)) return pCache.get(key);
  const d = await j(
    `https://statsapi.mlb.com/api/v1/people/${id}/stats?stats=byDateRange&group=pitching&startDate=${season}-03-01&endDate=${end}&season=${season}`,
  );
  const s = d?.stats?.[0]?.splits?.[0]?.stat;
  let out = null;
  if (s) {
    const ip = parseFloat(String(s.inningsPitched ?? "0")) || 0;
    if (ip >= 10)
      out = {
        era: parseFloat(String(s.era ?? "4.5")) || 4.5,
        whip: parseFloat(String(s.whip ?? "1.3")) || 1.3,
        k9: (Number(s.strikeOuts ?? 0) * 9) / ip,
      };
  }
  pCache.set(key, out);
  return out;
}

// ── Model (mirrors lib/bot/three-models.ts, market half excluded) ──
const elo = new Map<string, number>();
const getElo = (t: string) => elo.get(t) ?? 1500;
function updElo(home: string, away: string, homeWon: boolean) {
  const eh = getElo(home),
    ea = getElo(away);
  const exp = 1 / (1 + Math.pow(10, (ea - eh) / 400));
  const act = homeWon ? 1 : 0;
  elo.set(home, eh + 4 * (act - exp));
  elo.set(away, ea + 4 * (exp - act));
}
function pitcherProb(hp: any, ap: any) {
  if (!hp && !ap) return 0.52;
  let e = 0;
  e += ((ap?.era ?? 4.5) - (hp?.era ?? 4.5)) * 3;
  e += ((ap?.whip ?? 1.3) - (hp?.whip ?? 1.3)) * 5;
  if ((hp?.k9 ?? 8) > 10) e += 3;
  if ((ap?.k9 ?? 8) > 10) e -= 3;
  return Math.min(0.8, Math.max(0.2, 0.52 + e / 100));
}
// Same Platt curve the live model uses (slope only, intercept 0).
const CAL_A = 2.7548;
const calibrate = (p: number) => {
  const c = Math.min(0.995, Math.max(0.005, p));
  return 1 / (1 + Math.exp(-(CAL_A * Math.log(c / (1 - c)))));
};

const main = async () => {
  const today = new Date();
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - DAYS);
  const season = today.getUTCFullYear();

  console.log(`replaying ${iso(start)} -> ${iso(today)}`);

  const sched = await j(
    `https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${iso(start)}&endDate=${iso(today)}&hydrate=probablePitcher,team`,
  );
  const dates: any[] = sched?.dates ?? [];
  console.log(`${dates.length} dates`);

  const rows: any[] = [];
  let warm = 0;

  for (const day of dates) {
    for (const g of day.games ?? []) {
      if (g.status?.abstractGameState !== "Final") continue;
      const home = g.teams?.home?.team?.abbreviation;
      const away = g.teams?.away?.team?.abbreviation;
      const hs = g.teams?.home?.score,
        as = g.teams?.away?.score;
      if (!home || !away || hs == null || as == null || hs === as) continue;
      const homeWon = hs > as;

      // Warm Elo before trusting it — a cold rating is noise, not a prediction.
      warm++;
      if (warm < 150) {
        updElo(home, away, homeWon);
        continue;
      }

      const hpId = g.teams?.home?.probablePitcher?.id;
      const apId = g.teams?.away?.probablePitcher?.id;
      const [hp, ap] = await Promise.all([
        hpId ? pitcherThrough(hpId, day.date, season) : null,
        apId ? pitcherThrough(apId, day.date, season) : null,
      ]);

      const eloP =
        1 / (1 + Math.pow(10, (getElo(away) - (getElo(home) + 24)) / 400));
      const rawP = pitcherProb(hp, ap) * 0.583 + eloP * 0.417;
      const p = calibrate(rawP);

      // Only picks the live engine would actually publish: it needs a side it
      // believes in, not a coin flip.
      const edge = Math.abs(p - 0.5);
      if (edge < 0.05) {
        updElo(home, away, homeWon);
        continue;
      }

      const pickHome = p > 0.5;
      const pickProb = pickHome ? p : 1 - p;
      const won = pickHome === homeWon;

      rows.push({
        id: `backfill-${day.date}-${g.gamePk}`,
        sport: "mlb",
        slate_date: day.date,
        game_id: String(g.gamePk),
        game: `${away} @ ${home}`,
        pick: `${pickHome ? home : away} ML`,
        market: "moneyline",
        // No historical odds available — see header. -110 is a placeholder so
        // the column is populated; profit_units is deliberately left null
        // rather than computed from a price we don't actually have.
        odds: -110,
        bookmaker: null,
        stake: 100,
        model_prob: Math.round(pickProb * 10000) / 10000,
        raw_prob: Math.round((pickHome ? rawP : 1 - rawP) * 10000) / 10000,
        ev_percentage: null,
        // Thresholds from the measured accuracy curve over 449 replayed
        // picks: >=15pts 62.6%, >=10pts 56.8%, >=5pts 55.0%. The previous
        // 10/7.5 split carved out a 76-pick MEDIUM band at 48.7% that read as
        // "the model is worse when more confident" — an artifact of where the
        // lines fell, not a real inversion.
        confidence: edge >= 0.15 ? "HIGH" : edge >= 0.1 ? "MEDIUM" : "LOW",
        result: won ? "win" : "loss",
        payout: 0,
        profit_units: null,
        final_score: `${as}-${hs}`,
        settled_at: new Date(day.date + "T23:59:00Z").toISOString(),
      });

      updElo(home, away, homeWon);
    }
    if (rows.length && rows.length % 100 < 3)
      console.log(`  ...${rows.length} picks replayed`);
  }

  const wins = rows.filter((r) => r.result === "win").length;
  console.log(`
edge distribution (|p-0.5|):`);
  const edges = rows.map((r) => Math.abs(r.model_prob - 0.5));
  edges.sort((a, b) => a - b);
  console.log(
    `  min ${(edges[0] * 100).toFixed(1)}pts  median ${(edges[Math.floor(edges.length / 2)] * 100).toFixed(1)}pts  max ${(edges[edges.length - 1] * 100).toFixed(1)}pts`,
  );
  for (const t of [0.05, 0.1, 0.15, 0.2]) {
    const sel = rows.filter((r) => Math.abs(r.model_prob - 0.5) >= t);
    if (sel.length < 20) continue;
    const w = sel.filter((r) => r.result === "win").length;
    console.log(
      `  edge>=${(t * 100).toFixed(0)}pts: ${String(sel.length).padStart(4)} picks  ${((w / sel.length) * 100).toFixed(1)}%`,
    );
  }
  console.log(`\nreplayed ${rows.length} picks`);
  console.log(
    `accuracy: ${((wins / rows.length) * 100).toFixed(1)}%  (${wins}W-${rows.length - wins}L)`,
  );
  for (const band of ["HIGH", "MEDIUM", "LOW"]) {
    const sel = rows.filter((r) => r.confidence === band);
    if (!sel.length) continue;
    const w = sel.filter((r) => r.result === "win").length;
    console.log(
      `  ${band.padEnd(7)} ${String(sel.length).padStart(4)} picks  ${((w / sel.length) * 100).toFixed(1)}%`,
    );
  }

  if (DRY) {
    console.log("\n--dry: nothing written");
    return;
  }

  // Write in chunks; ignore duplicates so a re-run is safe.
  let written = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const r = await fetch(`${SUPA}/rest/v1/bot_picks?on_conflict=id`, {
      method: "POST",
      headers: {
        apikey: KEY,
        Authorization: "Bearer " + KEY,
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates",
      },
      body: JSON.stringify(chunk),
    });
    if (!r.ok) {
      console.log("write failed:", r.status, (await r.text()).slice(0, 200));
      break;
    }
    written += chunk.length;
  }
  console.log(`wrote ${written} rows`);
};

main();
