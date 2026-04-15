import { NextResponse } from "next/server";
import { getCached, setCache } from "@/lib/odds/server-cache";

const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const homeTeam = searchParams.get("home") ?? "";
  const awayTeam = searchParams.get("away") ?? "";
  const sport = searchParams.get("sport") ?? "mlb";
  const homePitcher = searchParams.get("homePitcher") ?? "";
  const awayPitcher = searchParams.get("awayPitcher") ?? "";
  const homeOdds = searchParams.get("homeOdds") ?? "";
  const awayOdds = searchParams.get("awayOdds") ?? "";
  const total = searchParams.get("total") ?? "";

  if (!homeTeam || !awayTeam) {
    return NextResponse.json({ error: "Teams required" }, { status: 400 });
  }

  // Cache for 30 min per game
  const cacheKey = `summary_${sport}_${awayTeam}_${homeTeam}`.replace(/\s/g, "_");
  const cached = getCached(cacheKey, 1800_000);
  if (cached) return NextResponse.json(cached);

  if (!GEMINI_KEY) {
    return NextResponse.json({
      summary: `${awayTeam} @ ${homeTeam}. Odds: ${awayOdds} / ${homeOdds}. Total: ${total}.`,
      source: "fallback",
    });
  }

  try {
    const sportContext = sport === "nba"
      ? "NBA basketball game. Consider pace, defensive efficiency, rest days, home court advantage (~60% in NBA), and recent form."
      : `MLB baseball game. Starting pitchers: ${awayPitcher} vs ${homePitcher}. Consider pitcher matchups, bullpen strength, park factors, and recent form.`;

    const prompt = `You are a sharp sports betting analyst. Give a 2-3 sentence analysis of this ${sportContext}

Game: ${awayTeam} @ ${homeTeam}
${sport === "mlb" ? `Pitchers: ${awayPitcher} vs ${homePitcher}` : ""}
Odds: ${awayTeam} ${awayOdds} / ${homeTeam} ${homeOdds}
${total ? `Total: ${total}` : ""}

Be specific. Mention one key stat, matchup edge, or trend. End with a lean (which side has value). Keep it under 60 words. No fluff.`;

    const response = await fetch(`${GEMINI_URL}?key=${GEMINI_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 150 },
      }),
    });

    if (!response.ok) {
      return NextResponse.json({
        summary: `${awayTeam} @ ${homeTeam}. ${sport === "mlb" ? `${awayPitcher} vs ${homePitcher}.` : ""} Line: ${homeOdds}.`,
        source: "fallback",
      });
    }

    const data = await response.json();
    const summary = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";

    const result = { summary, source: "gemini" };
    setCache(cacheKey, result);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({
      summary: `${awayTeam} @ ${homeTeam}. Analyzing matchup...`,
      source: "fallback",
    });
  }
}
