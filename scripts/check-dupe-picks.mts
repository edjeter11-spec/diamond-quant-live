// Detect duplicate rows in daily_picks_log.
//
// logDailyPicks dedups by reading existing rows and skipping matches, but
// there is NO unique constraint backing it (005_track_record.sql creates four
// plain indexes, none UNIQUE). Two overlapping cron runs both read "not
// present" and both insert. The duplicates then settle independently and
// each contribute profit_units, double-counting the public record.
//
// READ-ONLY. Reports duplicates on the dedup key logDailyPicks actually uses:
// (pick_date, sport, category, pick_text).

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

const rows: any[] = [];
for (let offset = 0; ; offset += 1000) {
  const r = await fetch(
    `${SUPA}/rest/v1/daily_picks_log?select=id,pick_date,sport,category,pick_text,result,profit_units&order=pick_date.asc`,
    { headers: { ...H, Range: `${offset}-${offset + 999}` } },
  );
  const j = await r.json();
  if (!Array.isArray(j)) {
    console.error("query failed:", JSON.stringify(j).slice(0, 300));
    process.exit(1);
  }
  rows.push(...j);
  if (j.length < 1000) break;
}

console.log(`daily_picks_log rows: ${rows.length}\n`);

const groups = new Map<string, any[]>();
for (const r of rows) {
  const k = `${r.pick_date}|${r.sport}|${r.category}|${r.pick_text}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k)!.push(r);
}

const dupes = [...groups.entries()].filter(([, v]) => v.length > 1);
console.log(`Duplicate groups: ${dupes.length}`);

if (dupes.length) {
  let extraRows = 0;
  let doubleCountedUnits = 0;
  for (const [k, v] of dupes) {
    extraRows += v.length - 1;
    // Everything past the first settled copy is double-counted profit.
    const settled = v.filter((r) => r.result && r.result !== "pending");
    for (const s of settled.slice(1))
      doubleCountedUnits += Number(s.profit_units ?? 0);
    console.log(`\n  ${k}  (${v.length} copies)`);
    for (const r of v)
      console.log(
        `    ${r.id}  result=${r.result ?? "null"}  units=${r.profit_units ?? "null"}`,
      );
  }
  console.log(
    `\nExtra rows: ${extraRows}   Double-counted units: ${doubleCountedUnits >= 0 ? "+" : ""}${doubleCountedUnits.toFixed(2)}u`,
  );
  process.exitCode = 1;
} else {
  console.log("No duplicates. ✓");
}
