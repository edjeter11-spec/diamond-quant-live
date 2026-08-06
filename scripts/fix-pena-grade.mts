// One-time correction: the 2026-08-05 "Jeremy Pena Over 1.5 Total Bases"
// pick was graded `void` by the accent-matching bug (box score says
// "Jeremy Peña", manual_picks says "Jeremy Pena" — neither .includes() the
// other, so findPlayer returned null and the void-on-absent-player fallback
// fired). He actually played: 0-for-5, 0 total bases, vs a 1.5 line — a
// LOSS. At +115 on 1 unit that's -1.00 units.
//
// The code fix is in lib/mlb/prop-grader.ts (stripAccents); this just
// repairs the one row already written with the wrong result.

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

const r = await fetch(
  `${SUPA}/rest/v1/manual_picks?id=eq.37711cfc-720d-43e2-9de2-ba703a0de2f8&result=eq.void`,
  {
    method: "PATCH",
    headers: H,
    body: JSON.stringify({
      result: "loss",
      actual_value: 0,
      profit_units: -1.0,
      settled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
  },
);
console.log(JSON.stringify(await r.json(), null, 1));
