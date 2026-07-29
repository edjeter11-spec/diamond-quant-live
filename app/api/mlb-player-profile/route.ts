import { NextResponse } from "next/server";
import { getPlayerProfile } from "@/lib/mlb/player-stats";

export const revalidate = 300;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const name = searchParams.get("name");
  const idParam = searchParams.get("id");
  const id = idParam ? parseInt(idParam, 10) : undefined;

  if (!name && !id) {
    return NextResponse.json(
      { error: "Player name or id required" },
      { status: 400 },
    );
  }

  try {
    const profile = await getPlayerProfile(name ?? "", id);
    if (!profile) {
      return NextResponse.json(
        { error: "Player not found or no stats available", name },
        { status: 404 },
      );
    }
    return NextResponse.json(profile);
  } catch (error) {
    console.error("Player profile error:", error);
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }
}
