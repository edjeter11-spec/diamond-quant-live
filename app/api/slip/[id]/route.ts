import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const key = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ slip: null, error: "Supabase not configured" }, { status: 503 });

  try {
    const { data, error } = await supabase
      .from("shared_slips")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) {
      return NextResponse.json({ slip: null, error: "Not found" }, { status: 404 });
    }

    // Increment views
    await supabase.from("shared_slips").update({ views: (data.views ?? 0) + 1 }).eq("id", id);

    return NextResponse.json({ slip: data });
  } catch {
    return NextResponse.json({ slip: null, error: "Failed" }, { status: 500 });
  }
}
