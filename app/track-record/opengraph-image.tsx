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
    // Profit at $100/-110
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

  return new ImageResponse(
    (
      <div
        style={{
          background: "#0a0a0f",
          backgroundImage:
            "radial-gradient(circle at 20% 20%, rgba(255, 215, 0, 0.15) 0%, transparent 50%), radial-gradient(circle at 80% 80%, rgba(0, 255, 136, 0.12) 0%, transparent 55%)",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: 70,
          color: "#e6e8f0",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {/* Top brand row */}
        <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 12 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 14,
              background: "linear-gradient(135deg, #ffd700 0%, #00ff88 100%)",
              color: "#0a0a0f",
              fontSize: 44,
              fontWeight: 900,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            D
          </div>
          <div style={{ display: "flex", fontSize: 32, fontWeight: 800, color: "#ffffff" }}>
            Diamond-Quant&nbsp;<span style={{ color: "#00ff88" }}>Live</span>
          </div>
          <div
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              padding: "8px 18px",
              borderRadius: 999,
              border: "2px solid rgba(0, 255, 136, 0.4)",
              background: "rgba(0, 255, 136, 0.1)",
              color: "#00ff88",
              fontSize: 16,
              fontWeight: 700,
              letterSpacing: 2,
            }}
          >
            ● LIVE
          </div>
        </div>

        {/* Headline */}
        <div style={{ display: "flex", fontSize: 56, fontWeight: 900, lineHeight: 1.05, color: "#ffffff", letterSpacing: -1.5, marginTop: 10 }}>
          AI Sports Betting{" "}
          <span style={{ color: "#ffd700", marginLeft: 14 }}>That Actually Learns</span>
        </div>

        {/* Stats row */}
        <div style={{ display: "flex", gap: 24, marginTop: 38 }}>
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
              borderRadius: 18,
              border: "2px solid rgba(0, 255, 136, 0.25)",
              background: "rgba(0, 255, 136, 0.06)",
            }}
          >
            <div style={{ fontSize: 78, fontWeight: 900, color: wrColor, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
              {stats.totalGraded > 0 ? `${stats.winRate.toFixed(1)}%` : "—"}
            </div>
            <div style={{ display: "flex", fontSize: 16, color: "#8b8fa3", letterSpacing: 3, marginTop: 10 }}>
              WIN RATE
            </div>
          </div>
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
              borderRadius: 18,
              border: "2px solid rgba(255, 215, 0, 0.2)",
              background: "rgba(255, 215, 0, 0.05)",
            }}
          >
            <div style={{ display: "flex", fontSize: 78, fontWeight: 900, color: "#ffffff", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
              {stats.wins}<span style={{ color: "#3a3d4e", margin: "0 6px" }}>-</span>{stats.losses}
            </div>
            <div style={{ display: "flex", fontSize: 16, color: "#8b8fa3", letterSpacing: 3, marginTop: 10 }}>
              RECORD
            </div>
          </div>
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
              borderRadius: 18,
              border: "2px solid rgba(0, 212, 255, 0.2)",
              background: "rgba(0, 212, 255, 0.05)",
            }}
          >
            <div style={{ fontSize: 64, fontWeight: 900, color: profitColor, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
              {stats.profit >= 0 ? "+" : ""}${Math.round(stats.profit)}
            </div>
            <div style={{ display: "flex", fontSize: 16, color: "#8b8fa3", letterSpacing: 3, marginTop: 10, textAlign: "center" }}>
              PROFIT @ $100/BET
            </div>
          </div>
        </div>

        {/* Bottom CTA */}
        <div style={{ marginTop: "auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", fontSize: 22, color: "#c4c8d8" }}>
            Self-evolving NBA prop brain · Auto-graded vs box scores · 7-day free trial
          </div>
          <div style={{ display: "flex", fontSize: 16, color: "#8b8fa3", letterSpacing: 1 }}>
            diamond-quant-live.vercel.app
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
