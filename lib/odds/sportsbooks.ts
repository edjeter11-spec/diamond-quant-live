// ──────────────────────────────────────────────────────────
// Sportsbook Deep Links + Affiliate Tracking
//
// Every link out to a sportsbook carries our affiliate code when
// one is configured via env vars. Free users clicking "Open in DK"
// earn us the deposit CPA without any sub commitment.
//
// To activate: add NEXT_PUBLIC_AFFILIATE_<BOOK> to Vercel env.
// Falls back to plain deep links when no code is set.
// ──────────────────────────────────────────────────────────

// Sport-aware deep link URLs (web; app schemes intentionally omitted —
// most users open web and the book's site handles app-handoff).
const DEEP_LINKS: Record<string, { mlb: string; nba: string }> = {
  draftkings: {
    mlb: "https://sportsbook.draftkings.com/leagues/baseball/mlb",
    nba: "https://sportsbook.draftkings.com/leagues/basketball/nba",
  },
  fanduel: {
    mlb: "https://sportsbook.fanduel.com/baseball/mlb",
    nba: "https://sportsbook.fanduel.com/basketball/nba",
  },
  betmgm: {
    mlb: "https://sports.betmgm.com/en/sports/baseball-23/betting/usa-9/mlb-75",
    nba: "https://sports.betmgm.com/en/sports/basketball-7/betting/usa-9/nba-6004",
  },
  fanatics: {
    mlb: "https://sportsbook.fanatics.com/baseball/mlb",
    nba: "https://sportsbook.fanatics.com/basketball/nba",
  },
  hardrockbet: {
    mlb: "https://app.hardrock.bet/sports/baseball/mlb",
    nba: "https://app.hardrock.bet/sports/basketball/nba",
  },
  betrivers: {
    mlb: "https://www.betrivers.com/sports/baseball/mlb",
    nba: "https://www.betrivers.com/sports/basketball/nba",
  },
  espnbet: {
    mlb: "https://espnbet.com/sport/baseball/organization/mlb",
    nba: "https://espnbet.com/sport/basketball/organization/nba",
  },
  pointsbetus: {
    mlb: "https://www.pointsbet.com/sports/baseball/MLB",
    nba: "https://www.pointsbet.com/sports/basketball/NBA",
  },
  bovada: {
    mlb: "https://www.bovada.lv/sports/baseball/mlb",
    nba: "https://www.bovada.lv/sports/basketball/nba",
  },
  williamhill_us: {
    mlb: "https://www.caesars.com/sportsbook-and-casino/sports/baseball/mlb",
    nba: "https://www.caesars.com/sportsbook-and-casino/sports/basketball/nba",
  },
};

// Which query-param each book uses for affiliate attribution
const AFFILIATE_PARAM: Record<string, string> = {
  draftkings: "wpsrc",
  fanduel: "btag",
  betmgm: "wm",
  fanatics: "btag",
  hardrockbet: "btag",
  betrivers: "btag",
  espnbet: "btag",
  pointsbetus: "btag",
  bovada: "btag",
  williamhill_us: "ref",
};

// Read the affiliate code for a given book from env
function getAffiliateCode(book: string): string | undefined {
  if (typeof process === "undefined") return undefined;
  const upper = book.toUpperCase();
  return process.env[`NEXT_PUBLIC_AFFILIATE_${upper}`];
}

function appendAffiliate(url: string, book: string, extra?: { ev?: number }): string {
  if (!url) return url;
  const code = getAffiliateCode(book);
  if (!code) return url; // not configured; return plain link
  const param = AFFILIATE_PARAM[book] ?? "btag";
  const joiner = url.includes("?") ? "&" : "?";
  const evTag = extra?.ev != null ? `&dq_ev=${Math.round(extra.ev * 10) / 10}` : "";
  return `${url}${joiner}${param}=${encodeURIComponent(code)}${evTag}`;
}

function resolveBookKey(bookmakerKey: string): string {
  const key = bookmakerKey.toLowerCase().replace(/\s+/g, "");
  if (DEEP_LINKS[key]) return key;
  for (const k of Object.keys(DEEP_LINKS)) {
    if (key.includes(k) || k.includes(key)) return k;
  }
  const nameMap: Record<string, string> = {
    "draftkings": "draftkings", "fanduel": "fanduel", "betmgm": "betmgm",
    "fanatics": "fanatics", "hardrock": "hardrockbet", "betrivers": "betrivers",
    "espnbet": "espnbet", "pointsbet": "pointsbetus", "bovada": "bovada",
    "caesars": "williamhill_us", "williamhill": "williamhill_us",
  };
  for (const [name, k] of Object.entries(nameMap)) {
    if (key.includes(name)) return k;
  }
  return "";
}

