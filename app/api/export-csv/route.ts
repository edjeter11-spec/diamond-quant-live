import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const revalidate = 0;

const supabase = (() => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  return url && key ? createClient(url, key) : null;
})();

function toCSV(rows: Record<string, any>[], headers: string[]): string {
  const escape = (v: any) => {
    const s = v == null ? "" : String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(","));
  }
  return lines.join("\r\n");
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") || "bets"; // 'bets' | 'movements'
  const sport = searchParams.get("sport") || "baseball_mlb";

  let csv = "";
  let filename = "";

  if (type === "movements") {
    if (!supabase) {
      return new NextResponse("Database unavailable", { status: 503 });
    }
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from("odds_history")
      .select("*")
      .eq("sport", sport)
      .gte("captured_at", since)
      .order("captured_at", { ascending: false })
      .limit(1000);

    const rows = (data ?? []).map((r) => ({
      captured_at: r.captured_at,
      sport: r.sport,
      game: `${r.away_team} @ ${r.home_team}`,
      bookmaker: r.bookmaker,
      market: r.market,
      home_price: r.home_price ?? "",
      away_price: r.away_price ?? "",
      spread: r.spread ?? "",
      total: r.total ?? "",
    }));

    const headers = ["captured_at", "sport", "game", "bookmaker", "market", "home_price", "away_price", "spread", "total"];
    csv = toCSV(rows, headers);
    filename = `sharp_movements_${sport}_${new Date().toISOString().slice(0, 10)}.csv`;
  } else {
    // bet history — passed as query param (client-side only data)
    const rawBets = searchParams.get("bets");
    if (!rawBets) {
      return new NextResponse("No bet data provided", { status: 400 });
    }
    let bets: any[] = [];
    try {
      bets = JSON.parse(decodeURIComponent(rawBets));
    } catch {
      return new NextResponse("Invalid bet data", { status: 400 });
    }

    const rows = bets.map((b: any) => ({
      timestamp: b.timestamp ?? "",
      game: b.game ?? "",
      pick: b.pick ?? "",
      market: b.market ?? "",
      odds: b.odds ?? "",
      stake: b.stake ?? "",
      result: b.result ?? "pending",
      payout: b.payout ?? "",
      ev_at_placement: b.evAtPlacement ?? "",
      bookmaker: b.bookmaker ?? "",
    }));

    const headers = ["timestamp", "game", "pick", "market", "odds", "stake", "result", "payout", "ev_at_placement", "bookmaker"];
    csv = toCSV(rows, headers);
    filename = `bet_history_${new Date().toISOString().slice(0, 10)}.csv`;
  }

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
