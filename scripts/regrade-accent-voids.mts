// Repair wrongly-voided picks found by scripts/audit-accent-voids.mts.
//
// Two distinct causes produced bad `void` rows:
//   1. The accent bug — "Jeremy Peña" (box score) never matched "Jeremy Pena"
//      (stored), so findPlayer returned null and post-results voided a pick
//      whose player had actually played.
//   2. The stale-void sweep added in app/api/cron/route.ts — it voids
//      anything still pending past STALE_DAYS. That was correct for genuinely
//      unresolvable rows, but on 2026-07-30 the picks were pending only
//      because cron never called post-results for them at all. The sweep
//      voided 4 real WINS.
//
// Both cases are the same repair: the player did play, the box score has the
// number, so write the real result. Only touches rows the audit confirmed
// wrong (reads scripts/.accent-void-findings.json) and only where the row is
// STILL `void` — so re-running is safe and can't clobber a later regrade.

import fs from "fs";

const FINDINGS = "scripts/.accent-void-findings.json";
if (!fs.existsSync(FINDINGS)) {
  console.error(
    `No ${FINDINGS} — run scripts/audit-accent-voids.mts first (it's read-only).`,
  );
  process.exit(1);
}
const findings: Array<{
  id: string;
  slate: string;
  pick: string;
  actual: number;
  shouldBe: "win" | "loss" | "push";
  profitUnits: number;
}> = JSON.parse(fs.readFileSync(FINDINGS, "utf8"));

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

console.log(`Repairing ${findings.length} wrongly-voided picks...\n`);
let fixed = 0;
for (const f of findings) {
  const r = await fetch(
    `${SUPA}/rest/v1/manual_picks?id=eq.${f.id}&result=eq.void`,
    {
      method: "PATCH",
      headers: H,
      body: JSON.stringify({
        result: f.shouldBe,
        actual_value: f.actual,
        profit_units: f.profitUnits,
        settled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    },
  );
  const out = await r.json();
  const ok = Array.isArray(out) && out.length === 1;
  if (ok) fixed++;
  console.log(
    `  ${ok ? "FIXED " : "SKIP  "} ${f.slate}  ${f.pick} → ${f.shouldBe.toUpperCase()} (${f.profitUnits >= 0 ? "+" : ""}${f.profitUnits}u)` +
      (ok ? "" : "  (no longer void — left alone)"),
  );
}
console.log(`\n${fixed}/${findings.length} repaired.`);
