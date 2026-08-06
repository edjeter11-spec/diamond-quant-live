// Audit every pick-tracking table for rows that will NEVER get a result.
//
// Three tables carry predictions, each with a different "done" signal:
//   manual_picks     — result IS NULL means ungraded  (published board/parlay picks)
//   bot_picks        — result = 'pending'             (moneyline model picks)
//   prop_predictions — status = 'pending'             (internal brain-learning)
//
// "Still pending" is NORMAL for a game that hasn't happened yet or just
// ended. It becomes a bug once the game is old enough that it's certainly
// over and nothing is coming back to grade it — a rainout, a box-score
// source that silently stopped covering that sport, a grader that was never
// wired to run automatically (the exact gap this script exists to catch:
// NBA/NFL manual_picks had zero automated grading path until cron/route.ts
// was fixed to loop post-results over every sport, not just MLB).
//
// STALE_DAYS=2 is deliberately generous — even a doubleheader or a game that
// went to extra innings/OT resolves same-day. Two days with no result is
// unambiguously stuck, not "still in progress."

import fs from "fs";

const STALE_DAYS = 2;

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
if (!SUPA || !KEY) {
  console.error(
    `Missing Supabase URL/service key in ${ENV_FILE}. Run:\n` +
      `  npx vercel env pull .env.vercel --environment=production`,
  );
  process.exit(1);
}
const H = { apikey: KEY, Authorization: "Bearer " + KEY };

const staleCutoff = new Date(Date.now() - STALE_DAYS * 86400_000)
  .toISOString()
  .slice(0, 10);

// PostgREST caps a single response at 1000 rows by default. Paginate so a
// suspiciously round count like "1000" doesn't hide a bigger real number —
// which is exactly what happened on the first run of this script.
async function fetchJson(path: string): Promise<any[]> {
  const out: any[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const r = await fetch(`${SUPA}/rest/v1/${path}`, {
      headers: { ...H, Range: `${offset}-${offset + pageSize - 1}` },
    });
    const j = await r.json();
    if (!Array.isArray(j)) {
      console.error(
        `  query failed: ${path}\n  ${JSON.stringify(j).slice(0, 300)}`,
      );
      return out;
    }
    out.push(...j);
    if (j.length < pageSize) break;
  }
  return out;
}

function summarizeBySport(rows: any[], sportKey = "sport"): string {
  const bySport = new Map<string, number>();
  for (const r of rows) {
    const s = r[sportKey] ?? "?";
    bySport.set(s, (bySport.get(s) ?? 0) + 1);
  }
  return [...bySport.entries()].map(([s, n]) => `${s}=${n}`).join(", ");
}

console.log(
  `Stuck-pick audit — anything older than ${staleCutoff} (${STALE_DAYS}d) still ungraded.\n`,
);

// ── manual_picks ──
{
  const rows = await fetchJson(
    `manual_picks?select=id,sport,slate_date,status,result,pick_text&status=eq.published&result=is.null&slate_date=lt.${staleCutoff}&order=slate_date.asc`,
  );
  console.log(
    `manual_picks — published, ungraded, older than cutoff: ${rows.length}`,
  );
  if (rows.length) {
    console.log(`  by sport: ${summarizeBySport(rows)}`);
    for (const r of rows.slice(0, 10))
      console.log(`  ${r.slate_date}  ${r.sport}  ${r.pick_text ?? r.id}`);
    if (rows.length > 10) console.log(`  ... and ${rows.length - 10} more`);
  }
}

// ── bot_picks ──
{
  const cutoffSlate = staleCutoff;
  const rows = await fetchJson(
    `bot_picks?select=id,sport,slate_date,pick,result&result=eq.pending&slate_date=lt.${cutoffSlate}&order=slate_date.asc`,
  );
  console.log(`\nbot_picks — pending, older than cutoff: ${rows.length}`);
  if (rows.length) {
    console.log(`  by sport: ${summarizeBySport(rows)}`);
    for (const r of rows.slice(0, 10))
      console.log(`  ${r.slate_date}  ${r.sport}  ${r.pick}`);
    if (rows.length > 10) console.log(`  ... and ${rows.length - 10} more`);
  }
}

// ── prop_predictions ──
{
  const rows = await fetchJson(
    `prop_predictions?select=id,sport,game_date,player_name,prop_type,status&status=eq.pending&game_date=lt.${staleCutoff}&order=game_date.asc`,
  );
  console.log(
    `\nprop_predictions — pending, older than cutoff: ${rows.length}`,
  );
  if (rows.length) {
    console.log(`  by sport: ${summarizeBySport(rows)}`);
    for (const r of rows.slice(0, 10))
      console.log(
        `  ${r.game_date}  ${r.sport}  ${r.player_name} ${r.prop_type}`,
      );
    if (rows.length > 10) console.log(`  ... and ${rows.length - 10} more`);
  }
}

console.log(
  `\nA nonzero count above is a real gap: those games are certainly over and` +
    `\nnothing will ever grade them automatically. Common causes: a postponed/` +
    `\nrained-out game (no "final" box score ever appears), a grader that isn't` +
    `\nactually invoked on a schedule for that sport, or a name-matching miss` +
    `\nbetween the pick and the box score.`,
);
