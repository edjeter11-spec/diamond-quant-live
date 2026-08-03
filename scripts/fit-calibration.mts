// Fit a calibration correction for the moneyline model.
//
// The backtest showed it's badly UNDERconfident: when it says 65%, teams
// actually win 82-87%. Its ranking is good but its numbers are wrong, and EV
// math consumes those numbers directly — so every stake it sizes is wrong too.
//
// Method: logistic (Platt) scaling. Fit `p' = sigmoid(a * logit(p) + b)` on one
// season, then report the fit's performance on a DIFFERENT season. Fitting and
// testing on the same data would just measure memorisation.

const FIT_SEASON = Number(process.argv[2] ?? 2024);
const TEST_SEASON = Number(process.argv[3] ?? 2025);
const MAX_DAYS = Number(process.argv[4] ?? 60);

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

const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
const clamp = (p: number) => Math.min(0.995, Math.max(0.005, p));

async function collect(
  season: number,
  maxDays: number,
): Promise<Array<[number, number]>> {
  const pitcherCache = new Map<string, any>();
  async function pitcherThrough(id: number, date: string) {
    const key = `${id}|${date}`;
    if (pitcherCache.has(key)) return pitcherCache.get(key);
    const d = await j(
      `https://statsapi.mlb.com/api/v1/people/${id}/stats?stats=byDateRange&group=pitching&startDate=${season}-03-01&endDate=${date}&season=${season}`,
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
    pitcherCache.set(key, out);
    return out;
  }

  const elo = new Map<string, number>();
  const getElo = (t: string) => elo.get(t) ?? 1500;
  const upd = (h: string, a: string, hw: boolean) => {
    const eh = getElo(h),
      ea = getElo(a);
    const exp = 1 / (1 + Math.pow(10, (ea - eh) / 400));
    elo.set(h, eh + 4 * ((hw ? 1 : 0) - exp));
    elo.set(a, ea + 4 * (exp - (hw ? 1 : 0)));
  };

  const pitcherProb = (hp: any, ap: any) => {
    if (!hp && !ap) return 0.52;
    let e = 0;
    e += ((ap?.era ?? 4.5) - (hp?.era ?? 4.5)) * 3;
    e += ((ap?.whip ?? 1.3) - (hp?.whip ?? 1.3)) * 5;
    if ((hp?.k9 ?? 8) > 10) e += 3;
    if ((ap?.k9 ?? 8) > 10) e -= 3;
    return Math.min(0.8, Math.max(0.2, 0.52 + e / 100));
  };

  const sched = await j(
    `https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${season}-04-01&endDate=${season}-09-28&hydrate=probablePitcher`,
  );
  const dates: any[] = sched?.dates ?? [];
  const out: Array<[number, number]> = [];
  let warm = 0;

  for (const day of dates.slice(0, maxDays)) {
    for (const g of day.games ?? []) {
      if (g.status?.abstractGameState !== "Final") continue;
      const home = g.teams?.home?.team?.name,
        away = g.teams?.away?.team?.name;
      const hs = g.teams?.home?.score,
        as = g.teams?.away?.score;
      if (!home || !away || hs == null || as == null || hs === as) continue;
      const hw = hs > as;
      warm++;
      if (warm < 200) {
        upd(home, away, hw);
        continue;
      }
      const [hp, ap] = await Promise.all([
        g.teams?.home?.probablePitcher?.id
          ? pitcherThrough(g.teams.home.probablePitcher.id, day.date)
          : null,
        g.teams?.away?.probablePitcher?.id
          ? pitcherThrough(g.teams.away.probablePitcher.id, day.date)
          : null,
      ]);
      const eloP =
        1 / (1 + Math.pow(10, (getElo(away) - (getElo(home) + 24)) / 400));
      out.push([clamp(pitcherProb(hp, ap) * 0.583 + eloP * 0.417), hw ? 1 : 0]);
      upd(home, away, hw);
    }
  }
  return out;
}

/** Gradient descent on log-loss for a and b. */
function fitPlatt(data: Array<[number, number]>) {
  let a = 1,
    b = 0;
  const lr = 0.05;
  for (let iter = 0; iter < 4000; iter++) {
    let ga = 0,
      gb = 0;
    for (const [p, y] of data) {
      const z = a * logit(p) + b;
      const q = sigmoid(z);
      const err = q - y;
      ga += err * logit(p);
      gb += err;
    }
    a -= (lr * ga) / data.length;
    b -= (lr * gb) / data.length;
  }
  return { a, b };
}

const brier = (d: Array<[number, number]>, f: (p: number) => number) =>
  d.reduce((s, [p, y]) => s + (f(p) - y) ** 2, 0) / d.length;

const main = async () => {
  console.log(`collecting fit season ${FIT_SEASON}...`);
  const fit = await collect(FIT_SEASON, MAX_DAYS);
  console.log(`  ${fit.length} games`);
  console.log(`collecting test season ${TEST_SEASON}...`);
  const test = await collect(TEST_SEASON, MAX_DAYS);
  console.log(`  ${test.length} games`);

  const { a, b } = fitPlatt(fit);
  const cal = (p: number) => sigmoid(a * logit(clamp(p)) + b);
  // Slope-only variant: intercept forced to 0 so a coin-flip stays a coin-flip.
  const calNoB = (p: number) => sigmoid(a * logit(clamp(p)));

  console.log(
    `\nfitted on ${FIT_SEASON}:  a=${a.toFixed(4)}  b=${b.toFixed(4)}`,
  );
  console.log(`\nheld-out ${TEST_SEASON}:`);
  console.log(`  raw        Brier ${brier(test, (p) => p).toFixed(4)}`);
  console.log(`  calibrated Brier ${brier(test, cal).toFixed(4)}`);
  const imp = (1 - brier(test, cal) / brier(test, (p) => p)) * 100;
  console.log(`  improvement: ${imp.toFixed(2)}%`);

  // Slope-only. The fitted intercept encodes a directional lean, and a lean
  // the data doesn't support is a systematic error on every single bet — the
  // kind that hides inside an aggregate Brier score. Report both so the cost
  // of dropping it is explicit rather than assumed.
  const impNoB = (1 - brier(test, calNoB) / brier(test, (p) => p)) * 100;
  console.log(`  slope-only (b=0) Brier ${brier(test, calNoB).toFixed(4)}`);
  console.log(`  slope-only improvement: ${impNoB.toFixed(2)}%`);
  console.log(
    `  coin-flip maps to: fitted-b ${(cal(0.5) * 100).toFixed(1)}%  |  slope-only ${(calNoB(0.5) * 100).toFixed(1)}%`,
  );

  console.log(
    `\ncalibration on held-out ${TEST_SEASON} (predicted -> actual):`,
  );
  for (const [label, f] of [
    ["raw", (p: number) => p],
    ["cal", cal],
  ] as const) {
    const buckets = new Map<number, { n: number; w: number }>();
    for (const [p, y] of test) {
      const d = Math.min(9, Math.floor(f(p) * 10));
      const bk = buckets.get(d) ?? { n: 0, w: 0 };
      bk.n++;
      bk.w += y;
      buckets.set(d, bk);
    }
    const parts: string[] = [];
    for (const k of [...buckets.keys()].sort((x, y) => x - y)) {
      const bk = buckets.get(k)!;
      if (bk.n < 25) continue;
      parts.push(
        `${k * 10 + 5}%->${((bk.w / bk.n) * 100).toFixed(0)}%(${bk.n})`,
      );
    }
    console.log(`  ${label}: ${parts.join("  ")}`);
  }
};

main();
