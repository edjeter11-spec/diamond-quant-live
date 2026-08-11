import { NextResponse } from "next/server";
import { getCached, setCache } from "@/lib/odds/server-cache";
import { etDateString } from "@/lib/sports-date";

export const dynamic = "force-dynamic";

// ──────────────────────────────────────────────────────────
// TICKER FEED
//
// Fills the top banner when there's nothing live to scroll.
//
// It used to read "Scanning markets for edges..." on repeat, which is both
// dull and slightly dishonest — nothing is scanning, the page just has no
// alerts right now. Most of the day (mornings, off-hours, between slates)
// that's the only thing a visitor ever saw.
//
// Real content instead, all from free sources with no key:
//   - MLB trades and roster moves (MLB Stats API transactions)
//   - Headlines (ESPN's public news feed)
//
// Cached 15 minutes: this is background colour, not a live feed, and the
// upstreams don't move faster than that.
// ──────────────────────────────────────────────────────────

const TTL = 15 * 60 * 1000;

// Per-sport so the NBA/NFL tabs don't scroll baseball roster moves. The
// ticker was hardcoded to MLB and rendered on every tab, so out of baseball
// season — or just on the NBA tab in August — the banner read as MLB while
// everything under it was another sport.
//
// Only MLB has a free transactions feed (statsapi). ESPN's news endpoint is
// the same shape for every sport, so NBA/NFL/NHL run news-only rather than
// showing nothing.
const SPORTS = {
  mlb: { espn: "baseball/mlb", label: "MLB", transactions: true },
  nba: { espn: "basketball/nba", label: "NBA", transactions: false },
  nfl: { espn: "football/nfl", label: "NFL", transactions: false },
  nhl: { espn: "hockey/nhl", label: "NHL", transactions: false },
} as const;

type SportKey = keyof typeof SPORTS;

function resolveSport(raw: string | null): SportKey {
  const s = (raw ?? "mlb").toLowerCase();
  return (Object.keys(SPORTS) as SportKey[]).includes(s as SportKey)
    ? (s as SportKey)
    : "mlb";
}

// Roster moves worth a bettor's attention. "Assigned" and "Status Change" are
// the bulk of the feed and are almost entirely minor-league churn — a Double-A
// reliever moving affiliates tells nobody anything about tonight's slate.
const USEFUL_TYPES = new Set([
  "Trade",
  "Recalled",
  "Optioned",
  "Selected",
  "Claimed Off Waivers",
  "Designated for Assignment",
  "Signed as Free Agent",
]);

interface TickerItem {
  type: "news" | "move";
  text: string;
}

function daysAgoISO(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

async function fetchTransactions(): Promise<TickerItem[]> {
  try {
    const r = await fetch(
      `https://statsapi.mlb.com/api/v1/transactions?startDate=${daysAgoISO(2)}&endDate=${etDateString()}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!r.ok) return [];
    const d = await r.json();
    const rows: any[] = d?.transactions ?? [];

    const out: TickerItem[] = [];
    const seen = new Set<string>();

    // Newest first — a trade from this morning beats one from two days ago.
    for (const t of rows.reverse()) {
      if (!USEFUL_TYPES.has(t.typeDesc)) continue;
      const desc = String(t.description ?? "").trim();
      if (!desc) continue;

      // The API repeats a multi-player trade once per player involved, so the
      // same sentence can appear three or four times in a row.
      const key = desc.slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);

      const label = t.typeDesc === "Trade" ? "TRADE" : "ROSTER";
      out.push({
        type: "move",
        text: `${label}: ${desc.replace(/\.$/, "")}`,
      });
      if (out.length >= 8) break;
    }
    return out;
  } catch {
    return [];
  }
}

async function fetchNews(sport: SportKey): Promise<TickerItem[]> {
  const { espn, label } = SPORTS[sport];
  try {
    const r = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/${espn}/news?limit=10`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!r.ok) return [];
    const d = await r.json();
    const arts: any[] = d?.articles ?? [];
    return (
      arts
        .map((a) => String(a?.headline ?? "").trim())
        .filter(Boolean)
        // Fantasy columns and depth charts aren't news to a bettor.
        .filter((h) => !/^fantasy /i.test(h))
        .slice(0, 6)
        .map((h) => ({ type: "news" as const, text: `${label}: ${h}` }))
    );
  } catch {
    return [];
  }
}

export async function GET(req: Request) {
  const sport = resolveSport(new URL(req.url).searchParams.get("sport"));
  const cacheKey = `ticker_feed_${sport}`;

  // Vercel edge caches this for 60s with 5min stale-while-revalidate. Prior
  // config was max-age=0 must-revalidate → every visitor hit our server.
  // News moves in minutes, not seconds; 60s is invisible to any user and
  // erases the per-visitor round trip on cold load.
  const edgeHeaders = {
    "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
  };

  const cached = getCached(cacheKey, TTL) as { items: TickerItem[] } | null;
  if (cached?.items?.length)
    return NextResponse.json(cached, { headers: edgeHeaders });

  const [moves, news] = await Promise.all([
    SPORTS[sport].transactions ? fetchTransactions() : Promise.resolve([]),
    fetchNews(sport),
  ]);

  // Interleave so the ticker alternates rather than showing eight trades then
  // six headlines — a run of one kind reads as a stuck feed.
  const items: TickerItem[] = [];
  for (let i = 0; i < Math.max(moves.length, news.length); i++) {
    if (moves[i]) items.push(moves[i]);
    if (news[i]) items.push(news[i]);
  }

  const payload = { items, sport, updatedAt: new Date().toISOString() };
  // Don't cache an empty result — both upstreams failing is a transient
  // outage, not an answer, and a 15-minute empty cache would leave the banner
  // back on its idle message for no reason.
  if (items.length > 0) setCache(cacheKey, payload);

  // Only add edge headers when we have real content. An empty result at the
  // edge would freeze the banner idle for 60s across every visitor.
  return NextResponse.json(
    payload,
    items.length > 0 ? { headers: edgeHeaders } : undefined,
  );
}
