// Measure-first: does bullpen fatigue carry predictive signal for ML outcomes
// BEYOND the market? Uses the 449 backfilled picks in Supabase, real moneylines
// from the odds xlsx, and reliever pitch counts from MLB StatsAPI.
//
// Nothing gets wired into the model unless this measurement says it's worth it
// (the park-factor signal measured +0.075% and was rightly skipped).
//
// fatigue(team, date) = sum of reliever pitches on D-1, D-2, D-3.
// Starter identified by stats.pitching.gamesStarted === 1 (verified: also the
// first entry of teams[side].pitchers, but gamesStarted is robust to openers).

import fs from "fs";
import path from "path";
import { createRequire } from "module";
const XLSX = createRequire(import.meta.url)("xlsx");

const SCRATCH =
  "C:\\Users\\User\\AppData\\Local\\Temp\\claude\\C--Users-User-claude-code\\f91f798b-5a6d-4ed2-a165-234131f95ed3\\scratchpad";
const SHEETS = [`${SCRATCH}\\mlb2026.xlsx`, `${SCRATCH}\\mlb2025.xlsx`];
const CACHE_DIR = path.join(SCRATCH, "bullpen-cache");
fs.mkdirSync(CACHE_DIR, { recursive: true });

const ENV_FILE =
  [".env.vercel", ".env.local", ".env"].find((f) => fs.existsSync(f)) ?? ".env";
const rawEnv = fs.readFileSync(ENV_FILE, "utf8");
function env(name: string): string {
  const line = rawEnv.split(/\r?\n/).find((l) => l.startsWith(name + "="));
  if (!line) return "";
  return line
    .slice(name.length + 1)
    .trim()
    .replace(/^"(.*)"$/s, "$1")
    .split("\\n")
    .join("")
    .trim();
}
const SUPA = env("NEXT_PUBLIC_SUPABASE_URL");
const KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const H = { apikey: KEY, Authorization: "Bearer " + KEY };

// team name → abbrev, and team id → abbrev
const ABBREV: Record<string, string> = {};
const ID2AB: Record<number, string> = {};
{
  const r = await fetch("https://statsapi.mlb.com/api/v1/teams?sportId=1");
  for (const t of (await r.json())?.teams ?? []) {
    ABBREV[t.name] = t.abbreviation;
    ID2AB[t.id] = t.abbreviation;
  }
}

// ── odds from xlsx ──
const odds = new Map<string, Array<{ away: number; home: number }>>();
for (const file of SHEETS) {
  if (!fs.existsSync(file)) continue;
  const wb = XLSX.readFile(file);
  const sheet =
    wb.SheetNames.find((n: string) => /betting|odds/i.test(n)) ??
    wb.SheetNames[wb.SheetNames.length - 1];
  for (const r of XLSX.utils.sheet_to_json(wb.Sheets[sheet]) as any[]) {
    const d = r["Date"];
    const away = ABBREV[r["Away"]] ?? r["Away"];
    const home = ABBREV[r["Home"]] ?? r["Home"];
    const aML = Number(String(r["Away ML"] ?? "").replace("+", ""));
    const hML = Number(String(r["Home ML"] ?? "").replace("+", ""));
    if (!d || !Number.isFinite(aML) || !Number.isFinite(hML)) continue;
    const iso =
      typeof d === "number"
        ? new Date(Math.round((d - 25569) * 86400 * 1000))
            .toISOString()
            .slice(0, 10)
        : String(d).slice(0, 10);
    const key = `${iso}|${away}|${home}`;
    if (!odds.has(key)) odds.set(key, []);
    odds.get(key)!.push({ away: aML, home: hML });
  }
}

// ── picks ──
const pr = await fetch(
  `${SUPA}/rest/v1/bot_picks?select=*&id=like.backfill-*&order=slate_date`,
  { headers: H },
);
const picks: any[] = await pr.json();
console.log(`picks loaded: ${picks.length}`);

const dates = picks.map((p) => String(p.slate_date)).sort();
const minDate = dates[0];
const maxDate = dates[dates.length - 1];

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ── bullpen table: date → abbrev → reliever pitches that day ──
const startDate = addDays(minDate, -3);
const allDates: string[] = [];
for (let d = startDate; d <= maxDate; d = addDays(d, 1)) allDates.push(d);
console.log(
  `building reliever pitch table ${startDate} → ${maxDate} (${allDates.length} dates)`,
);

