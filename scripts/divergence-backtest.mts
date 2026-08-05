// DIVERGENCE BACKTEST — where does the model DISAGREE with the market, and is
// that disagreement worth money?
//
// Context for why this exists. The straight backtest (price-backfill.mts) said:
//   434 picks, -33.39u, ROI -7.69%
//   HIGH band: 158 picks, 62.0% accuracy, ROI -1.09%
//
// The HIGH band hits 62% and STILL loses. Those are games where the model
// agrees with the market — heavy favorites around -180, where you need ~64%
// just to break even. Accuracy climbing with "edge" wasn't evidence of a
// beatable edge; it was evidence the model is confident exactly where the
// market is confident. A well-calibrated model with no independent information
// looks exactly like that.
//
// So the question flips. An edge cannot live where model and market agree —
// by definition there's no price advantage there. It can only live where they
// DISAGREE. This script measures that directly:
//
//   modelProb  = the model's win probability for the side it picked
//   marketProb = the no-vig probability implied by the real moneyline
//   divergence = modelProb - marketProb
//
// Positive divergence = model likes the side MORE than the market does = the
// side is (per the model) underpriced. That is the only place +EV can come
// from. This buckets by divergence and reports ROI per bucket.
//
// Two honest guards against fooling ourselves, both of which matter more than
// the headline number:
//
//  1. The de-vig. Removing vig proportionally across both sides is the
//     standard approach but it's known to overstate favorites' true
//     probability. Both a proportional and a multiplicative/power de-vig are
//     computed so we can see whether any finding survives the choice of
//     method. A result that only appears under one de-vig is a method
//     artifact, not an edge.
//
//  2. Multiple comparisons. Slicing 434 picks into buckets and reporting the
//     best one is how noise gets published as a strategy. With this few bets,
//     SOME bucket will look profitable by chance. Each bucket therefore gets a
//     standard error, and the report states plainly whether the best bucket is
//     distinguishable from luck.
//
// Same caveat as the price backfill: these are MORNING consensus lines, not
// closers. Closers move toward favorites. Divergence measured against a
// morning line is not divergence against the closer, and betting into a line
// that later moves your way is the good case — so a positive result here is
// weaker evidence than it looks.

import fs from "fs";
import { createRequire } from "module";
const XLSX = createRequire(import.meta.url)("xlsx");

const SCRATCH =
  "C:\\Users\\User\\AppData\\Local\\Temp\\claude\\C--Users-User-claude-code\\f91f798b-5a6d-4ed2-a165-234131f95ed3\\scratchpad";
const SHEETS = [`${SCRATCH}\\mlb2026.xlsx`, `${SCRATCH}\\mlb2025.xlsx`];

const ENV_FILE =
  [".env.vercel", ".env.local", ".env"].find((f) => fs.existsSync(f)) ?? ".env";
