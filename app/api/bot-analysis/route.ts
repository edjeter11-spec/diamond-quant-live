import { NextResponse } from "next/server";
import { analyzeAllGames } from "@/lib/bot/three-models";
import { getCached, setCache } from "@/lib/odds/server-cache";

// Fresh data — short cache
export const dynamic = "force-dynamic";

export async function GET() {
  // Check cache (2 min for bot analysis)
  const cached = getCached("bot_analysis", 120_000);
  if (cached) return NextResponse.json(cached);

  try {
    // Fetch fresh odds + scores in parallel
    const [oddsRes, scoresRes] = await Promise.all([
      fetch(`${getBaseUrl()}/api/odds`).then(r => r.json()).catch(() => ({ games: [] })),
      fetch(`${getBaseUrl()}/api/scores`).then(r => r.json()).catch(() => ({ games: [] })),
    ]);

    const analyses = await analyzeAllGames(oddsRes.games ?? [], scoresRes.games ?? []);

    const response = {
      analyses,
      timestamp: new Date().toISOString(),
      gamesAnalyzed: analyses.length,
      highConfidence: analyses.filter(a => a.consensus.confidence === "HIGH").length,
      disagreements: analyses.filter(a => !a.consensus.modelsAgree).length,
    };

    setCache("bot_analysis", response);
    return NextResponse.json(response);
  } catch (error: any) {
    console.error("Bot analysis error:", error);
    return NextResponse.json({ error: error.message, analyses: [] }, { status: 500 });
  }
}

function getBaseUrl(): string {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}
