// Refit the moneyline calibration on the 434 priced backfill rows.
//
// The divergence backtest showed the model runs 6-13 points hot in every band
// (says 62.4%, reality 49.6%). CAL_A=2.7548 was fit on an earlier sample and
// is clearly too steep now. This fits Platt scaling (logistic regression of
// outcome on logit(rawProb)) by simple gradient descent — 434 rows, no
// dependency needed.
//
// Also fits a market-blend: p = w*model + (1-w)*market, scanning w. If the
// best w is near 0, the model's residual (after market) carries no signal and
// the honest move is to lean almost entirely on the market and hunt edge
// elsewhere (sharp-anchor, lineup timing, bullpen).

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

const pr = await fetch(
  `${SUPA}/rest/v1/bot_picks?select=*&id=like.backfill-*&order=slate_date`,
  { headers: H },
);
const picks: any[] = await pr.json();

const toDec = (o: number) => (o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o));
const impl = (o: number) => 1 / toDec(o);
const logit = (p: number) => Math.log(p / (1 - p));
const sigm = (x: number) => 1 / (1 + Math.exp(-x));

type Row = { p: number; mkt: number; y: number };
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
  const s = impl(ml) + impl(other);
  let mp = Number(p.model_prob);
  if (mp > 1) mp /= 100;
  mp = Math.min(0.99, Math.max(0.01, mp));
  rows.push({ p: mp, mkt: impl(ml) / s, y: p.result === "win" ? 1 : 0 });
}
console.log(`fit rows: ${rows.length}`);

function brier(f: (r: Row) => number): number {
  return rows.reduce((a, r) => a + (f(r) - r.y) ** 2, 0) / rows.length;
}

// ── Platt fit on the model's prob alone ──
// The model's prob was already produced through calibrate() with CAL_A=2.7548,
// so what we fit here is a CORRECTION on top of the stored prob. To get the
// new end-to-end constant we compose: stored = sigmoid(2.7548 * logit(raw)),
// so logit(stored) = 2.7548 * logit(raw), and a correction slope `a` on
// logit(stored) means the composed slope is a * 2.7548.
let a = 1,
  b = 0;
const lr = 0.5;
for (let it = 0; it < 5000; it++) {
  let ga = 0,
    gb = 0;
  for (const r of rows) {
    const x = logit(r.p);
    const e = sigm(a * x + b) - r.y;
    ga += e * x;
    gb += e;
  }
  a -= (lr * ga) / rows.length;
  b -= (lr * gb) / rows.length;
}
console.log(
  `\nPlatt correction on stored prob: a=${a.toFixed(4)} b=${b.toFixed(4)}`,
);
console.log(`composed CAL_A (a × 2.7548) = ${(a * 2.7548).toFixed(4)}`);
console.log(`brier stored:    ${brier((r) => r.p).toFixed(5)}`);
console.log(
  `brier refit:     ${brier((r) => sigm(a * logit(r.p) + b)).toFixed(5)}`,
);
console.log(`brier market:    ${brier((r) => r.mkt).toFixed(5)}`);
console.log(`brier coin(0.5): ${brier(() => 0.5).toFixed(5)}`);

// ── market blend scan: p = w*refit + (1-w)*market ──
console.log(`\nblend scan (w = weight on refit model):`);
let bestW = 0,
  bestB = Infinity;
for (let w = 0; w <= 1.0001; w += 0.05) {
  const bs = brier((r) => w * sigm(a * logit(r.p) + b) + (1 - w) * r.mkt);
  if (bs < bestB) {
    bestB = bs;
    bestW = w;
  }
  console.log(`  w=${w.toFixed(2)}  brier=${bs.toFixed(5)}`);
}
console.log(`\nbest w=${bestW.toFixed(2)} (brier ${bestB.toFixed(5)})`);
console.log(
  `interpretation: w near 0 = model adds nothing beyond the market;` +
    `\nw meaningfully above 0 = the model carries real residual signal.`,
);