const raw = fs.readFileSync(ENV_FILE, "utf8");
function env(name: string): string {
  const line = raw.split(/\r?\n/).find((l) => l.startsWith(name + "="));
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

const ABBREV: Record<string, string> = {};
{
  const r = await fetch("https://statsapi.mlb.com/api/v1/teams?sportId=1");
  for (const t of (await r.json())?.teams ?? [])
    ABBREV[t.name] = t.abbreviation;
}

// ── odds index ──
const odds = new Map<string, Array<{ away: number; home: number }>>();
for (const file of SHEETS) {
  if (!fs.existsSync(file)) continue;
  const wb = XLSX.readFile(file);
  const sheet =
    wb.SheetNames.find((n: string) => /betting|odds/i.test(n)) ??
    wb.SheetNames[wb.SheetNames.length - 1];
  const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[sheet]);
  for (const r of rows) {
    const d = r["Date"];
    const away = ABBREV[r["Away"]] ?? r["Away"];
    const home = ABBREV[r["Home"]] ?? r["Home"];
    const aML = Number(String(r["Away ML"] ?? "").replace("+", ""));
    const hML = Number(String(r["Home ML"] ?? "").replace("+", ""));
    if (!d || !away || !home || !Number.isFinite(aML) || !Number.isFinite(hML))
      continue;
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
console.log(`indexed ${odds.size} game keys from ${SHEETS.length} sheet(s)`);

const pr = await fetch(
  `${SUPA}/rest/v1/bot_picks?select=*&id=like.backfill-*&order=slate_date`,
  { headers: H },
);
const picks: any[] = await pr.json();
if (!Array.isArray(picks)) {
  console.error("query failed:", JSON.stringify(picks).slice(0, 300));
  process.exit(1);
}
console.log(`backfilled picks: ${picks.length}`);
console.log(`columns: ${Object.keys(picks[0] ?? {}).join(", ")}\n`);

// ── probability helpers ──
const toDec = (o: number) => (o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o));
const impliedRaw = (o: number) => 1 / toDec(o);

/** Proportional de-vig: scale both sides so they sum to 1. Standard, but
 *  known to overstate favorites. */
function devigProportional(a: number, b: number): [number, number] {
  const ra = impliedRaw(a),
    rb = impliedRaw(b);
  const s = ra + rb;
  return [ra / s, rb / s];
}

/** Power/multiplicative de-vig: solve for k where ra^k + rb^k = 1. Distributes
 *  vig less evenly and is generally kinder to underdogs. If a finding only
 *  survives one of these two methods, it's a de-vig artifact. */
function devigPower(a: number, b: number): [number, number] {
  const ra = impliedRaw(a),
    rb = impliedRaw(b);
  let lo = 0.5,
    hi = 2.0;
  for (let i = 0; i < 60; i++) {
    const k = (lo + hi) / 2;
    if (Math.pow(ra, k) + Math.pow(rb, k) > 1) lo = k;
    else hi = k;
  }
  const k = (lo + hi) / 2;
  return [Math.pow(ra, k), Math.pow(rb, k)];
}

type Row = {
  date: string;
  pick: string;
  ml: number;
  won: boolean;
  modelProb: number;
  mktProp: number;
  mktPow: number;
  conf: string;
};

const rows: Row[] = [];
const used = new Map<string, number>();
let unmatched = 0,
  noProb = 0;

for (const p of picks) {
  const [away, home] = String(p.game).split(" @ ");
  const key = `${p.slate_date}|${away}|${home}`;
  const list = odds.get(key);
  if (!list?.length) {
    unmatched++;
    continue;
  }
  const idx = used.get(key) ?? 0;
  const entry = list[Math.min(idx, list.length - 1)];
  used.set(key, idx + 1);

  const pickedTeam = String(p.pick).replace(" ML", "").trim();
  const pickedHome = pickedTeam === home;
  const ml = pickedHome ? entry.home : entry.away;
  const other = pickedHome ? entry.away : entry.home;
  if (!Number.isFinite(ml) || !Number.isFinite(other)) {
    unmatched++;
    continue;
  }

  // The model's probability for the side it actually picked. Column name
  // varies by how the backfill wrote it, so probe the likely candidates
  // rather than assuming one.
  const rawProb =
    p.model_prob ?? p.win_probability ?? p.probability ?? p.fair_prob ?? null;
  if (rawProb == null) {
    noProb++;
    continue;
  }
  let modelProb = Number(rawProb);
  if (modelProb > 1) modelProb /= 100; // stored as percentage

  const [mp, op] = devigProportional(ml, other);
  const [mpp] = devigPower(ml, other);
  void op;

  rows.push({
    date: p.slate_date,
    pick: pickedTeam,
    ml,
    won: p.result === "win",
    modelProb,
    mktProp: mp,
    mktPow: mpp,
    conf: p.confidence ?? "LOW",
  });
}

console.log(
  `usable: ${rows.length}  (unmatched odds: ${unmatched}, missing model prob: ${noProb})`,
);
if (!rows.length) {
  console.error(
    "\nNo rows carried a model probability. Available columns above —",
  );
  console.error("the backfill may not have persisted the model's prob.");
  process.exit(1);
}

/** Report ROI for a set of bets, with the standard error that says whether
 *  the number means anything. */
function summarize(label: string, set: Row[]) {
  if (!set.length) {
    console.log(`  ${label.padEnd(22)}    0 bets`);
    return;
  }
  const pls = set.map((r) => (r.won ? toDec(r.ml) - 1 : -1));
  const profit = pls.reduce((a, b) => a + b, 0);
  const roi = (profit / set.length) * 100;
  const wins = set.filter((r) => r.won).length;
  // SE of mean P/L per bet -> SE of ROI in percentage points.
  const mean = profit / set.length;
  const variance =
    set.length > 1
      ? pls.reduce((a, x) => a + (x - mean) ** 2, 0) / (set.length - 1)
      : 0;
  const se = (Math.sqrt(variance / set.length) * 100) as number;
  const t = se > 0 ? roi / se : 0;
  console.log(
    `  ${label.padEnd(22)} ${String(set.length).padStart(4)} bets  ` +
      `${((wins / set.length) * 100).toFixed(1)}%  ` +
      `${profit >= 0 ? "+" : ""}${profit.toFixed(2)}u  ` +
      `ROI ${roi >= 0 ? "+" : ""}${roi.toFixed(2)}%  ` +
      `±${se.toFixed(2)}  t=${t.toFixed(2)}`,
  );
}

// ── the core question: bucket by divergence ──
for (const method of ["proportional", "power"] as const) {
  const mkt = (r: Row) => (method === "proportional" ? r.mktProp : r.mktPow);
  console.log(`\n═══ DIVERGENCE BUCKETS — ${method} de-vig ═══`);
  console.log(
    "  (divergence = model prob − market prob; positive = model likes it more)",
  );
  const buckets: Array<[string, (d: number) => boolean]> = [
    ["< -10pts", (d) => d < -0.1],
    ["-10 to -5", (d) => d >= -0.1 && d < -0.05],
    ["-5 to 0", (d) => d >= -0.05 && d < 0],
    ["0 to +5", (d) => d >= 0 && d < 0.05],
    ["+5 to +10", (d) => d >= 0.05 && d < 0.1],
    ["+10 and up", (d) => d >= 0.1],
  ];
  for (const [label, test] of buckets)
    summarize(
      label,
      rows.filter((r) => test(r.modelProb - mkt(r))),
    );

  console.log(`  ── cumulative: bet only when divergence ≥ threshold ──`);
  for (const th of [0, 0.02, 0.04, 0.06, 0.08, 0.1])
    summarize(
      `≥ +${(th * 100).toFixed(0)}pts`,
      rows.filter((r) => r.modelProb - mkt(r) >= th),
    );
}

// ── is the model's probability even calibrated? ──
// If the model says 60% and those bets win 60%, the probabilities are usable
// as a betting signal. If it says 60% and they win 52%, no divergence rule
// built on those numbers can work, and that's the real finding.
console.log(`\n═══ CALIBRATION — does the model's stated prob hold up? ═══`);
for (const [lo, hi] of [
  [0, 0.45],
  [0.45, 0.5],
  [0.5, 0.55],
  [0.55, 0.6],
  [0.6, 0.65],
  [0.65, 1],
] as Array<[number, number]>) {
  const set = rows.filter((r) => r.modelProb >= lo && r.modelProb < hi);
  if (!set.length) continue;
  const actual = (set.filter((r) => r.won).length / set.length) * 100;
  const stated = (set.reduce((a, r) => a + r.modelProb, 0) / set.length) * 100;
  const mkt = (set.reduce((a, r) => a + r.mktProp, 0) / set.length) * 100;
  console.log(
    `  model ${(lo * 100).toFixed(0)}-${(hi * 100).toFixed(0)}%: ` +
      `${String(set.length).padStart(4)} bets  ` +
      `model says ${stated.toFixed(1)}%  market says ${mkt.toFixed(1)}%  ` +
      `ACTUAL ${actual.toFixed(1)}%`,
  );
}

// ── underdogs vs favorites, since the HIGH band was favorite-heavy ──
console.log(`\n═══ BY PRICE ═══`);
summarize(
  "favorites (ML<-140)",
  rows.filter((r) => r.ml < -140),
);
summarize(
  "moderate (-140..+100)",
  rows.filter((r) => r.ml >= -140 && r.ml < 100),
);
summarize(
  "underdogs (+100+)",
  rows.filter((r) => r.ml >= 100),
);

console.log(`\n═══ BASELINE (all bets, for reference) ═══`);
summarize("all", rows);

console.log(
  `\nNOTE: morning consensus lines, not closers. Betting into a line that` +
    `\nlater moves toward you is the FAVORABLE case, so positive divergence` +
    `\nresults here are weaker evidence than they appear.`,
);
console.log(
  `t is the ROI divided by its standard error. |t| under ~2 means the bucket` +
    `\nis not distinguishable from luck — and with ${
      2 * 6 + 12
    } buckets reported, expect` +
    `\none or two to clear that bar by chance alone.`,
);
