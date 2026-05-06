export interface PropGradeResult {
  result: "win" | "loss" | "push";
  actualValue: number;
  line: number;
  side: "over" | "under";
}

export function gradePropPick(
  pick: { playerName: string; market: string; line: number; side: "over" | "under" },
  boxScores: Array<{ playerName: string; pts: number; reb: number; ast: number; minutes: number }>,
): PropGradeResult | null {
  const lastName = (name: string) => name.toLowerCase().split(" ").slice(-1)[0];
  const player = boxScores.find(
    (p) =>
      p.playerName.toLowerCase().includes(lastName(pick.playerName)) ||
      pick.playerName.toLowerCase().includes(lastName(p.playerName)),
  );
  if (!player || player.minutes < 5) return null;

  const actual =
    pick.market === "player_points"
      ? player.pts
      : pick.market === "player_rebounds"
        ? player.reb
        : player.ast;

  if (actual === pick.line) return { result: "push", actualValue: actual, line: pick.line, side: pick.side };
  const hit = pick.side === "over" ? actual > pick.line : actual < pick.line;
  return { result: hit ? "win" : "loss", actualValue: actual, line: pick.line, side: pick.side };
}
