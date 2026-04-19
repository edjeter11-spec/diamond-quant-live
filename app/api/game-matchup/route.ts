import { NextResponse } from "next/server";
import { getRestState, computeRestEdge } from "@/lib/nba/rest-fatigue";
import { getTeamInjuries } from "@/lib/nba/injuries";
import { projectGameTotal, getTeamRating } from "@/lib/nba/pace-ratings";

export const revalidate = 600;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const home = (searchParams.get("home") || "").toUpperCase();
  const away = (searchParams.get("away") || "").toUpperCase();
  if (!home || !away) {
    return NextResponse.json({ error: "home + away required" }, { status: 400 });
  }

  try {
    const [homeRest, awayRest, homeInj, awayInj] = await Promise.all([
      getRestState(home),
      getRestState(away),
      getTeamInjuries(home),
      getTeamInjuries(away),
    ]);

    const restEdge = computeRestEdge(homeRest, awayRest);
    const totalProj = projectGameTotal(home, away);
    const homeRating = getTeamRating(home);
    const awayRating = getTeamRating(away);
    const netGap = homeRating.netRating - awayRating.netRating;

    const impactfulOuts = (list: typeof homeInj) =>
      list.filter((p) => p.status === "Out" || p.status === "Doubtful");

    const takeaways: string[] = [];
    if (Math.abs(restEdge.edge) >= 1.0) {
      takeaways.push(
        restEdge.edge > 0
          ? `Rest edge ${home} +${restEdge.edge.toFixed(1)} pts`
          : `Rest edge ${away} +${Math.abs(restEdge.edge).toFixed(1)} pts`,
      );
    }
    if (Math.abs(netGap) >= 4) {
      takeaways.push(
        netGap > 0
          ? `${home} +${netGap.toFixed(1)} net rating advantage`
          : `${away} +${Math.abs(netGap).toFixed(1)} net rating advantage`,
      );
    }
    const homeOuts = impactfulOuts(homeInj);
    const awayOuts = impactfulOuts(awayInj);
    if (homeOuts.length > 0) takeaways.push(`${home} missing ${homeOuts.length} (${homeOuts.slice(0, 2).map(p => p.name.split(" ").pop()).join(", ")})`);
    if (awayOuts.length > 0) takeaways.push(`${away} missing ${awayOuts.length} (${awayOuts.slice(0, 2).map(p => p.name.split(" ").pop()).join(", ")})`);
    if (totalProj.paceNote) takeaways.push(totalProj.paceNote);

    return NextResponse.json({
      home,
      away,
      rest: { home: homeRest, away: awayRest, edge: restEdge.edge, factors: restEdge.factors },
      injuries: { home: homeInj, away: awayInj },
      ratings: { home: homeRating, away: awayRating, netGap: Math.round(netGap * 10) / 10 },
      total: totalProj,
      takeaways,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "failed" }, { status: 500 });
  }
}
