import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

export async function POST(req: Request) {
  if (!GEMINI_KEY) {
    return NextResponse.json({ error: "Gemini API key not configured" }, { status: 500 });
  }

  try {
    const { image } = await req.json(); // base64 image data

    if (!image) {
      return NextResponse.json({ error: "No image provided" }, { status: 400 });
    }

    // Strip data URL prefix if present
    const base64Data = image.replace(/^data:image\/\w+;base64,/, "");

    const response = await fetch(`${GEMINI_URL}?key=${GEMINI_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            {
              text: `You are a sports betting slip reader. Extract ALL information from this betting slip screenshot. Return ONLY valid JSON with this exact structure, no other text:

{
  "sportsbook": "the sportsbook name (DraftKings, FanDuel, BetMGM, etc.)",
  "betType": "straight" or "parlay" or "prop",
  "stake": the dollar amount risked as a number,
  "toWin": the potential payout as a number,
  "odds": the American odds as a number (e.g. +150 or -110),
  "legs": [
    {
      "game": "Team A @ Team B" or "Player Name",
      "pick": "the specific pick (e.g. Yankees ML, Over 8.5, Judge Over 1.5 Hits)",
      "odds": American odds for this leg as a number,
      "market": "moneyline" or "spread" or "total" or "player_prop"
    }
  ],
  "status": "pending" or "won" or "lost"
}

If it's a straight bet, legs should have exactly 1 entry. For parlays, include all legs. Extract exact odds, teams, and amounts.

For "status": carefully determine if the bet has already been settled:
- Return "won" if you see a green badge/icon, checkmark, "WON", "WIN", "CASHED", "PAID", or the amount shown as a credit/profit with a green color
- Return "lost" if you see a red badge/icon, X mark, "LOST", "LOSS", "SETTLED - LOSS", or greyed-out/strikethrough styling
- Return "pending" if you see "PENDING", "LIVE", "OPEN", "ACTIVE", no result indicator, or the games haven't played

If you can't read something, use null.`
            },
            {
              inline_data: {
                mime_type: "image/jpeg",
                data: base64Data,
              }
            }
          ]
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 1024,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini error:", errText);
      return NextResponse.json({ error: "Gemini API error" }, { status: 500 });
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    // Extract JSON from response (Gemini sometimes wraps in markdown)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: "Could not parse bet slip", raw: text }, { status: 422 });
    }

    const parsed = JSON.parse(jsonMatch[0]);

    return NextResponse.json({
      success: true,
      slip: parsed,
    });
  } catch (error: any) {
    console.error("Scan error:", error);
    return NextResponse.json({ error: error.message ?? "Scan failed" }, { status: 500 });
  }
}
