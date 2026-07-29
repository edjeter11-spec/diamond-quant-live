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
        // Midnight quant desk theme — deep ink navy + refined accents
        void: "#05070d",
        bunker: "#0a0e17",
        gunmetal: "#121727",
        slate: "#232a3d",
        steel: "#323a52",
        mercury: "#8e9ab5",
        silver: "#e6eaf4",
        // Action colors — softened from raw neon for a cleaner premium read
        neon: "#2ee6a6",
        "neon-dim": "#1fb883",
        electric: "#4cc9ff",
        gold: "#f5c451",
        "gold-dim": "#b8922e",
        danger: "#ff5c7a",
        "danger-dim": "#cc3d57",
        purple: "#a78bfa",
        amber: "#f5a623",
      },
      fontFamily: {
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
        display: ["Inter", "system-ui", "sans-serif"],
      },
      animation: {
        "pulse-neon": "pulse-neon 2s ease-in-out infinite",
        "flash-gold": "flash-gold 1s ease-in-out",
        "slide-up": "slide-up 0.3s ease-out",
        ticker: "ticker 30s linear infinite",
      },
      keyframes: {
        "pulse-neon": {
          "0%, 100%": { boxShadow: "0 0 4px #2ee6a640, 0 0 10px #2ee6a61f" },
          "50%": { boxShadow: "0 0 14px #2ee6a680, 0 0 28px #2ee6a640" },
        },
        "flash-gold": {
          "0%": { backgroundColor: "#f5c45133" },
          "50%": { backgroundColor: "#f5c45166" },
          "100%": { backgroundColor: "transparent" },
        },
        "slide-up": {
          "0%": { transform: "translateY(10px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
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
