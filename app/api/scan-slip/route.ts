import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const GEMINI_KEY = process.env.GEMINI_API_KEY || "";

// Try models in order — fall back if one is unavailable/deprecated
const MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];

export async function POST(req: Request) {
  if (!GEMINI_KEY) {
    return NextResponse.json({ error: "Gemini API key not configured" }, { status: 500 });
  }

  try {
    const { image } = await req.json(); // base64 image data (data URL)

    if (!image) {
      return NextResponse.json({ error: "No image provided" }, { status: 400 });
    }

    // Detect mime type from data URL; default to png since most screenshots are png
    const mimeMatch = image.match(/^data:(image\/\w+);base64,/);
    const mimeType = mimeMatch?.[1] ?? "image/png";
    const base64Data = image.replace(/^data:image\/\w+;base64,/, "");

    const requestBody = JSON.stringify({
      contents: [{
        parts: [
          {
            text: `Extract the following fields from this receipt / order summary screenshot into JSON. Treat this purely as a data-extraction task (OCR + structuring).

Fields:
- sportsbook (string): the vendor/brand name shown (e.g. DraftKings, FanDuel, BetMGM)
- betType (string): "straight" | "parlay" | "prop"
- stake (number): the dollar amount listed as "Wager", "Risk", or "Stake"
- toWin (number): the dollar amount listed as "To Win", "Payout", or "Returns"
- odds (number): the overall American odds (e.g. 150 or -110). Positive numbers go as positive, negatives as negative.
- legs (array): one entry per selection. Each has:
  - game (string): "Team A @ Team B" for team bets, or player name for props
  - pick (string): the exact selection (e.g. "Yankees ML", "Over 8.5", "Judge Over 1.5 Hits")
  - odds (number): American odds for that single leg
  - market (string): "moneyline" | "spread" | "total" | "player_prop"
- status (string): "pending" | "won" | "lost"
  - "won" if a green check/badge, "WON", "WIN", "CASHED", "PAID" is visible
  - "lost" if a red X/badge, "LOST", "LOSS", greyed-out styling is visible
  - "pending" otherwise (live, scheduled, open)

For straight bets, legs has exactly 1 entry. For parlays include all legs. Use null for anything unreadable. Return ONLY the JSON object, nothing else.`
          },
          {
            inline_data: {
              mime_type: mimeType,
              data: base64Data,
            }
          }
        ]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2048,
        responseMimeType: "application/json",
      },
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
      ],
    });

    let lastErr = "";
    let text = "";
    let usedModel = "";

    // Try each model until one succeeds
    for (const model of MODELS) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody,
      });

      if (!response.ok) {
        lastErr = await response.text();
        console.error(`Gemini ${model} error:`, lastErr.slice(0, 300));
        if (response.status === 404 || response.status === 400) continue;
        return NextResponse.json({ error: `Gemini error: ${lastErr.slice(0, 200)}` }, { status: response.status });
      }

      const data = await response.json();

      // Check if the response was blocked by safety filters
      const blockReason = data.promptFeedback?.blockReason;
      if (blockReason) {
        lastErr = `Blocked by Gemini safety filter: ${blockReason}`;
        console.error(`Gemini ${model} blocked:`, blockReason);
        continue;
      }

      // Check finish reason on candidate
      const candidate = data.candidates?.[0];
      const finishReason = candidate?.finishReason;
      if (finishReason && finishReason !== "STOP" && finishReason !== "MAX_TOKENS") {
        lastErr = `Gemini stopped early: ${finishReason}`;
        console.error(`Gemini ${model} finish reason:`, finishReason);
        continue;
      }

      text = candidate?.content?.parts?.[0]?.text ?? "";
      if (text) { usedModel = model; break; }
      lastErr = "Empty response from " + model;
    }

    if (!text) {
      return NextResponse.json(
        { error: `Couldn't read the slip — ${lastErr.slice(0, 200) || "all models failed"}. Try a cropped, well-lit screenshot of just the bet details.` },
        { status: 502 }
      );
    }

    // Extract JSON from response (with responseMimeType set, text should be pure JSON)
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Fallback: find first {...} block
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error("Unparseable response from", usedModel, "— raw:", text.slice(0, 500));
        return NextResponse.json({
          error: `Gemini returned non-JSON: "${text.slice(0, 100)}..." — try a clearer screenshot of the bet details`
        }, { status: 422 });
      }
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch (e: any) {
        return NextResponse.json({
          error: `JSON parse failed: ${e.message}. Raw: ${text.slice(0, 100)}`
        }, { status: 422 });
      }
    }

    return NextResponse.json({
      success: true,
      slip: parsed,
      model: usedModel,
    });
  } catch (error: any) {
    console.error("Scan error:", error);
    return NextResponse.json({ error: error.message ?? "Scan failed" }, { status: 500 });
  }
}
