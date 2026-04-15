// ──────────────────────────────────────────────────────────
// The Odds API Connector
// Fetches live odds from DraftKings, FanDuel, BetMGM, etc.
// https://the-odds-api.com/
// ──────────────────────────────────────────────────────────

import type { OddsLine, PlayerProp } from "@/lib/model/types";

const BASE_URL = "https://api.the-odds-api.com/v4";
const SPORT = "baseball_mlb";

const BOOKMAKERS = [
  "draftkings",
  "fanduel",
  "fanatics",
  "betmgm",
  "hardrockbet",
  "betrivers",
  "espnbet",
  "pointsbetus",
  "bovada",
  "williamhill_us",
  "unibet_us",
];

// Display names for bookmakers
export const BOOK_DISPLAY: Record<string, { name: string; short: string; color: string }> = {
  draftkings: { name: "DraftKings", short: "DK", color: "#53d337" },
  fanduel: { name: "FanDuel", short: "FD", color: "#1493ff" },
  fanatics: { name: "Fanatics", short: "FAN", color: "#e31837" },
  betmgm: { name: "BetMGM", short: "MGM", color: "#c4a962" },
  hardrockbet: { name: "Hard Rock", short: "HR", color: "#ff6b00" },
  betrivers: { name: "BetRivers", short: "BR", color: "#ffd700" },
  espnbet: { name: "ESPN BET", short: "ESPN", color: "#d00" },
  pointsbetus: { name: "PointsBet", short: "PB", color: "#e44" },
  bovada: { name: "Bovada", short: "BOV", color: "#cc0000" },
  williamhill_us: { name: "Caesars", short: "CZR", color: "#00594c" },
  unibet_us: { name: "Unibet", short: "UNI", color: "#14805e" },
};

interface OddsAPIGame {
  id: string;
  sport_key: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: Array<{
    key: string;
    title: string;
    last_update: string;
    markets: Array<{
      key: string;
      last_update: string;
      outcomes: Array<{
        name: string;
        price: number;
        point?: number;
        description?: string;
      }>;
    }>;
  }>;
}

export async function fetchOdds(apiKey: string, sportKey: string = SPORT): Promise<OddsAPIGame[]> {
  const markets = "h2h,spreads,totals";
  const url = `${BASE_URL}/sports/${sportKey}/odds/?apiKey=${apiKey}&regions=us&markets=${markets}&oddsFormat=american&bookmakers=${BOOKMAKERS.join(",")}`;

  const res = await fetch(url, { next: { revalidate: 30 } });
  const remaining = res.headers.get("x-requests-remaining");
  if (remaining !== null && parseInt(remaining) <= 0) {
    const { markKeyExhausted } = await import("./api-keys");
    markKeyExhausted(apiKey);
  }
  if (!res.ok) throw new Error(`Odds API error: ${res.status} ${res.statusText}`);
  return res.json();
}

// Backward compatible alias
export async function fetchMLBOdds(apiKey: string): Promise<OddsAPIGame[]> {
  return fetchOdds(apiKey, SPORT);
}


export async function fetchPlayerProps(
  apiKey: string,
  eventId: string,
  market: string = "pitcher_strikeouts",
  sportKey: string = SPORT
): Promise<OddsAPIGame> {
  const url = `${BASE_URL}/sports/${sportKey}/events/${eventId}/odds?apiKey=${apiKey}&regions=us&markets=${market}&oddsFormat=american&bookmakers=${BOOKMAKERS.join(",")}`;

  const res = await fetch(url, { next: { revalidate: 60 } });
  if (!res.ok) {
    throw new Error(`Props API error: ${res.status}`);
  }

  return res.json();
}

// Transform API response to our OddsLine format
export function parseOddsLines(game: OddsAPIGame): OddsLine[] {
  return game.bookmakers.map((book) => {
    const h2h = book.markets.find((m) => m.key === "h2h");
    const spreads = book.markets.find((m) => m.key === "spreads");
    const totals = book.markets.find((m) => m.key === "totals");

    const homeH2H = h2h?.outcomes.find((o) => o.name === game.home_team);
    const awayH2H = h2h?.outcomes.find((o) => o.name === game.away_team);
    const homeSpread = spreads?.outcomes.find((o) => o.name === game.home_team);
    const awaySpread = spreads?.outcomes.find((o) => o.name === game.away_team);
    const over = totals?.outcomes.find((o) => o.name === "Over");
    const under = totals?.outcomes.find((o) => o.name === "Under");

    return {
      bookmaker: book.title,
      bookmakerKey: book.key,
      homeML: homeH2H?.price ?? 0,
      awayML: awayH2H?.price ?? 0,
      homeSpread: homeSpread?.point ?? -1.5,
      awaySpread: awaySpread?.point ?? 1.5,
      spreadPrice: homeSpread?.price ?? -110,
      total: over?.point ?? 0,
      overPrice: over?.price ?? -110,
      underPrice: under?.price ?? -110,
      lastUpdate: book.last_update,
    };
  });
}

// Parse player props from API response
export function parsePlayerProps(game: OddsAPIGame): PlayerProp[] {
  const props: PlayerProp[] = [];

  for (const book of game.bookmakers) {
    for (const market of book.markets) {
      const overOutcome = market.outcomes.find((o) => o.name === "Over");
      const underOutcome = market.outcomes.find((o) => o.name === "Under");

      if (overOutcome && underOutcome && overOutcome.description) {
        props.push({
          bookmaker: book.title,
          playerName: overOutcome.description,
          playerId: overOutcome.description.toLowerCase().replace(/\s+/g, "_"),
          team: "",
          market: market.key,
          line: overOutcome.point ?? 0,
          overPrice: overOutcome.price,
          underPrice: underOutcome.price,
        });
      }
    }
  }

  return props;
}

// Find best available line across all books
export function findBestLine(
  oddsLines: OddsLine[],
  side: "home" | "away",
  market: "ml" | "spread" | "total_over" | "total_under"
): { bookmaker: string; odds: number } {
  let best = { bookmaker: "", odds: -Infinity };

  for (const line of oddsLines) {
    let odds: number;
    switch (market) {
      case "ml":
        odds = side === "home" ? line.homeML : line.awayML;
        break;
      case "spread":
        odds = line.spreadPrice;
        break;
      case "total_over":
        odds = line.overPrice;
        break;
      case "total_under":
        odds = line.underPrice;
        break;
    }

    if (odds > best.odds) {
      best = { bookmaker: line.bookmaker, odds };
    }
  }

  return best;
}
