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

const hb: any[] = await (
  await fetch(
    `${SUPA}/rest/v1/app_state?select=key,value,updated_at&key=eq.cron_heartbeat`,
    { headers: H },
  )
).json();
console.log(JSON.stringify(hb, null, 1));
