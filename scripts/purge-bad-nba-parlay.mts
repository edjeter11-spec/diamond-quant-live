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

async function j(path: string) {
  const r = await fetch(`${SUPA}/rest/v1/${path}`, { headers: H });
  return r.json();
}

const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);

for (const date of [today]) {
  console.log(`\n=== NBA manual_picks for ${date} ===`);
  const rows = await j(
    `manual_picks?select=id,sport,slate_date,status,result,pick_text,batch_key&slate_date=eq.${date}&sport=eq.nba&order=batch_key`,
  );
  if (!Array.isArray(rows)) {
    console.log("query error:", JSON.stringify(rows).slice(0, 300));
    continue;
  }
  console.log(`total published: ${rows.length}`);
  const graded = rows.filter((r: any) => r.result != null);
  const ungraded = rows.filter((r: any) => r.result == null);
  console.log(`graded: ${graded.length}  ungraded: ${ungraded.length}`);
  for (const r of ungraded)
    console.log(`  UNGRADED [${r.sport}] ${r.batch_key ?? ""} ${r.pick_text}`);

  // Purge: these "NBA" rows are MLB games (Brewers/Mariners) produced by
  // parlay-today's MLB-only moneyline block being called with sport=nba.
  // They are not NBA picks and must not remain in the published record.
  for (const r of rows as any[]) {
    const del = await fetch(`${SUPA}/rest/v1/manual_picks?id=eq.${r.id}`, {
      method: "DELETE",
      headers: { ...H, Prefer: "return=representation" },
    });
    const t = await del.text();
    console.log(`  DELETE ${r.pick_text} -> ${del.status} ${t.slice(0, 120)}`);
  }
}
