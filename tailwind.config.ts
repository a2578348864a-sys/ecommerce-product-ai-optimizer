import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        grass: {
          50: "#f2fcf5",
          100: "#e2f9ea",
          200: "#c5f3d5",
          300: "#93eab2",
          400: "#5bdd8c",
          500: "#2cc96b",
          600: "#20a855",
          700: "#198c47",
          800: "#176e3b",
          900: "#155b32",
          950: "#08321b",
        },
      },
      boxShadow: {
        soft: "0 18px 48px rgba(15, 23, 42, 0.08)",
        "grass-sm": "0 2px 10px rgba(44, 201, 107, 0.18)",
        "grass-glow": "0 0 25px -4px rgba(44, 201, 107, 0.32)",
        "grass-glow-lg": "0 0 45px -8px rgba(44, 201, 107, 0.42)",
      },
      keyframes: {
        pulseFlow: {
          "0%": { left: "-15%", opacity: "0" },
          "20%": { opacity: "1" },
          "80%": { opacity: "1" },
          "100%": { left: "115%", opacity: "0" },
        },
        auroraBreath: {
          "0%, 100%": { transform: "scale(1) translate(0, 0)", opacity: "0.2" },
          "50%": { transform: "scale(1.12) translate(15px, -10px)", opacity: "0.32" },
        },
        shimmer: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(200%)" },
        },
      },
      animation: {
        "pulse-flow": "pulseFlow 3.5s cubic-bezier(0.4, 0, 0.2, 1) infinite",
        "aurora-breath": "auroraBreath 7s ease-in-out infinite",
        shimmer: "shimmer 3.5s cubic-bezier(0.4, 0, 0.2, 1) infinite",
      },
    },
  },
  plugins: [],
};

export default config;
