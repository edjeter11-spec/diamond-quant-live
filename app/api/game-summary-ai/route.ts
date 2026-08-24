// ──────────────────────────────────────────────────────────
// AI GAME SUMMARY — Gemini-powered 2-3 sentence game previews
// Incorporates 3-model consensus, pitcher matchup, and recent form
// Cached server-side per game; client also caches in localStorage
// ──────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getCached, setCache } from "@/lib/odds/server-cache";
import { isAllowedOrigin } from "@/lib/supabase/server-auth";
import { checkIpRateLimit } from "@/lib/ip-rate-limit";

const GEMINI_KEY = process.env.GEMINI_API_KEY ?? "";
// gemini-2.0-flash was RETIRED by Google (404s as of Aug 2026), which made
// this route silently return {summary:null} on every call — the client
// hides the section on null, so game previews just vanished with no error
// anywhere. 3.6-flash thinking tokens count against maxOutputTokens, hence
// the larger budget for the same 2-3 sentence output.
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Guards: this route calls Gemini and the cache key is caller-controlled
  // (`gameId ?? game`), so an attacker can trivially force cache misses.
  // Origin check blocks off-site loops; IP rate-limit blocks single-source
  // hammering. Nothing here should block a real user — the site pings this
  // maybe a few times per game view.
  if (!isAllowedOrigin(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const rl = checkIpRateLimit(req, {
    limit: 30,
    windowMs: 60_000,
    key: "game-summary-ai",
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "rate limited" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
      },
    );
  }

  const body = await req.json().catch(() => null);
  if (!body)
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const { game, reasoning, history, aiTip, gameId } = body as {
    game?: string;
    reasoning?: string[];
    history?: string[];
    aiTip?: string;
    gameId?: string;
  };

  if (!game)
    return NextResponse.json({ error: "game required" }, { status: 400 });

  // Server-side cache: 30 min per game
  const today = new Date().toISOString().split("T")[0];
  const cacheKey = `ai_summary_${(gameId ?? game).replace(/\s/g, "_")}_${today}`;
  const cached = getCached(cacheKey, 1_800_000);
  if (cached) return NextResponse.json(cached);

  // Graceful degradation: if no API key, return null (client hides the section)
  if (!GEMINI_KEY) {
    return NextResponse.json({ summary: null, source: "unavailable" });
  }

  // Build a rich, focused prompt
  const reasoningText = reasoning?.filter(Boolean).join("\n• ") ?? "";
  const historyText = history?.filter(Boolean).join("\n• ") ?? "";

  const prompt = `You are a sharp sports betting analyst providing a concise game preview. Write exactly 2-3 sentences.

Game: ${game}
3-Model Analysis: ${aiTip ?? ""}
Key Factors:
• ${reasoningText}
Context:
• ${historyText}

Write a 2-3 sentence preview that: (1) highlights the most important matchup factor, (2) mentions recent form or a key stat, and (3) states which side has the edge and why. Be specific and analytical. No fluff. Under 80 words.`;

  try {
    const response = await fetch(`${GEMINI_URL}?key=${GEMINI_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.65, maxOutputTokens: 700 },
      }),
    });

    if (!response.ok) {
      return NextResponse.json({ summary: null, source: "error" });
    }

    const data = await response.json();
    const summary: string | null =
      data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;

    if (!summary) return NextResponse.json({ summary: null, source: "empty" });

    const result = { summary, source: "gemini" };
    setCache(cacheKey, result);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ summary: null, source: "error" });
  }
}
