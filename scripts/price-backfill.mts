// Attach real moneylines to the backfilled picks and answer the only question
// that matters: did the model make money, or just pick winners?
//
// The 449 rows in bot_picks carry results but no prices — MLB's free API has
// scores, not odds — so profit_units is null and "55% accuracy" says nothing
// about profitability. A 55% record is hugely profitable at +120 and a
// disaster at -200.
//
// Odds source: shanemcd.org, published free as .xlsx. IMPORTANT CAVEAT that
// changes how much weight this deserves: these are MORNING consensus lines
// (pulled ~6-8am), not true closing lines. Closers typically move toward the
// favorite, so this will read slightly OPTIMISTIC for underdog picks and
// slightly pessimistic for favorites. Treat the ROI as approximate. If the
// edge comes out thin, the morning-vs-closing gap could flip the sign, and
// that's the point at which paying for true closers is worth it.

import fs from "fs";
import { createRequire } from "module";
// xlsx ships CJS; `import * as XLSX` under ESM yields a namespace whose
// members aren't callable. createRequire gets the real module object.
const XLSX = createRequire(import.meta.url)("xlsx");

const SHEET =
  process.argv[2] ??
  "C:\\Users\\User\\AppData\\Local\\Temp\\claude\\C--Users-User-claude-code\\f91f798b-5a6d-4ed2-a165-234131f95ed3\\scratchpad\\mlb2026.xlsx";

// Needs SUPABASE_SERVICE_ROLE_KEY, which lives only in Vercel — not in .env or
// .env.local. Pull it first:  npx vercel env pull .env.vercel --environment=production
const ENV_FILE =
  [".env.vercel", ".env.local", ".env"].find((f) => fs.existsSync(f)) ?? ".env";
const raw = fs.readFileSync(ENV_FILE, "utf8");
function env(name: string): string {
  const line = raw.split(/\r?\n/).find((l) => l.startsWith(name + "="));
  if (!line) return "";
  // Handles both KEY=value and KEY="value" — `vercel env pull` quotes, the
  // hand-written .env files don't. It also embeds a LITERAL backslash-n before
  // the closing quote; leaving it in produced a malformed URL and a key that
  // came back "Invalid API key".
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

// Full club name -> abbreviation. bot_picks stores abbrevs; the sheet stores
// full names.
const ABBREV: Record<string, string> = {};
{
  const r = await fetch("https://statsapi.mlb.com/api/v1/teams?sportId=1");
  for (const t of (await r.json())?.teams ?? [])
    ABBREV[t.name] = t.abbreviation;
}

const wb = XLSX.readFile(SHEET);
// The workbook has an "About" sheet first; the data lives on "Betting Odds".
// Reading SheetNames[0] parsed the 33-row README and matched nothing.
const dataSheet =
  wb.SheetNames.find((n: string) => /betting|odds/i.test(n)) ??
  wb.SheetNames[wb.SheetNames.length - 1];
const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[dataSheet]);
console.log(`reading sheet: ${dataSheet}`);
console.log(`odds sheet: ${rows.length} games`);

// Key on date + both teams. Doubleheaders repeat that key, so keep a LIST and
// take the first unused entry rather than silently pairing game 1's line with
// game 2's result.
const odds = new Map<string, Array<{ away: number; home: number }>>();
for (const r of rows) {
  const d = r["Date"];
  const away = ABBREV[r["Away"]] ?? r["Away"];
  const home = ABBREV[r["Home"]] ?? r["Home"];
  // Moneylines arrive as STRINGS ("-120", "+100"), not numbers.
  const aML = Number(String(r["Away ML"] ?? "").replace("+", ""));
  const hML = Number(String(r["Home ML"] ?? "").replace("+", ""));
  if (!d || !away || !home || !Number.isFinite(aML) || !Number.isFinite(hML))
    continue;
  // Excel dates arrive as serial numbers or strings depending on the cell.
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
console.log(`indexed ${odds.size} unique date+matchup keys`);

const pr = await fetch(
  `${SUPA}/rest/v1/bot_picks?select=*&id=like.backfill-*&order=slate_date`,
  { headers: H },
);
const picks: any[] = await pr.json();
console.log(`backfilled picks: ${picks.length}`);

const used = new Map<string, number>();
let matched = 0,
  unmatched = 0;
let stake = 0,
  profit = 0;
const byBand: Record<
  string,
  { n: number; w: number; stake: number; profit: number }
> = {};

const toDec = (o: number) => (o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o));

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
  const ml = pickedTeam === home ? entry.home : entry.away;
  if (!Number.isFinite(ml)) {
    unmatched++;
    continue;
  }

  matched++;
  const unit = 1;
  stake += unit;
  const won = p.result === "win";
  const pl = won ? unit * (toDec(ml) - 1) : -unit;
  profit += pl;

  const band = p.confidence ?? "LOW";
  byBand[band] ??= { n: 0, w: 0, stake: 0, profit: 0 };
  byBand[band].n++;
  if (won) byBand[band].w++;
  byBand[band].stake += unit;
  byBand[band].profit += pl;
}

console.log(`\nmatched ${matched} picks to odds (${unmatched} unmatched)`);
console.log(
  `\nOVERALL: ${profit >= 0 ? "+" : ""}${profit.toFixed(2)}u on ${stake}u staked  =  ROI ${((profit / stake) * 100).toFixed(2)}%`,
);
console.log("\nby confidence band:");
for (const [band, b] of Object.entries(byBand)) {
  const roi = (b.profit / b.stake) * 100;
  console.log(
    `  ${band.padEnd(7)} ${String(b.n).padStart(4)} picks  ${((b.w / b.n) * 100).toFixed(1)}%  ${b.profit >= 0 ? "+" : ""}${b.profit.toFixed(2)}u  ROI ${roi >= 0 ? "+" : ""}${roi.toFixed(2)}%`,
  );
}
console.log(
  "\nNOTE: morning consensus lines, not true closers. Closers move toward the",
);
console.log("favorite, so underdog ROI here reads slightly optimistic.");
