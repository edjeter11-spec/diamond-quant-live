import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const { emoji } = await req.json();
    if (!emoji || !["fire", "skull"].includes(emoji)) {
      return NextResponse.json({ error: "Invalid reaction" }, { status: 400 });
    }

    // Get current reactions
    const { data } = await supabase
      .from("shared_slips")
      .select("reactions")
      .eq("id", id)
      .single();

    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const reactions = (data.reactions as Record<string, number>) ?? {};
    reactions[emoji] = (reactions[emoji] ?? 0) + 1;

    await supabase.from("shared_slips").update({ reactions }).eq("id", id);

    return NextResponse.json({ reactions });
  } catch {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
