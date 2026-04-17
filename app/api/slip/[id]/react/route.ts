import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, isAllowedOrigin } from "@/lib/supabase/server-auth";

// Crude per-process rate limit (best-effort; reset on deploy)
const recentHits = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;

function rateOk(key: string): boolean {
  const now = Date.now();
  const arr = (recentHits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= MAX_PER_WINDOW) return false;
  arr.push(now);
  recentHits.set(key, arr);
  return true;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAllowedOrigin(req)) {
    return NextResponse.json({ error: "Forbidden origin" }, { status: 403 });
  }
  if (!supabaseAdmin) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  const { id } = await params;
  if (!id || id.length > 32) {
    return NextResponse.json({ error: "Invalid slip id" }, { status: 400 });
  }

  // Per-IP+slip rate limit
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!rateOk(`${ip}:${id}`)) {
    return NextResponse.json({ error: "Too many reactions" }, { status: 429 });
  }

  try {
    const { emoji } = await req.json();
    if (!emoji || !["fire", "skull"].includes(emoji)) {
      return NextResponse.json({ error: "Invalid reaction" }, { status: 400 });
    }

    const { data } = await supabaseAdmin
      .from("shared_slips")
      .select("reactions")
      .eq("id", id)
      .single();

    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const reactions = (data.reactions as Record<string, number>) ?? {};
    reactions[emoji] = Math.min((reactions[emoji] ?? 0) + 1, 999_999);

    await supabaseAdmin.from("shared_slips").update({ reactions }).eq("id", id);

    return NextResponse.json({ reactions });
  } catch {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
