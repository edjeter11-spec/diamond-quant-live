import { NextRequest, NextResponse } from "next/server";
import { fetchNBAInjuries } from "@/lib/nba/injuries";
import { getCached, setCache } from "@/lib/odds/server-cache";

export const dynamic = "force-dynamic";
export const revalidate = 300;

interface NewsItem {
  type: "injury" | "lineup" | "trade" | "general";
  player: string;
  team: string;
  status?: string;
  description: string;
  timestamp: string;
  priority: number; // higher = more important
}

// ESPN news feed for NBA — public, no auth
async function fetchESPNNews(): Promise<NewsItem[]> {
  try {
    const res = await fetch(
      "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/news?limit=30",
      { next: { revalidate: 300 } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const articles = (data.articles ?? []) as any[];
    return articles.map((a) => ({
      type: "general" as const,
      player: a.headline ?? "",
      team: "",
      description: a.description ?? "",
      timestamp: a.published ?? a.lastModified ?? new Date().toISOString(),
      priority: a.headline?.toLowerCase().includes("injury") ? 8 : 3,
    }));
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const cached = getCached("nba_news_combined", 300_000);
  if (cached) return NextResponse.json(cached);

  try {
    const [injuryReports, espnNews] = await Promise.all([
      fetchNBAInjuries().catch(() => []),
      fetchESPNNews(),
    ]);

    // Convert injuries → news items
    const injuryItems: NewsItem[] = [];
    for (const team of injuryReports) {
      for (const p of team.players) {
        const priority = p.status === "Out" ? 10 : p.status === "Doubtful" ? 8 : p.status === "Questionable" ? 5 : 3;
        injuryItems.push({
          type: "injury",
          player: p.name,
          team: team.team,
          status: p.status,
          description: (p as any).description ?? `${p.status} for ${team.team}`,
          timestamp: new Date().toISOString(),
          priority,
        });
      }
    }

    // Combine + sort by priority (high first), then by recency
    const all = [...injuryItems, ...espnNews]
      .sort((a, b) => b.priority - a.priority || (new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()))
      .slice(0, 50);

    const response = {
      ok: true,
      items: all,
      counts: {
        out: injuryItems.filter(i => i.status === "Out").length,
        doubtful: injuryItems.filter(i => i.status === "Doubtful").length,
        questionable: injuryItems.filter(i => i.status === "Questionable").length,
        general: espnNews.length,
      },
      generatedAt: new Date().toISOString(),
    };

    setCache("nba_news_combined", response);
    return NextResponse.json(response);
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message, items: [] });
  }
}
