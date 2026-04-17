import { ImageResponse } from "next/og";

export const alt = "Diamond-Quant Live — AI-Powered Sports Betting Intelligence";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OG() {
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
          padding: 80,
          color: "#e6e8f0",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 40 }}>
          <div
            style={{
              width: 80,
              height: 80,
              borderRadius: 18,
              background: "linear-gradient(135deg, #00ff88 0%, #00d4ff 100%)",
              color: "#0a0a0f",
              fontSize: 56,
              fontWeight: 900,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            D
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 42, fontWeight: 800, color: "#ffffff", letterSpacing: -1 }}>
              <span>Diamond-Quant&nbsp;</span>
              <span style={{ color: "#00ff88" }}>Live</span>
            </div>
            <div style={{ display: "flex", fontSize: 18, color: "#8b8fa3", letterSpacing: 4, marginTop: 4 }}>
              BETTING INTELLIGENCE
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", fontSize: 68, fontWeight: 900, lineHeight: 1.05, color: "#ffffff", maxWidth: 1000, letterSpacing: -2 }}>
          <span>Quant-driven&nbsp;</span>
          <span style={{ color: "#00ff88" }}>+EV picks&nbsp;</span>
          <span>across 10+ sportsbooks</span>
        </div>

        <div style={{ display: "flex", fontSize: 26, color: "#c4c8d8", marginTop: 28, maxWidth: 900, lineHeight: 1.3 }}>
          Self-learning 3-model brain · Live arbs · Player props · Sharp money tracker
        </div>

        <div style={{ marginTop: "auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 16 }}>
            {["MLB", "NBA"].map((s) => (
              <div
                key={s}
                style={{
                  padding: "10px 24px",
                  borderRadius: 999,
                  border: "2px solid rgba(0, 255, 136, 0.3)",
                  background: "rgba(0, 255, 136, 0.08)",
                  color: "#00ff88",
                  fontSize: 22,
                  fontWeight: 700,
                  letterSpacing: 2,
                }}
              >
                {s}
              </div>
            ))}
          </div>
          <div style={{ fontSize: 20, color: "#8b8fa3", letterSpacing: 1 }}>
            diamond-quant-live.vercel.app
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
