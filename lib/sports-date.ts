// ──────────────────────────────────────────────────────────
// Sports-day date helpers (client-safe).
//
// A "sports day" is anchored to US Eastern time, not UTC. This matters:
// `new Date().toISOString().split("T")[0]` rolls to the next calendar day at
// 8pm ET (= midnight UTC) while games are still in progress, so evening picks
// were being bucketed under tomorrow's key — and a browser in US local time
// would then disagree with the server about which day "today" is.
//
// Every pick-generation, caching, logging, and settlement path should key off
// these helpers rather than raw ISO slicing.
// ──────────────────────────────────────────────────────────

/** Today's sports day (YYYY-MM-DD) in US Eastern time. */
/** Hour (ET) at which the sports day rolls over. */
const SPORTS_DAY_ROLLOVER_HOUR = 4;

export function etDateString(d = new Date()): string {
  const et = new Date(
    d.toLocaleString("en-US", { timeZone: "America/New_York" }),
  );
  // The sports day doesn't end at midnight — a 10:10pm PT first pitch is still
  // in the 8th inning at 1am ET. Rolling the date at 00:00 swapped the board
  // to tomorrow's picks while last night's were still being played, so a
  // reader watching a live leg lost the board out from under them.
  //
  // Treat anything before 4am ET as still belonging to the previous day. By
  // then every game on any slate is final, and nothing for the new day has
  // been posted.
  if (et.getHours() < SPORTS_DAY_ROLLOVER_HOUR) {
    et.setDate(et.getDate() - 1);
  }
  return `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, "0")}-${String(et.getDate()).padStart(2, "0")}`;
}

/** The ET sports day for a given ISO timestamp. */
export function etDateOf(iso: string): string {
  return etDateString(new Date(iso));
}
