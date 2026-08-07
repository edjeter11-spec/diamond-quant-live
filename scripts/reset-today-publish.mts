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
for (const key of [
  `publish_claim_mlb_props_${et}`,
  `publish_claim_mlb_parlay_${et}`,
]) {
  const r = await fetch(`${SUPA}/rest/v1/app_state?key=eq.${key}`, {
    method: "DELETE",
    headers: { ...H, Prefer: "return=representation" },
  });
  console.log(`clear ${key} -> ${r.status}`);
}
const rows: any[] = await (
  await fetch(
    `${SUPA}/rest/v1/manual_picks?select=id,pick_text&slate_date=eq.${et}&sport=eq.mlb`,
    { headers: H },
  )
).json();
for (const row of rows ?? []) {
  const d = await fetch(`${SUPA}/rest/v1/manual_picks?id=eq.${row.id}`, {
    method: "DELETE",
    headers: H,
  });
  console.log(`  removed ${row.pick_text} -> ${d.status}`);
}
