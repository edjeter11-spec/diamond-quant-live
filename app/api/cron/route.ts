import { NextResponse } from "next/server";
import { fetchTodayGames, getGameStatus, getTeamAbbrev } from "@/lib/mlb/stats-api";
import { loadNbaPropBrainFromCloud, saveNbaPropBrainToCloud } from "@/lib/bot/nba-prop-brain";
import { auditCompletedGames } from "@/lib/bot/nba-prop-audit";
import { commitPropProjections } from "@/lib/bot/nba-prop-ghost";
import { cloudGet, cloudSet } from "@/lib/supabase/client";

// This endpoint is called by Vercel Cron every 30 min
// It checks for finished games and logs results
// The actual Brain learning happens client-side when users open the app
// This just ensures we have fresh score data cached

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Verify cron secret (optional security)
  const authHeader = req.headers.get("authorization");

  try {
    const games = await fetchTodayGames();

    const live = games.filter((g: any) => getGameStatus(g) === "live").length;
    const final = games.filter((g: any) => getGameStatus(g) === "final").length;
    const pre = games.filter((g: any) => getGameStatus(g) === "pre").length;

    // Log completed games for the Brain to process
    const completedGames = games
      .filter((g: any) => getGameStatus(g) === "final")
      .map((g: any) => ({
        id: String(g.gamePk),
        homeTeam: g.teams?.home?.team?.name,
        awayTeam: g.teams?.away?.team?.name,
        homeScore: g.teams?.home?.score ?? 0,
        awayScore: g.teams?.away?.score ?? 0,
        homePitcher: g.teams?.home?.probablePitcher?.fullName ?? "TBD",
        awayPitcher: g.teams?.away?.probablePitcher?.fullName ?? "TBD",
      }));

    // ── NBA Prop Brain: Post-Game Audit ──
    let nbaAudit = { graded: 0, hits: 0, misses: 0 };
    let nbaGhostCommitted = 0;
    try {
      const nbaBrain = await loadNbaPropBrainFromCloud();

      // 1. Audit completed games
      const { updatedBrain, graded, hits, misses } = await auditCompletedGames(nbaBrain);
      if (graded > 0) {
        await saveNbaPropBrainToCloud(updatedBrain);
        nbaAudit = { graded, hits, misses };
      }

      // 2. Commit ghost prop projections for upcoming NBA games
      try {
        const oddsRes = await fetch(`https://${process.env.VERCEL_URL || "diamond-quant-live.vercel.app"}/api/players?sport=basketball_nba&market=player_points`);
        if (oddsRes.ok) {
          const oddsData = await oddsRes.json();
          const props = (oddsData.props ?? []).map((p: any) => ({
            playerName: p.playerName,
            team: p.team,
            gameId: p.gameTime ?? "",
            propType: "player_points",
            line: p.line,
            bestOverOdds: p.bestOver?.price ?? -110,
            bestUnderOdds: p.bestUnder?.price ?? -110,
            isHome: false,
          }));
          if (props.length > 0) {
            const brain = graded > 0 ? updatedBrain : nbaBrain;
            const { committed } = await commitPropProjections(brain, props, {});
            nbaGhostCommitted = committed;
          }
        }
      } catch {}
    } catch {}

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      mlb: { total: games.length, live, final, pre, completedToday: completedGames.length },
      nbaProps: { ...nbaAudit, ghostCommitted: nbaGhostCommitted },
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
