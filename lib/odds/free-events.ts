// ──────────────────────────────────────────────────────────
// Free Upcoming-Events Source (no Odds API key needed)
// Pulls upcoming games from ESPN (NBA) / MLB Stats API (MLB).
// Returns the same shape as The Odds API events endpoint so
// the props route can fall back to this when keys are exhausted.
// ──────────────────────────────────────────────────────────

export interface FreeEvent {
  id: string;
  home_team: string;
  away_team: string;
  commence_time: string;
}

const ESPN_NBA =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard";
const ESPN_NFL =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
const MLB_API = "https://statsapi.mlb.com/api/v1/schedule";

function yyyymmdd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function isoDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

// Returns upcoming + recently-started games over a 28-hour window so the prop
// board never empties out as the day's games tick into "live" status.
export async function getFreeEvents(sport: string): Promise<FreeEvent[]> {
  if (sport === "basketball_nba" || sport === "nba") return getNbaEvents();
  if (sport === "americanfootball_nfl" || sport === "nfl")
    return getNflEvents();
  return getMlbEvents();
}

async function getNbaEvents(): Promise<FreeEvent[]> {
  const out: FreeEvent[] = [];
  const dates = [new Date(), new Date(Date.now() + 86400000)]; // today + tomorrow
  for (const d of dates) {
    try {
      const res = await fetch(`${ESPN_NBA}?dates=${yyyymmdd(d)}`, {
        next: { revalidate: 600 },
      });
      if (!res.ok) continue;
      const data = await res.json();
      for (const ev of data.events ?? []) {
        const comp = ev.competitions?.[0];
        if (!comp) continue;
        const home = comp.competitors?.find((c: any) => c.homeAway === "home");
        const away = comp.competitors?.find((c: any) => c.homeAway === "away");
        if (!home?.team?.displayName || !away?.team?.displayName) continue;
        out.push({
          id: String(ev.id),
          home_team: home.team.displayName,
          away_team: away.team.displayName,
          commence_time: comp.startDate ?? new Date().toISOString(),
        });
      }
    } catch {}
  }
  return filterWindow(out);
}

async function getNflEvents(): Promise<FreeEvent[]> {
  const out: FreeEvent[] = [];
  // NFL plays weekly, not daily — "today + tomorrow" (the NBA/MLB window)
  // would miss every game most days of the week. Scan a full week of dates;
  // ESPN's scoreboard endpoint dedupes fine since most days have zero games.
  const dates = Array.from(
    { length: 8 },
    (_, i) => new Date(Date.now() + i * 86400000),
  );
  for (const d of dates) {
    try {
      const res = await fetch(`${ESPN_NFL}?dates=${yyyymmdd(d)}`, {
        next: { revalidate: 600 },
      });
      if (!res.ok) continue;
      const data = await res.json();
      for (const ev of data.events ?? []) {
        const comp = ev.competitions?.[0];
        if (!comp) continue;
        const home = comp.competitors?.find((c: any) => c.homeAway === "home");
        const away = comp.competitors?.find((c: any) => c.homeAway === "away");
        if (!home?.team?.displayName || !away?.team?.displayName) continue;
        out.push({
          id: String(ev.id),
          home_team: home.team.displayName,
          away_team: away.team.displayName,
          commence_time: comp.startDate ?? new Date().toISOString(),
        });
      }
    } catch {}
  }
  // Dedup — the weekly scan can see the same game on adjacent date queries.
  const seen = new Set<string>();
  const deduped = out.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
  return filterWindow(deduped, 24 * 7);
}

async function getMlbEvents(): Promise<FreeEvent[]> {
  const out: FreeEvent[] = [];
  const dates = [new Date(), new Date(Date.now() + 86400000)];
  for (const d of dates) {
    try {
      const url = `${MLB_API}?sportId=1&date=${isoDate(d)}&hydrate=team`;
      const res = await fetch(url, { next: { revalidate: 600 } });
      if (!res.ok) continue;
      const data = await res.json();
      for (const dateEntry of data.dates ?? []) {
        for (const game of dateEntry.games ?? []) {
          if (!game.teams?.home?.team?.name || !game.teams?.away?.team?.name)
            continue;
          out.push({
            id: String(game.gamePk),
            home_team: game.teams.home.team.name,
            away_team: game.teams.away.team.name,
            commence_time: game.gameDate ?? new Date().toISOString(),
          });
        }
      }
    } catch {}
  }
  return filterWindow(out);
}

function filterWindow(events: FreeEvent[], lookaheadHours = 28): FreeEvent[] {
  const now = Date.now();
  return events
    .filter((e) => {
      const t = new Date(e.commence_time).getTime();
      // Last 4h up through the lookahead window. NFL passes 24*7 (a full
      // week — its slate is weekly, not daily) instead of the default 28h
      // used by NBA/MLB's daily schedules.
      return (
        t >= now - 4 * 60 * 60 * 1000 &&
        t <= now + lookaheadHours * 60 * 60 * 1000
      );
    })
    .sort(
      (a, b) =>
        new Date(a.commence_time).getTime() -
        new Date(b.commence_time).getTime(),
    )
    .slice(0, 8);
}
