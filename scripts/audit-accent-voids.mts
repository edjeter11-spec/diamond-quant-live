// Audit historical `void` grades for the accent-matching bug.
//
// Before lib/mlb/prop-grader.ts learned to strip diacritics, a pick on a
// player whose box-score name carries an accent ("Jeremy Peña") never matched
// the plain-ASCII name stored on the pick ("Jeremy Pena") — findPlayer
// returned null, and post-results' void-on-absent-player fallback marked it
// `void` (stake returned, excluded from the record) even though the player
// had actually played and the pick had a real win/loss outcome.
//
// That silently corrupted the published record: real losses (and real wins)
// vanished into "void" instead of counting. This script finds every voided
// pick and re-checks it against the real box score with accent-insensitive
// matching, so we know exactly how many are wrong before deciding to re-grade.
//
// READ-ONLY. Writes nothing — run scripts/regrade-accent-voids.mts to fix.

import fs from "fs";

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

const MLB_API = "https://statsapi.mlb.com/api/v1";

function stripAccents(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

/** Same stat map post-results grades against. */
const MARKET_STAT: Record<string, string> = {
  batter_hits: "hits",
  batter_total_bases: "totalBases",
  batter_rbis: "rbi",
  batter_runs_scored: "runs",
  batter_home_runs: "homeRuns",
  batter_stolen_bases: "stolenBases",
  pitcher_strikeouts: "strikeOuts",
  pitcher_outs: "outs",
};

async function j(url: string): Promise<any> {
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

// Scope check first: how much graded history exists, and how much of it
// involves accented names at all (the accent bug can only have touched those).
{
  const all: any[] = await (
    await fetch(
      `${SUPA}/rest/v1/manual_picks?select=player_name,result&sport=eq.mlb&market=eq.player_prop&result=not.is.null`,
      { headers: H },
    )
  ).json();
  if (Array.isArray(all)) {
    const byResult: Record<string, number> = {};
    for (const r of all) byResult[r.result] = (byResult[r.result] ?? 0) + 1;
    const accented = all.filter(
      (r) => r.player_name && stripAccents(r.player_name) !== r.player_name,
    );
    console.log(`Graded MLB player props on record: ${all.length}`);
    console.log(`  by result: ${JSON.stringify(byResult)}`);
    console.log(
      `  rows whose stored name carries an accent: ${accented.length}`,
    );
    console.log(
      `  (the accent bug could only ever have affected rows where the BOX\n` +
        `   SCORE name is accented — stored names here are plain ASCII, so\n` +
        `   the mismatch shows up as a void, which is what we re-check below)\n`,
    );
  }
}

// Fetch every voided MLB player-prop pick.
const voided: any[] = await (
  await fetch(
    `${SUPA}/rest/v1/manual_picks?select=id,slate_date,player_name,market_key,line,side,odds,units,pick_text,result&sport=eq.mlb&result=eq.void&market=eq.player_prop&order=slate_date.asc`,
    { headers: H },
  )
).json();

if (!Array.isArray(voided)) {
  console.error("query failed:", JSON.stringify(voided).slice(0, 300));
  process.exit(1);
}

console.log(`Voided MLB player-prop picks to re-check: ${voided.length}\n`);
if (voided.length === 0) process.exit(0);

// Group by slate so we fetch each day's box scores once.
const bySlate = new Map<string, any[]>();
for (const p of voided) {
  if (!bySlate.has(p.slate_date)) bySlate.set(p.slate_date, []);
  bySlate.get(p.slate_date)!.push(p);
}

type Finding = {
  id: string;
  slate: string;
  pick: string;
  actual: number;
  shouldBe: "win" | "loss" | "push";
  profitUnits: number;
};
const wrong: Finding[] = [];
let confirmedVoid = 0;
let unresolved = 0;

const americanToDecimal = (o: number) =>
  o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o);

for (const [slate, picks] of bySlate) {
  let lines: Array<{ name: string; batting: any; pitching: any }> = [];
  try {
    const sched = await j(`${MLB_API}/schedule?sportId=1&date=${slate}`);
    const games = (sched?.dates?.[0]?.games ?? []).filter(
      (g: any) => g?.status?.abstractGameState === "Final",
    );
    for (const g of games) {
      const box = await j(`${MLB_API}/game/${g.gamePk}/boxscore`);
      for (const side of ["home", "away"] as const) {
        const players = box?.teams?.[side]?.players ?? {};
        for (const k of Object.keys(players)) {
          const pl = players[k];
          if (!pl?.person?.fullName) continue;
          lines.push({
            name: pl.person.fullName,
            batting: pl?.stats?.batting,
            pitching: pl?.stats?.pitching,
          });
        }
      }
    }
  } catch (e) {
    console.log(`  ${slate}: box-score fetch failed, skipping`);
    unresolved += picks.length;
    continue;
  }

  for (const p of picks) {
    const target = stripAccents(String(p.player_name ?? "")).toLowerCase();
    const hit = lines.find(
      (l) => stripAccents(l.name).toLowerCase() === target,
    );
    if (!hit) {
      // Genuinely absent — the void was correct (real scratch/DNP).
      confirmedVoid++;
      continue;
    }
    const statKey = MARKET_STAT[p.market_key];
    const stats = p.market_key?.startsWith("pitcher_")
      ? hit.pitching
      : hit.batting;
    const actual = Number(stats?.[statKey]);
    if (!Number.isFinite(actual)) {
      unresolved++;
      continue;
    }
    const line = Number(p.line);
    const over = actual > line;
    const shouldBe =
      actual === line ? "push" : (p.side === "over") === over ? "win" : "loss";
    const stake = Number(p.units ?? 1);
    const profitUnits =
      shouldBe === "push"
        ? 0
        : shouldBe === "win"
          ? Math.round(
              stake * (americanToDecimal(Number(p.odds ?? -110)) - 1) * 100,
            ) / 100
          : -stake;
    wrong.push({
      id: p.id,
      slate,
      pick: p.pick_text,
      actual,
      shouldBe,
      profitUnits,
    });
  }
}

console.log(`Correctly voided (player genuinely absent): ${confirmedVoid}`);
console.log(`Could not resolve (no box score / no stat):  ${unresolved}`);
console.log(`WRONGLY voided — player DID play:            ${wrong.length}\n`);

if (wrong.length) {
  const wins = wrong.filter((w) => w.shouldBe === "win").length;
  const losses = wrong.filter((w) => w.shouldBe === "loss").length;
  const pushes = wrong.filter((w) => w.shouldBe === "push").length;
  const netUnits = wrong.reduce((a, w) => a + w.profitUnits, 0);
  console.log(
    `Record hidden by the bug: ${wins}W-${losses}L-${pushes}P, ` +
      `net ${netUnits >= 0 ? "+" : ""}${netUnits.toFixed(2)}u\n`,
  );
  for (const w of wrong)
    console.log(
      `  ${w.slate}  ${w.pick}  → actual ${w.actual} = ${w.shouldBe.toUpperCase()} (${w.profitUnits >= 0 ? "+" : ""}${w.profitUnits}u)`,
    );
  fs.writeFileSync(
    "scripts/.accent-void-findings.json",
    JSON.stringify(wrong, null, 1),
  );
  console.log(
    `\nWrote ${wrong.length} findings to scripts/.accent-void-findings.json`,
  );
}
