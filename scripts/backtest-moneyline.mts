// Walk-forward backtest of the Bot Challenge (moneyline) model.
//
// Reproduces the pitcher + Elo halves of runPitcherModel/runEloPowerModel and
// buildConsensus using ONLY data knowable before first pitch, then grades
// against the real final score.
//
// The market model (40% of consensus) is deliberately EXCLUDED here: historical
// closing moneylines aren't in the free MLB API, and substituting today's odds
// would leak the future. So this measures the INDEPENDENT 60% — which is the
// half worth knowing about anyway. If the independent signal can't beat a
// baseline, blending it with the market just launders the market's opinion.

const SEASON = Number(process.argv[2] ?? 2025);
const MAX_DAYS = Number(process.argv[3] ?? 120);

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

// ── Pitcher season stats as of a date (cumulative, no leakage) ──
const pitcherCache = new Map<
  string,
  { era: number; whip: number; k9: number } | null
>();

async function pitcherThrough(id: number, date: string) {
  const key = `${id}|${date}`;
  if (pitcherCache.has(key)) return pitcherCache.get(key)!;
  const d = await j(
    `https://statsapi.mlb.com/api/v1/people/${id}/stats?stats=byDateRange&group=pitching&startDate=${SEASON}-03-01&endDate=${date}&season=${SEASON}`,
  );
  const s = d?.stats?.[0]?.splits?.[0]?.stat;
  if (!s) {
    pitcherCache.set(key, null);
    return null;
  }
  const ip = parseFloat(String(s.inningsPitched ?? "0")) || 0;
  if (ip < 10) {
    pitcherCache.set(key, null);
    return null;
  }
  const out = {
    era: parseFloat(String(s.era ?? "4.5")) || 4.5,
    whip: parseFloat(String(s.whip ?? "1.3")) || 1.3,
    k9: ip > 0 ? (Number(s.strikeOuts ?? 0) * 9) / ip : 8,
  };
  pitcherCache.set(key, out);
  return out;
}

// ── Elo, built forward through the season ──
const elo = new Map<string, number>();
const E0 = 1500;
const getElo = (t: string) => elo.get(t) ?? E0;
function updateElo(home: string, away: string, homeWon: boolean) {
  const K = 4;
  const eh = getElo(home),
    ea = getElo(away);
  const exp = 1 / (1 + Math.pow(10, (ea - eh) / 400));
  const act = homeWon ? 1 : 0;
  elo.set(home, eh + K * (act - exp));
  elo.set(away, ea + K * (exp - act));
}

// Mirrors runPitcherModel's arithmetic.
function pitcherProb(hp: any, ap: any): number {
  if (!hp && !ap) return 0.52;
  let edge = 0;
  const hERA = hp?.era ?? 4.5,
    aERA = ap?.era ?? 4.5;
  edge += (aERA - hERA) * 3;
  const hW = hp?.whip ?? 1.3,
    aW = ap?.whip ?? 1.3;
  edge += (aW - hW) * 5;
  if ((hp?.k9 ?? 8) > 10) edge += 3;
  if ((ap?.k9 ?? 8) > 10) edge -= 3;
  return Math.min(0.8, Math.max(0.2, 0.52 + edge / 100));
}

function eloProb(home: string, away: string): number {
  const eh = getElo(home) + 24; // home-field, as the real model does
  return 1 / (1 + Math.pow(10, (getElo(away) - eh) / 400));
}

const main = async () => {
  const sched = await j(
    `https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${SEASON}-04-01&endDate=${SEASON}-09-28&hydrate=probablePitcher`,
  );
  const dates: any[] = sched?.dates ?? [];
  console.log(`season ${SEASON}: ${dates.length} dates`);

  let n = 0,
    correct = 0,
    brier = 0;
  let bBrier = 0,
    bCorrect = 0; // baseline: flat home-field 54%
  const buckets = new Map<number, { n: number; w: number }>();
  const pairs: Array<[number, number]> = [];
  let warm = 0;

  for (const day of dates.slice(0, MAX_DAYS)) {
    const date = day.date;
    for (const g of day.games ?? []) {
      if (g.status?.abstractGameState !== "Final") continue;
      const home = g.teams?.home?.team?.name,
        away = g.teams?.away?.team?.name;
      const hs = g.teams?.home?.score,
        as = g.teams?.away?.score;
      if (!home || !away || hs == null || as == null || hs === as) continue;
      const homeWon = hs > as;

      // First 200 games only train Elo — predicting off a cold rating is noise.
      warm++;
      if (warm < 200) {
        updateElo(home, away, homeWon);
        continue;
      }

      const hpId = g.teams?.home?.probablePitcher?.id;
      const apId = g.teams?.away?.probablePitcher?.id;
      const [hp, ap] = await Promise.all([
        hpId ? pitcherThrough(hpId, date) : null,
        apId ? pitcherThrough(apId, date) : null,
      ]);

      // Consensus with the market's 0.40 removed and the rest renormalised:
      // pitcher 0.35/0.60 = 0.583, elo 0.25/0.60 = 0.417
      const p = pitcherProb(hp, ap) * 0.583 + eloProb(home, away) * 0.417;

      const act = homeWon ? 1 : 0;
      brier += (p - act) ** 2;
      if (p > 0.5 === homeWon) correct++;
      bBrier += (0.54 - act) ** 2;
      if (homeWon) bCorrect++;
      n++;

      const d = Math.min(9, Math.floor(p * 10));
      const b = buckets.get(d) ?? { n: 0, w: 0 };
      b.n++;
      b.w += act;
      buckets.set(d, b);
      pairs.push([p, act]);

      updateElo(home, away, homeWon);
    }
    if (n && n % 400 < 16) console.log(`  ...${n} graded`);
  }

  if (!n) {
    console.log("no games graded");
    return;
  }
  console.log(`\ngraded games: ${n}`);
  console.log(
    `model    accuracy ${((correct / n) * 100).toFixed(1)}%  Brier ${(brier / n).toFixed(4)}`,
  );
  console.log(
    `baseline accuracy ${((bCorrect / n) * 100).toFixed(1)}%  Brier ${(bBrier / n).toFixed(4)}   (always pick home)`,
  );
  console.log(
    `skill vs baseline: ${((1 - brier / n / (bBrier / n)) * 100).toFixed(2)}%`,
  );
  // The bot bets at most 4 games a day behind an EV gate, so overall accuracy
  // isn't what it experiences — the tail is. Check whether being more
  // selective actually helps, or whether the edge is flat.
  console.log("\nconfidence bands (how sure the model is):");
  for (const t of [0.02, 0.05, 0.08, 0.1, 0.12]) {
    const sel = pairs.filter(([p]) => Math.abs(p - 0.5) >= t);
    if (sel.length < 30) continue;
    const hit = sel.filter(([p, a]) => p > 0.5 === (a === 1)).length;
    console.log(
      `  edge>=${(t * 100).toFixed(0)}pts: ${String(sel.length).padStart(4)} games, ${((hit / sel.length) * 100).toFixed(1)}% correct`,
    );
  }

  console.log("\ncalibration (predicted home win% -> actual):");
  for (const k of [...buckets.keys()].sort((a, b) => a - b)) {
    const b = buckets.get(k)!;
    if (b.n < 25) continue;
    const pred = k * 10 + 5,
      act = (b.w / b.n) * 100;
    console.log(
      `  ${String(pred).padStart(3)}% -> ${act.toFixed(1).padStart(5)}%  (n=${b.n})${Math.abs(pred - act) > 8 ? "  <-- off" : ""}`,
    );
  }
};

main();
