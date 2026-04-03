// ──────────────────────────────────────────────────────────
// Sportsbook Deep Links + Dead Line Detection
// ──────────────────────────────────────────────────────────

// Deep link URLs for each sportsbook
// These open the sportsbook's app or website to the MLB section
const DEEP_LINKS: Record<string, { web: string; app?: string }> = {
  draftkings: {
    web: "https://sportsbook.draftkings.com/leagues/baseball/mlb",
    app: "draftkings://sportsbook/leagues/baseball/mlb",
  },
  fanduel: {
    web: "https://sportsbook.fanduel.com/baseball/mlb",
    app: "fanduel://sportsbook/baseball/mlb",
  },
  betmgm: {
    web: "https://sports.betmgm.com/en/sports/baseball-23/betting/usa-9/mlb-75",
    app: "betmgm://sports/baseball",
  },
  fanatics: {
    web: "https://sportsbook.fanatics.com/baseball/mlb",
  },
  hardrockbet: {
    web: "https://app.hardrock.bet/sports/baseball/mlb",
  },
  betrivers: {
    web: "https://www.betrivers.com/sports/baseball/mlb",
  },
  espnbet: {
    web: "https://espnbet.com/sport/baseball/organization/mlb",
  },
  pointsbetus: {
    web: "https://www.pointsbet.com/sports/baseball/MLB",
  },
  bovada: {
    web: "https://www.bovada.lv/sports/baseball/mlb",
  },
  williamhill_us: {
    web: "https://www.caesars.com/sportsbook-and-casino/sports/baseball/mlb",
  },
};

export function getDeepLink(bookmakerKey: string): string {
  const key = bookmakerKey.toLowerCase().replace(/\s+/g, "");
  // Try exact match first
  const match = DEEP_LINKS[key];
  if (match) return match.web;

  // Try partial match
  for (const [k, v] of Object.entries(DEEP_LINKS)) {
    if (key.includes(k) || k.includes(key)) return v.web;
  }

  // Fallback: try to match by display name
  const nameMap: Record<string, string> = {
    "draftkings": "draftkings", "fanduel": "fanduel", "betmgm": "betmgm",
    "fanatics": "fanatics", "hard rock": "hardrockbet", "betrivers": "betrivers",
    "espn bet": "espnbet", "pointsbet": "pointsbetus", "bovada": "bovada",
    "caesars": "williamhill_us",
  };

  for (const [name, k] of Object.entries(nameMap)) {
    if (key.includes(name.replace(/\s/g, ""))) return DEEP_LINKS[k]?.web ?? "";
  }

  return "";
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
  // Rule 1: Any edge over 15% is almost certainly a dead line
  if (evPercentage > 15) {
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

// Filter arb opportunities for real ones
export function filterRealArbs(arbs: any[]): any[] {
  return arbs.filter((arb) => {
    // Reject arbs with >15% profit (dead lines)
    if (arb.profit > 15) return false;
    // Reject arbs with extreme odds on either side
    if (Math.abs(arb.side1.odds) > 5000 || Math.abs(arb.side2.odds) > 5000) return false;
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
