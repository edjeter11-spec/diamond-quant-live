import { NextResponse } from "next/server";
import { fetchNHLInjuries } from "@/lib/nhl/injuries";
import { getCached, setCache } from "@/lib/odds/server-cache";

export const dynamic = "force-dynamic";
export const revalidate = 300;

interface NewsItem {
  type: "injury" | "general";
  player: string;
  team: string;
  status?: string;
  description: string;
  timestamp: string;
  priority: number;
}

async function fetchESPNNHLNews(): Promise<NewsItem[]> {
  try {
    const res = await fetch(
      "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/news?limit=30",
      { next: { revalidate: 300 } },
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.articles ?? []).map((a: any) => ({
      type: "general" as const,
      player: a.headline ?? "",
      team: "",
      description: a.description ?? "",
      timestamp: a.published ?? new Date().toISOString(),
      priority: a.headline?.toLowerCase().includes("injury") ? 8 : 3,
    }));
  } catch {
    return [];
  }
}

export async function GET() {
  const cached = getCached("nhl_news_combined", 300_000);
  if (cached) return NextResponse.json(cached);

  try {
    const [reports, espn] = await Promise.all([
      fetchNHLInjuries().catch(() => []),
      fetchESPNNHLNews(),
    ]);

    const injuryItems: NewsItem[] = [];
    for (const t of reports) {
      for (const p of t.players) {
        const lower = p.status.toLowerCase();
        const priority = lower.includes("out") ? 10 : lower.includes("doubtful") ? 8 : lower.includes("day-to-day") ? 5 : 3;
        injuryItems.push({
          type: "injury",
          player: p.name,
          team: t.team,
          status: p.status,
          description: p.detail ?? `${p.status} for ${t.team}`,
          timestamp: new Date().toISOString(),
          priority,
        });
      }
    }

    const all = [...injuryItems, ...espn]
      .sort((a, b) => b.priority - a.priority || new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 50);

    const response = {
      ok: true,
      items: all,
      counts: {
        out: injuryItems.filter((i) => i.status?.toLowerCase().includes("out")).length,
        doubtful: injuryItems.filter((i) => i.status?.toLowerCase().includes("doubtful")).length,
        dayToDay: injuryItems.filter((i) => i.status?.toLowerCase().includes("day-to-day")).length,
        general: espn.length,
      },
      generatedAt: new Date().toISOString(),
    };

    setCache("nhl_news_combined", response);
    return NextResponse.json(response);
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message ?? "Failed", items: [] });
  }
}
