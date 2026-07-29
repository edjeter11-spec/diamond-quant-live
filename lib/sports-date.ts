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
export function etDateString(d = new Date()): string {
  const et = new Date(
    d.toLocaleString("en-US", { timeZone: "America/New_York" }),
  );
  return `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, "0")}-${String(et.getDate()).padStart(2, "0")}`;
}

/** The ET sports day for a given ISO timestamp. */
export function etDateOf(iso: string): string {
  return etDateString(new Date(iso));
}
