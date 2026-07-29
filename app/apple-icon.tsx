import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        background: "#05070d",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        color: "#2ee6a6",
        fontWeight: 900,
      }}
    >
      <div
        style={{
          width: 110,
          height: 110,
          borderRadius: 28,
          background: "linear-gradient(135deg, #2ee6a6 0%, #4cc9ff 100%)",
          color: "#05070d",
          fontSize: 78,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 0 40px rgba(0, 255, 136, 0.4)",
        }}
      >
        D
      </div>
      <div
        style={{
          fontSize: 16,
          marginTop: 10,
          color: "#8e9ab5",
          letterSpacing: 2,
        }}
      >
        QUANT
      </div>
    </div>,
    { ...size },
  );
}