async function fetchJson(url: string, tries = 4): Promise<any> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch {}
    await new Promise((res) => setTimeout(res, 1000 * (i + 1)));
  }
  throw new Error("failed: " + url);
}

async function buildDate(date: string): Promise<Record<string, number>> {
  const cacheFile = path.join(CACHE_DIR, date + ".json");
  if (fs.existsSync(cacheFile))
    return JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  const sched = await fetchJson(
    `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}`,
  );
  const games = (sched?.dates?.[0]?.games ?? []).filter(
    (g: any) => g.status?.abstractGameState === "Final",
  );
  const out: Record<string, number> = {};
  const CONC = 5;
  for (let i = 0; i < games.length; i += CONC) {
    const batch = games.slice(i, i + CONC);
    const boxes = await Promise.all(
      batch.map((g: any) =>
        fetchJson(
          `https://statsapi.mlb.com/api/v1/game/${g.gamePk}/boxscore`,
        ).catch(() => null),
      ),
    );
    for (const box of boxes) {
      if (!box) continue;
      for (const side of ["away", "home"] as const) {
        const t = box.teams?.[side];
        if (!t) continue;
        const ab = ID2AB[t.team?.id];
        if (!ab) continue;
        const pitchers: number[] = t.pitchers ?? [];
        let relief = 0;
        let starterSeen = false;
        for (let j = 0; j < pitchers.length; j++) {
          const pl = t.players?.["ID" + pitchers[j]];
          const st = pl?.stats?.pitching;
          if (!st) continue;
          const isStarter = !starterSeen && (st.gamesStarted === 1 || j === 0);
          if (isStarter) {
            starterSeen = true;
            continue;
          }
          relief += Number(st.numberOfPitches ?? st.pitchesThrown ?? 0);
        }
        out[ab] = (out[ab] ?? 0) + relief; // += handles doubleheaders
      }
    }
  }
  fs.writeFileSync(cacheFile, JSON.stringify(out));
  return out;
}

const penByDate = new Map<string, Record<string, number>>();
let done = 0;
for (const d of allDates) {
  penByDate.set(d, await buildDate(d));
  done++;
  if (done % 20 === 0) console.log(`  ${done}/${allDates.length} dates`);
}

function fatigue(team: string, date: string): number {
  let s = 0;
  for (let k = 1; k <= 3; k++)
    s += penByDate.get(addDays(date, -k))?.[team] ?? 0;
  return s;
}

// ── join picks + odds + fatigue ──
const toDec = (o: number) => (o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o));
const impl = (o: number) => 1 / toDec(o);
const logit = (p: number) => Math.log(p / (1 - p));
const sigm = (x: number) => 1 / (1 + Math.exp(-x));

type Row = {
  mkt: number;
  y: number;
  ml: number;
  fatDiff: number;
  oppFat: number;
};
const rows: Row[] = [];
const used = new Map<string, number>();
for (const p of picks) {
  const [away, home] = String(p.game).split(" @ ");
  const key = `${p.slate_date}|${away}|${home}`;
  const list = odds.get(key);
  if (!list?.length) continue;
  const idx = used.get(key) ?? 0;
  const entry = list[Math.min(idx, list.length - 1)];
  used.set(key, idx + 1);
  const pickedHome = String(p.pick).replace(" ML", "").trim() === home;
  const ml = pickedHome ? entry.home : entry.away;
  const other = pickedHome ? entry.away : entry.home;
  if (!Number.isFinite(ml) || !Number.isFinite(other)) continue;
  if (p.result !== "win" && p.result !== "loss") continue;
  const s = impl(ml) + impl(other);
  const picked = pickedHome ? home : away;
  const opp = pickedHome ? away : home;
  const f1 = fatigue(picked, p.slate_date);
  const f2 = fatigue(opp, p.slate_date);
  rows.push({
    mkt: impl(ml) / s,
    y: p.result === "win" ? 1 : 0,
    ml,
    fatDiff: f2 - f1,
    oppFat: f2,
  });
}
console.log(`\nmatched rows: ${rows.length}`);

function brier(f: (r: Row) => number): number {
  return rows.reduce((a, r) => a + (f(r) - r.y) ** 2, 0) / rows.length;
}

