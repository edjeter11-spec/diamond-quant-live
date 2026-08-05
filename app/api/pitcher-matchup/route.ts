import { NextRequest, NextResponse } from "next/server";
import { fetchSlateContext, type PitcherContext } from "@/lib/mlb/matchup";
import { etDateString } from "@/lib/sports-date";

export const dynamic = "force-dynamic";
export const revalidate = 300;

// ──────────────────────────────────────────────────────────
// PITCHER MATCHUP — public-facing pitcher stats for the game detail modal.
//
// The prop model already computes real pitcher context (era, whip, K/BF,
// platoon splits) via lib/mlb/matchup.ts's fetchSlateContext — it just never
// had a route exposing it to the UI. This is a thin read-only wrapper: same
// slate-wide fetch the model uses, filtered down to the two teams a user
// actually clicked on.
// ──────────────────────────────────────────────────────────

function pitcherPayload(p: PitcherContext | undefined) {
  if (!p) return null;
  return {
    name: p.name,
    throws: p.throws,
    era: Math.round(p.era * 100) / 100,
    whip: Math.round(p.whip * 100) / 100,
    kPerBF: Math.round(p.kPerBF * 1000) / 10, // as a percentage
    battersFaced: p.battersFaced,
    vsLHB: p.vsLHB
      ? { avg: p.vsLHB.avg, ops: p.vsLHB.ops, pa: p.vsLHB.plateAppearances }
      : null,
    vsRHB: p.vsRHB
      ? { avg: p.vsRHB.avg, ops: p.vsRHB.ops, pa: p.vsRHB.plateAppearances }
      : null,
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const home = searchParams.get("home");
  const away = searchParams.get("away");
  const date = searchParams.get("date") ?? etDateString();

  if (!home || !away)
    return NextResponse.json(
      { ok: false, error: "home and away team abbrevs are required" },
      { status: 400 },
    );

  try {
    // fetchSlateContext keys pitchers by the team's OPPONENT (it's built for
    // the projector, which needs "who is the batter facing" — not "who is
    // this team's own starter"). So home's starting pitcher sits under the
    // away abbrev's key, and vice versa.
    const { pitcherByTeam } = await fetchSlateContext(date);
    const homePitcher = pitcherPayload(pitcherByTeam.get(away));
    const awayPitcher = pitcherPayload(pitcherByTeam.get(home));

    if (!homePitcher && !awayPitcher)
      return NextResponse.json({
        ok: true,
        homePitcher: null,
        awayPitcher: null,
        note: "No probable pitchers posted yet for this game.",
      });

    return NextResponse.json(
      { ok: true, homePitcher, awayPitcher },
      { headers: { "Cache-Control": "public, s-maxage=300" } },
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: String(e instanceof Error ? e.message : e) },
      { status: 502 },
    );
  }
}
