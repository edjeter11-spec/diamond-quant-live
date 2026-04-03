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
        // War Room dark theme
        void: "#0a0a0f",
        bunker: "#0f1117",
        gunmetal: "#1a1d2e",
        slate: "#2a2d3e",
        steel: "#3a3d4e",
        mercury: "#8b8fa3",
        silver: "#c4c8d8",
        // Action colors
        neon: "#00ff88",
        "neon-dim": "#00cc6a",
        electric: "#00d4ff",
        gold: "#ffd700",
        "gold-dim": "#b8960f",
        danger: "#ff3b5c",
        "danger-dim": "#cc2040",
        purple: "#a855f7",
        amber: "#f59e0b",
      },
      fontFamily: {
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
        display: ["Inter", "system-ui", "sans-serif"],
      },
      animation: {
        "pulse-neon": "pulse-neon 2s ease-in-out infinite",
        "flash-gold": "flash-gold 1s ease-in-out",
        "slide-up": "slide-up 0.3s ease-out",
        "ticker": "ticker 30s linear infinite",
      },
      keyframes: {
        "pulse-neon": {
          "0%, 100%": { boxShadow: "0 0 5px #00ff88, 0 0 10px #00ff8833" },
          "50%": { boxShadow: "0 0 20px #00ff88, 0 0 40px #00ff8866" },
        },
        "flash-gold": {
          "0%": { backgroundColor: "#ffd70033" },
          "50%": { backgroundColor: "#ffd70066" },
          "100%": { backgroundColor: "transparent" },
        },
        "slide-up": {
          "0%": { transform: "translateY(10px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        "ticker": {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