/**
 * Get a deep link to a sportsbook.
 * - Defaults to MLB section (maintains backward compat with existing callers)
 * - Pass `sport` to direct to the correct sport's landing page
 * - Appends affiliate code automatically when NEXT_PUBLIC_AFFILIATE_<BOOK> is set
 */
export function getDeepLink(
  bookmakerKey: string,
  opts?: { sport?: "mlb" | "nba"; ev?: number }
): string {
  const bookKey = resolveBookKey(bookmakerKey);
  if (!bookKey) return "";
  const sport = opts?.sport ?? "mlb";
  const base = DEEP_LINKS[bookKey]?.[sport] ?? DEEP_LINKS[bookKey]?.mlb ?? "";
  return appendAffiliate(base, bookKey, { ev: opts?.ev });
}

// ──────────────────────────────────────────────────────────
// Dead Line / Suspicious Edge Detection
// ──────────────────────────────────────────────────────────

export interface EdgeValidation {
  isValid: boolean;
  isSuspicious: boolean;
  reason?: string;
  adjustedEV?: number;
}

// Validate if an edge is real or likely a dead/stale line
export function validateEdge(
  evPercentage: number,
  odds: number,
  bookmaker: string,
  allOddsForMarket: number[] // odds from all books for same side
): EdgeValidation {
  // Rule 1: Any edge over 12% is almost certainly a dead line
  if (evPercentage > 12) {
    return {
      isValid: false,
      isSuspicious: true,
      reason: `${evPercentage.toFixed(1)}% edge is likely a stale/dead line — too good to be true`,
      adjustedEV: 0,
    };
  }

  // Rule 2: Edge over 10% — flag as suspicious but show it
  if (evPercentage > 10) {
    return {
      isValid: true,
      isSuspicious: true,
      reason: `Large ${evPercentage.toFixed(1)}% edge — verify line is still live on ${bookmaker} before betting`,
    };
  }

  // Rule 3: Odds are wildly different from other books (>50% off market)
  if (allOddsForMarket.length >= 2) {
    const avgOdds = allOddsForMarket.reduce((a, b) => a + b, 0) / allOddsForMarket.length;
    const deviation = Math.abs(odds - avgOdds);
    if (deviation > 100) { // More than 100 points off market average
      return {
        isValid: true,
        isSuspicious: true,
        reason: `${bookmaker} is ${deviation.toFixed(0)} points off market average — may be a lagging line`,
      };
    }
  }

  // Rule 4: Extreme odds (>+5000 or <-5000) are often garbage/final game state
  if (Math.abs(odds) > 5000) {
    return {
      isValid: false,
      isSuspicious: true,
      reason: "Extreme odds — likely a game in progress or already decided",
    };
  }

  return { isValid: true, isSuspicious: false };
}

// Filter arb opportunities for real ones (anything over 5% is almost always a dead line)
export function filterRealArbs(arbs: any[]): any[] {
  return arbs.filter((arb) => {
    // Reject arbs with >5% profit (almost always dead/stale lines)
    if (arb.profit > 5) return false;
    // Reject arbs with extreme odds on either side
    if (Math.abs(arb.side1.odds) > 3000 || Math.abs(arb.side2.odds) > 3000) return false;
    return true;
  });
}

// Filter EV bets for realistic ones
export function filterRealEV(evBets: any[]): any[] {
  return evBets.filter((bet) => {
    if (bet.evPercentage > 15) return false;
    if (Math.abs(bet.odds) > 5000) return false;
    return true;
  }).map((bet) => ({
    ...bet,
    isSuspicious: bet.evPercentage > 10,
    warning: bet.evPercentage > 10 ? "Verify line is still live" : undefined,
  }));
}

// ──────────────────────────────────────────────────────────
// Discord Webhook
// ──────────────────────────────────────────────────────────

export async function sendDiscordAlert(webhookUrl: string, message: {
  title: string;
  description: string;
  color: number; // decimal color
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
}) {
  if (!webhookUrl) return;

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [{
          title: message.title,
          description: message.description,
          color: message.color,
          fields: message.fields,
          footer: { text: "Diamond-Quant Live" },
          timestamp: new Date().toISOString(),
        }],
      }),
    });
  } catch (err) {
    console.error("Discord webhook error:", err);
  }
}
