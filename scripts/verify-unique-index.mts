// Confirm the daily_picks_log unique index is live by testing its BEHAVIOUR,
// not by reading pg_indexes: insert a duplicate of an existing row and check
// the database rejects it.
//
// Safe: the probe row is a copy of a row that already exists, so if the index
// is present nothing is written (unique violation), and if it's somehow
// absent the duplicate is deleted again immediately.

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
const H = {
  apikey: KEY,
  Authorization: "Bearer " + KEY,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

// Grab any existing row to clone.
const existing: any[] = await (
  await fetch(
    `${SUPA}/rest/v1/daily_picks_log?select=sport,pick_date,category,pick_text&limit=1`,
    { headers: H },
  )
).json();

if (!Array.isArray(existing) || existing.length === 0) {
  console.log(
    "No rows in daily_picks_log to test against — nothing to verify.",
  );
  process.exit(0);
}

const dupe = { ...existing[0] };
console.log(
  `Attempting to insert a duplicate of: ${dupe.pick_date} ${dupe.sport} ${dupe.category} "${dupe.pick_text}"`,
);

const res = await fetch(`${SUPA}/rest/v1/daily_picks_log`, {
  method: "POST",
  headers: H,
  body: JSON.stringify(dupe),
});
const body = await res.json();

if (res.status === 409 || String(body?.code) === "23505") {
  console.log(
    `\n✓ REJECTED (${res.status}) — the unique index is live and the duplicate race is closed.`,
  );
  process.exit(0);
}

if (Array.isArray(body) && body.length > 0) {
  console.log(
    `\n✗ Duplicate was ACCEPTED — the unique index is NOT in place. Cleaning up...`,
  );
  const del = await fetch(
    `${SUPA}/rest/v1/daily_picks_log?id=eq.${body[0].id}`,
    { method: "DELETE", headers: H },
  );
  console.log(`  cleanup delete status: ${del.status}`);
  process.exitCode = 1;
} else {
  console.log(
    `\n? Unexpected response ${res.status}: ${JSON.stringify(body).slice(0, 300)}`,
  );
  process.exitCode = 1;
}
