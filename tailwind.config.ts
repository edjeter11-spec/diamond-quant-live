import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // 2026-09 revamp — "terminal luxe". Same token NAMES as before so
        // every component reskins without edits: deeper near-black base,
        // clearer surface steps, and brighter text for contrast (the old
        // mercury at /60 opacity on gunmetal was under WCAG AA almost
        // everywhere). Accent hues kept in the brand family — the logo
        // artwork is mint/electric — but lifted a notch.
        void: "#08090c",
        bunker: "#0e1016",
        gunmetal: "#151823",
        slate: "#252a3a",
        steel: "#353c52",
        mercury: "#a0a9bf",
        silver: "#eef1f8",
        neon: "#3ce8a9",
        "neon-dim": "#22b07f",
        electric: "#5ccbff",
        gold: "#f8c95c",
        "gold-dim": "#bd962f",
        danger: "#ff5f7e",
        "danger-dim": "#cc3d57",
        purple: "#b39cff",
        amber: "#f7a93a",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
        display: ["Space Grotesk", "Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        // Elevation steps used by the .glass surface and modals.
        panel:
          "inset 0 1px 0 rgba(255,255,255,0.045), 0 1px 2px rgba(0,0,0,0.4), 0 14px 36px -16px rgba(0,0,0,0.7)",
        pop: "0 24px 64px -24px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.06)",
      },
      animation: {
        "pulse-neon": "pulse-neon 2s ease-in-out infinite",
        "flash-gold": "flash-gold 1s ease-in-out",
        "slide-up": "slide-up 0.3s ease-out",
        "fade-in": "fade-in 0.4s ease-out",
        ticker: "ticker 30s linear infinite",
      },
      keyframes: {
        "pulse-neon": {
          "0%, 100%": { boxShadow: "0 0 4px #3ce8a940, 0 0 10px #3ce8a91f" },
          "50%": { boxShadow: "0 0 14px #3ce8a980, 0 0 28px #3ce8a940" },
        },
        "flash-gold": {
          "0%": { backgroundColor: "#f8c95c33" },
          "50%": { backgroundColor: "#f8c95c66" },
          "100%": { backgroundColor: "transparent" },
        },
        "slide-up": {
          "0%": { transform: "translateY(10px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        ticker: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
