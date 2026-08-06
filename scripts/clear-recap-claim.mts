// Release a recap claim that was left in `pending: true` — i.e. grading
// started, claimed the batch, then never finished or released it, which
// permanently blocks post-results from retrying that batch ("alreadyPosted").
//
// Only deletes claims still marked pending (never one with a real messageId,
// which means the recap genuinely posted).

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

const key = process.argv[2];
if (!key) {
  console.error("usage: tsx scripts/clear-recap-claim.mts <recap_posted_KEY>");
  process.exit(1);
}

const cur = await (
  await fetch(`${SUPA}/rest/v1/app_state?select=*&key=eq.${key}`, {
    headers: H,
  })
).json();
console.log("current:", JSON.stringify(cur));

if (!Array.isArray(cur) || cur.length === 0) {
  console.log("no such claim — nothing to clear.");
  process.exit(0);
}
if (cur[0]?.value?.messageId) {
  console.error(
    "REFUSING: this claim has a real messageId, meaning the recap actually " +
      "posted. Clearing it would double-post.",
  );
  process.exit(1);
}

const r = await fetch(`${SUPA}/rest/v1/app_state?key=eq.${key}`, {
  method: "DELETE",
  headers: { ...H, Prefer: "return=representation" },
});
console.log("deleted:", JSON.stringify(await r.json()));
