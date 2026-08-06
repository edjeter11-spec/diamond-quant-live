// Independently re-derive every graded MLB pick from the real box score and
// flag any that disagree with what's stored.
//
// This exists because two separate bugs in one day wrote WRONG results into
// the published record:
//   1. An accent mismatch ("Jeremy Peña" vs "Jeremy Pena") made the grader
//      think a player never played, so a real LOSS was stored as `void`.
//   2. A staleness sweep voided four genuine WINS (+2.22u) whose only problem
//      was that grading had never been invoked for them.
//
// Both were caught by hand, after the fact, by someone happening to notice.
// This script is the standing check: it trusts nothing already stored and
// recomputes each outcome from MLB's box score, then diffs. Run it after any
// change to grading logic, and periodically as a regression guard.
//
// READ-ONLY — reports disagreements, changes nothing.

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

const stripAccents = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "");

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

const americanToDecimal = (o: number) =>
  o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o);

async function j(url: string) {
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

const picks: any[] = await (
  await fetch(
    `${SUPA}/rest/v1/manual_picks?select=id,slate_date,player_name,market,market_key,line,side,odds,units,pick_text,game,result,profit_units&sport=eq.mlb&status=eq.published&result=not.is.null&order=slate_date.asc`,
    { headers: H },
  )
).json();

if (!Array.isArray(picks)) {
  console.error("query failed:", JSON.stringify(picks).slice(0, 300));
  process.exit(1);
}
console.log(
  `Verifying ${picks.length} graded MLB picks against box scores...\n`,
);

// One box-score fetch per slate, shared across that slate's picks.
const slates = [...new Set(picks.map((p) => p.slate_date))];
const linesBySlate = new Map<string, any[]>();
const finalsBySlate = new Map<string, any[]>();

for (const slate of slates) {
  try {
    const sched = await j(`${MLB_API}/schedule?sportId=1&date=${slate}`);
    const games = (sched?.dates?.[0]?.games ?? []).filter(
      (g: any) => g?.status?.abstractGameState === "Final",
    );
    finalsBySlate.set(
      slate,
      games.map((g: any) => ({
        home: g?.teams?.home?.team?.name ?? "",
        away: g?.teams?.away?.team?.name ?? "",
        homeScore: Number(g?.teams?.home?.score ?? NaN),
        awayScore: Number(g?.teams?.away?.score ?? NaN),
      })),
    );
    const lines: any[] = [];
    for (const g of games) {
      const box = await j(`${MLB_API}/game/${g.gamePk}/boxscore`);
      for (const side of ["home", "away"] as const)
        for (const k of Object.keys(box?.teams?.[side]?.players ?? {})) {
          const pl = box.teams[side].players[k];
          if (pl?.person?.fullName)
            lines.push({
              name: pl.person.fullName,
              batting: pl?.stats?.batting,
              pitching: pl?.stats?.pitching,
            });
        }
    }
    linesBySlate.set(slate, lines);
  } catch {
    console.log(`  (${slate}: box scores unavailable — skipping its picks)`);
  }
}

type Bad = { pick: any; stored: string; derived: string; detail: string };
const disagree: Bad[] = [];
let verified = 0;
let skipped = 0;

for (const p of picks) {
  const lines = linesBySlate.get(p.slate_date);
  const finals = finalsBySlate.get(p.slate_date);
  if (!lines || !finals) {
    skipped++;
    continue;
  }

  let derived: string | null = null;
  let detail = "";

  if (p.market === "moneyline") {
    const [pickAway, pickHome] = String(p.game).split(" @ ");
    const n = (s: string) =>
      stripAccents(s ?? "")
        .toLowerCase()
        .trim();
    const f = finals.find(
      (x) =>
        (n(x.home) && n(pickHome).includes(n(x.home))) ||
        (n(x.away) && n(pickAway).includes(n(x.away))),
    );
    if (f && Number.isFinite(f.homeScore)) {
      const team = String(p.pick_text ?? "").replace(/\s*ML$/i, "");
      const pickedHome = n(pickHome).includes(n(team));
      const homeWon = f.homeScore > f.awayScore;
      derived =
        f.homeScore === f.awayScore
          ? "push"
          : pickedHome === homeWon
            ? "win"
            : "loss";
      detail = `${f.away} ${f.awayScore} - ${f.home} ${f.homeScore}`;
    }
  } else {
    const target = stripAccents(String(p.player_name ?? "")).toLowerCase();
    const hit = lines.find(
      (l) => stripAccents(l.name).toLowerCase() === target,
    );
    if (hit) {
      const stats = String(p.market_key).startsWith("pitcher_")
        ? hit.pitching
        : hit.batting;
      const actual = Number(stats?.[MARKET_STAT[p.market_key]]);
      if (Number.isFinite(actual)) {
        const line = Number(p.line);
        derived =
          actual === line
            ? "push"
            : (p.side === "over") === actual > line
              ? "win"
              : "loss";
        detail = `actual ${actual} vs line ${line}`;
      }
    } else {
      // Genuinely absent from a final box score = a legitimate void.
      derived = "void";
      detail = "player not in any final box score";
    }
  }

  if (!derived) {
    skipped++;
    continue;
  }
  verified++;
  if (derived !== p.result)
    disagree.push({ pick: p, stored: p.result, derived, detail });
}

console.log(`verified: ${verified}   skipped (no data): ${skipped}`);
console.log(`DISAGREEMENTS: ${disagree.length}\n`);

if (disagree.length) {
  let unitsWrong = 0;
  for (const d of disagree) {
    const stake = Number(d.pick.units ?? 1);
    const correct =
      d.derived === "push" || d.derived === "void"
        ? 0
        : d.derived === "win"
          ? stake * (americanToDecimal(Number(d.pick.odds ?? -110)) - 1)
          : -stake;
    unitsWrong += correct - Number(d.pick.profit_units ?? 0);
    console.log(
      `  ${d.pick.slate_date}  ${d.pick.pick_text}\n` +
        `    stored=${d.stored}  should be=${d.derived}  (${d.detail})`,
    );
  }
  console.log(
    `\nNet units misstated: ${unitsWrong >= 0 ? "+" : ""}${unitsWrong.toFixed(2)}u`,
  );
  console.log(
    `\nA nonzero count means the published record does not match reality.`,
  );
  process.exitCode = 1;
} else {
  console.log("Every graded pick matches an independent re-derivation. ✓");
}
