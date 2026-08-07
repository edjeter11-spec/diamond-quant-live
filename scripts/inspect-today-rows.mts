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

const et = new Date().toLocaleDateString("en-CA", {
  timeZone: "America/New_York",
});
const rows: any[] = await (
  await fetch(
    `${SUPA}/rest/v1/manual_picks?select=pick_text,market,market_key,player_name,line,side,odds,game&slate_date=eq.${et}&sport=eq.mlb`,
    { headers: H },
  )
).json();
for (const r of rows ?? [])
  console.log(`${r.pick_text}
   market=${r.market} key=${r.market_key} player=${r.player_name} line=${r.line} side=${r.side} odds=${r.odds}
   game=${r.game}`);
