// One-time backfill: void the 1,069+ prop_predictions rows (plus any stuck
// manual_picks/bot_picks) that scripts/audit-stuck-picks.mts found stuck
// pending since before the cron void-sweep (app/api/cron/route.ts) existed.
// Same logic as that sweep, run once by hand so the backlog doesn't sit
// until the next cron tick after deploy. Idempotent — matches only rows
// still 'pending', so re-running this is harmless.

import fs from "fs";

const STALE_DAYS = 3;

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
const H = {
  apikey: KEY,
  Authorization: "Bearer " + KEY,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

const staleCutoff = new Date(Date.now() - STALE_DAYS * 86400_000)
  .toISOString()
  .slice(0, 10);

console.log(`Voiding anything still pending before ${staleCutoff}...\n`);

async function patch(path: string, body: object): Promise<any[]> {
  const r = await fetch(`${SUPA}/rest/v1/${path}`, {
    method: "PATCH",
    headers: H,
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!Array.isArray(j)) {
    console.error(`  FAILED ${path}\n  ${JSON.stringify(j).slice(0, 400)}`);
    return [];
  }
  return j;
}

const props = await patch(
  `prop_predictions?status=eq.pending&game_date=lt.${staleCutoff}`,
  { status: "void", graded_at: new Date().toISOString() },
);
console.log(`prop_predictions voided: ${props.length}`);

const manual = await patch(
  `manual_picks?status=eq.published&result=is.null&slate_date=lt.${staleCutoff}`,
  {
    result: "void",
    settled_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
);
console.log(`manual_picks voided: ${manual.length}`);

// bot_picks' CHECK constraint doesn't allow 'void' — 'push' is the closest
// neutral result it accepts (0 stake impact).
const bot = await patch(
  `bot_picks?result=eq.pending&slate_date=lt.${staleCutoff}`,
  { result: "push", settled_at: new Date().toISOString() },
);
console.log(`bot_picks marked push (neutral): ${bot.length}`);

console.log(
  `\nTotal: ${props.length + manual.length + bot.length} rows resolved.`,
);
