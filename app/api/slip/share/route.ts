import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
);

function generateSlipId(): string {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  let id = "";
  for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { picks, totalOdds, stake, userId, displayName } = body;

    if (!picks || !Array.isArray(picks) || picks.length === 0) {
      return NextResponse.json({ error: "No picks provided" }, { status: 400 });
    }

    const id = generateSlipId();
    const { error } = await supabase.from("shared_slips").insert({
      id,
      user_id: userId,
      slip_data: {
        picks,
        totalOdds,
        stake,
        sharedBy: displayName ?? "Anonymous",
        sharedAt: new Date().toISOString(),
      },
      reactions: {},
      views: 0,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ id, url: `/slip/${id}` });
  } catch {
    return NextResponse.json({ error: "Failed to share slip" }, { status: 500 });
  }
}
