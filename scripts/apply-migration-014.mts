// Apply migration 014 (unique index on daily_picks_log's dedup key).
//
// Supabase's REST API can't run DDL, so this uses the pg connection string if
// one is available; otherwise it prints the SQL for manual execution in the
// dashboard SQL editor. Verifies the index afterwards either way.

import fs from "fs";

const SQL = fs.readFileSync(
  "supabase/migrations/014_daily_picks_log_unique.sql",
  "utf8",
);

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

const dbUrl =
  env("POSTGRES_URL_NON_POOLING") ||
  env("POSTGRES_URL") ||
  env("DATABASE_URL") ||
  env("SUPABASE_DB_URL");

if (!dbUrl) {
  console.log(
    "No Postgres connection string in env (looked for POSTGRES_URL_NON_POOLING,\n" +
      "POSTGRES_URL, DATABASE_URL, SUPABASE_DB_URL).\n\n" +
      "Run this in the Supabase dashboard → SQL Editor:\n\n" +
      "─".repeat(60) +
      "\n" +
      SQL +
      "─".repeat(60),
  );
  process.exit(0);
}

const { default: pg } = await import("pg");
const client = new pg.Client({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
try {
  await client.query(SQL);
  const { rows } = await client.query(
    `select indexname from pg_indexes
      where tablename = 'daily_picks_log'
        and indexname = 'daily_picks_log_dedup_uidx'`,
  );
  console.log(
    rows.length
      ? "✓ daily_picks_log_dedup_uidx present — race closed."
      : "index not found after apply (unexpected)",
  );
} finally {
  await client.end();
}
