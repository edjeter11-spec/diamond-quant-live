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

const etToday = new Date().toLocaleDateString("en-CA", {
  timeZone: "America/New_York",
});

// Clear cached parlay blobs for sports that shouldn't have one. The gate in
// parlay-today now refuses to build an NBA/NFL parlay from the MLB moneyline
// engine, but a blob cached BEFORE that fix keeps being served (and
// re-published) until it's removed.
for (const sport of ["nba", "nfl"]) {
  const key = `parlay_today_${sport}_${etToday}`;
  const del = await fetch(`${SUPA}/rest/v1/app_state?key=eq.${key}`, {
    method: "DELETE",
    headers: { ...H, Prefer: "return=representation" },
  });
  const t = await del.text();
  console.log(`clear ${key} -> ${del.status} ${t.slice(0, 90)}`);
}
