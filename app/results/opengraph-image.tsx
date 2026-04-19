import { ImageResponse } from "next/og";

export const alt = "Diamond-Quant Live — Track Record";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

async function getStats() {
  const base = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://diamond-quant-live.vercel.app";
  try {
    const res = await fetch(`${base}/api/results?days=30`, { next: { revalidate: 600 } });
    if (!res.ok) return null;
    const d = await res.json();
    if (!d.ok) return null;
    return d;
  } catch { return null; }
}

export default async function OG() {
  const data = await getStats();
  const overall = data?.overall ?? { total: 0, wins: 0, losses: 0, winRate: 0, profitUnits: 0 };
  const hasRecord = overall.total >= 5;
  const record = hasRecord ? `${overall.wins}-${overall.losses}` : "Building record";
  const winPct = hasRecord ? `${(overall.winRate * 100).toFixed(0)}%` : "—";
  const units = hasRecord ? `${overall.profitUnits >= 0 ? "+" : ""}${overall.profitUnits.toFixed(1)}u` : "—";
  const isProfit = overall.profitUnits >= 0;

  return new ImageResponse(
    (
      <div
        style={{
          background: "#0a0a0f",
          backgroundImage:
            "radial-gradient(circle at 20% 30%, rgba(0, 255, 136, 0.15) 0%, transparent 50%), radial-gradient(circle at 80% 70%, rgba(0, 212, 255, 0.12) 0%, transparent 55%)",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: 72,
          color: "#e6e8f0",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 32 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 14,
              background: "linear-gradient(135deg, #00ff88 0%, #00d4ff 100%)",
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
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 32, fontWeight: 800, color: "#ffffff", letterSpacing: -1 }}>
              <span>Diamond-Quant&nbsp;</span>
              <span style={{ color: "#00ff88" }}>Live</span>
            </div>
            <div style={{ display: "flex", fontSize: 14, color: "#8b8fa3", letterSpacing: 3, marginTop: 2 }}>
              30-DAY TRACK RECORD
            </div>
          </div>
        </div>

        <div style={{ display: "flex", fontSize: 58, fontWeight: 900, color: "#ffffff", letterSpacing: -2, lineHeight: 1 }}>
          {hasRecord ? `${record} · ${winPct} win rate` : "Building our track record"}
        </div>

        <div style={{ display: "flex", marginTop: 40, gap: 24 }}>
          <div style={{ display: "flex", flexDirection: "column", padding: "28px 36px", borderRadius: 20, border: "2px solid rgba(0,255,136,0.25)", background: "rgba(0,255,136,0.05)", minWidth: 240 }}>
            <div style={{ fontSize: 16, color: "#8b8fa3", letterSpacing: 2 }}>PROFIT</div>
            <div style={{ display: "flex", fontSize: 72, fontWeight: 900, color: isProfit ? "#00ff88" : "#ff5566", marginTop: 6, letterSpacing: -2 }}>{units}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", padding: "28px 36px", borderRadius: 20, border: "2px solid rgba(0,212,255,0.25)", background: "rgba(0,212,255,0.05)", minWidth: 240 }}>
            <div style={{ fontSize: 16, color: "#8b8fa3", letterSpacing: 2 }}>PICKS GRADED</div>
            <div style={{ display: "flex", fontSize: 72, fontWeight: 900, color: "#00d4ff", marginTop: 6, letterSpacing: -2 }}>{overall.total}</div>
          </div>
        </div>

        <div style={{ marginTop: "auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", fontSize: 22, color: "#c4c8d8" }}>
            3-model quant brain · Fully public & graded nightly
          </div>
          <div style={{ display: "flex", fontSize: 18, color: "#8b8fa3", letterSpacing: 1 }}>
            diamond-quant-live.vercel.app/results
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