// ── logistic: y ~ b0 + b1*logit(mkt) + b2*x ──
function fitLogit(getX: (r: Row) => number): [number, number, number] {
  let b0 = 0,
    b1 = 1,
    b2 = 0;
  const lr = 0.5;
  for (let it = 0; it < 20000; it++) {
    let g0 = 0,
      g1 = 0,
      g2 = 0;
    for (const r of rows) {
      const xm = logit(r.mkt);
      const x = getX(r);
      const e = sigm(b0 + b1 * xm + b2 * x) - r.y;
      g0 += e;
      g1 += e * xm;
      g2 += e * x;
    }
    b0 -= (lr * g0) / rows.length;
    b1 -= (lr * g1) / rows.length;
    b2 -= (lr * g2) / rows.length;
  }
  return [b0, b1, b2];
}

// baseline: market-only (recalibrated)
{
  let a0 = 0,
    a1 = 1;
  const lr = 0.5;
  for (let it = 0; it < 20000; it++) {
    let g0 = 0,
      g1 = 0;
    for (const r of rows) {
      const xm = logit(r.mkt);
      const e = sigm(a0 + a1 * xm) - r.y;
      g0 += e;
      g1 += e * xm;
    }
    a0 -= (lr * g0) / rows.length;
    a1 -= (lr * g1) / rows.length;
  }
  console.log(`\n── logistic regression (in-sample, n=${rows.length}) ──`);
  console.log(`brier market raw:            ${brier((r) => r.mkt).toFixed(5)}`);
  const bMktFit = brier((r) => sigm(a0 + a1 * logit(r.mkt)));
  console.log(
    `brier market-only fit:       ${bMktFit.toFixed(5)}  (a0=${a0.toFixed(4)} a1=${a1.toFixed(4)})`,
  );

  const [b0, b1, b2] = fitLogit((r) => r.fatDiff / 100);
  const bFat = brier((r) =>
    sigm(b0 + b1 * logit(r.mkt) + (b2 * r.fatDiff) / 100),
  );
  console.log(
    `brier market+fatigueDiff:    ${bFat.toFixed(5)}  (b0=${b0.toFixed(4)} b1=${b1.toFixed(4)} b2=${b2.toFixed(4)} per 100 pitches)`,
  );
  console.log(
    `  Brier delta (fatigueDiff): ${(bMktFit - bFat >= 0 ? "+" : "") + (bMktFit - bFat).toFixed(6)} (positive = fatigue helps)`,
  );

  const [c0, c1, c2] = fitLogit((r) => r.oppFat / 100);
  const bOpp = brier((r) =>
    sigm(c0 + c1 * logit(r.mkt) + (c2 * r.oppFat) / 100),
  );
  console.log(
    `brier market+oppFatigue:     ${bOpp.toFixed(5)}  (c0=${c0.toFixed(4)} c1=${c1.toFixed(4)} c2=${c2.toFixed(4)} per 100 pitches)`,
  );
  console.log(
    `  Brier delta (oppFatigue):  ${(bMktFit - bOpp >= 0 ? "+" : "") + (bMktFit - bOpp).toFixed(6)}`,
  );
}

// ── tercile buckets ──
function terciles(name: string, getX: (r: Row) => number) {
  const sorted = [...rows].sort((a, b) => getX(a) - getX(b));
  const n = sorted.length;
  const cuts = [Math.floor(n / 3), Math.floor((2 * n) / 3), n];
  console.log(`\n── terciles by ${name} (flat 1u at real ML) ──`);
  let lo = 0;
  const labels = ["low ", "mid ", "high"];
  for (let i = 0; i < 3; i++) {
    const bucket = sorted.slice(lo, cuts[i]);
    lo = cuts[i];
    const wins = bucket.filter((r) => r.y === 1).length;
    const profit = bucket.reduce(
      (a, r) => a + (r.y === 1 ? toDec(r.ml) - 1 : -1),
      0,
    );
    const xs = bucket.map(getX);
    console.log(
      `  ${labels[i]} [${Math.min(...xs)}..${Math.max(...xs)}]  n=${bucket.length}  win%=${((100 * wins) / bucket.length).toFixed(1)}  ROI=${((100 * profit) / bucket.length).toFixed(2)}%  avgMkt=${(bucket.reduce((a, r) => a + r.mkt, 0) / bucket.length).toFixed(3)}`,
    );
  }
}
terciles("fatigueDiff (opp − picked)", (r) => r.fatDiff);
terciles("raw OPPONENT fatigue", (r) => r.oppFat);

console.log(
  `\nVERDICT: see Brier deltas and tercile monotonicity above. n=${rows.length}, in-sample only.`,
);
