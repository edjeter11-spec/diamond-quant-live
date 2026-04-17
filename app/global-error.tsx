"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0a0a0f", color: "#e6e8f0", fontFamily: "system-ui, sans-serif", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <div style={{ width: 64, height: 64, borderRadius: 16, background: "rgba(255, 59, 92, 0.1)", border: "1px solid rgba(255, 59, 92, 0.3)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px", color: "#ff3b5c", fontSize: 32 }}>!</div>
          <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Critical error</h1>
          <p style={{ fontSize: 14, color: "#8b8fa3", marginBottom: 24 }}>The app hit an unrecoverable error. Reload the page.</p>
          <button
            onClick={reset}
            style={{ padding: "10px 20px", borderRadius: 12, background: "rgba(0, 255, 136, 0.15)", border: "1px solid rgba(0, 255, 136, 0.3)", color: "#00ff88", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
