import { ImageResponse } from "next/og";
import { cloudGet } from "@/lib/supabase/client";

export const alt = "Diamond-Quant Live — Live Track Record";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

interface PropHistItem {
  result?: string;
}

async function getStats() {
  try {
    const history = ((await cloudGet<PropHistItem[]>("prop_pick_history_nba", [])) ?? []) as PropHistItem[];
    const graded = history.filter((p) => p.result === "win" || p.result === "loss");
    const wins = graded.filter((p) => p.result === "win").length;
    const losses = graded.filter((p) => p.result === "loss").length;
    const winRate = graded.length > 0 ? (wins / graded.length) * 100 : 0;
    const profit = wins * 90.9 - losses * 100;
    return { wins, losses, winRate, totalGraded: graded.length, profit };
  } catch {
    return { wins: 0, losses: 0, winRate: 0, totalGraded: 0, profit: 0 };
  }
}

export default async function OG() {
  const stats = await getStats();
  const wrColor = stats.winRate >= 55 ? "#00ff88" : stats.winRate >= 50 ? "#00d4ff" : "#ffd700";
  const profitColor = stats.profit >= 0 ? "#00ff88" : "#ff3b5c";
  const winRateText = stats.totalGraded > 0 ? `${stats.winRate.toFixed(1)}%` : "—";
  const recordText = `${stats.wins}-${stats.losses}`;
  const profitText = `${stats.profit >= 0 ? "+" : ""}$${Math.round(stats.profit)}`;

  return new ImageResponse(
    (
      <div style={{ background: "#0a0a0f", width: "100%", height: "100%", display: "flex", flexDirection: "column", padding: 70 }}>
        {/* Brand row */}
        <div style={{ display: "flex", alignItems: "center", marginBottom: 30 }}>
          <div style={{ width: 64, height: 64, borderRadius: 14, background: "#00ff88", color: "#0a0a0f", fontSize: 44, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", marginRight: 18 }}>
            D
          </div>
          <div style={{ fontSize: 34, fontWeight: 800, color: "#ffffff", display: "flex" }}>
            Diamond-Quant Live
          </div>
        </div>

        {/* Headline */}
        <div style={{ fontSize: 60, fontWeight: 900, lineHeight: 1.05, color: "#ffffff", letterSpacing: -1.5, display: "flex" }}>
          AI Sports Betting
        </div>
        <div style={{ fontSize: 60, fontWeight: 900, lineHeight: 1.05, color: "#ffd700", letterSpacing: -1.5, display: "flex", marginBottom: 30 }}>
          That Actually Learns
        </div>

        {/* Stats row */}
        <div style={{ display: "flex", marginTop: 10 }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, borderRadius: 18, border: "2px solid rgba(0, 255, 136, 0.3)", background: "rgba(0, 255, 136, 0.06)", marginRight: 16 }}>
            <div style={{ fontSize: 80, fontWeight: 900, color: wrColor, lineHeight: 1, display: "flex" }}>{winRateText}</div>
            <div style={{ fontSize: 18, color: "#8b8fa3", letterSpacing: 3, marginTop: 10, display: "flex" }}>WIN RATE</div>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, borderRadius: 18, border: "2px solid rgba(255, 215, 0, 0.25)", background: "rgba(255, 215, 0, 0.05)", marginRight: 16 }}>
            <div style={{ fontSize: 80, fontWeight: 900, color: "#ffffff", lineHeight: 1, display: "flex" }}>{recordText}</div>
            <div style={{ fontSize: 18, color: "#8b8fa3", letterSpacing: 3, marginTop: 10, display: "flex" }}>RECORD</div>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, borderRadius: 18, border: "2px solid rgba(0, 212, 255, 0.25)", background: "rgba(0, 212, 255, 0.05)" }}>
            <div style={{ fontSize: 64, fontWeight: 900, color: profitColor, lineHeight: 1, display: "flex" }}>{profitText}</div>
            <div style={{ fontSize: 16, color: "#8b8fa3", letterSpacing: 3, marginTop: 10, display: "flex" }}>PROFIT @ $100/BET</div>
          </div>
        </div>

        {/* Bottom row */}
        <div style={{ marginTop: "auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 22, color: "#c4c8d8", display: "flex" }}>
            Self-evolving NBA prop brain — 7-day free trial
          </div>
          <div style={{ fontSize: 16, color: "#8b8fa3", display: "flex" }}>
            diamond-quant-live.vercel.app
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
