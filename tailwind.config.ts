import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      colors: {
        sasi: {
          bg: "#0F1117",
          surface: "#181C27",
          card: "#1E2333",
          border: "#2A3045",
          accent: "#3B6EF5",
          "accent-dim": "#2A4FA8",
          muted: "#4A5270",
          text: "#E8EAF0",
          "text-muted": "#7A82A0",
        },
        status: {
          sem: { bg: "#1E2333", text: "#7A82A0", border: "#2A3045" },
          andamento: { bg: "#1A2E4A", text: "#60A5FA", border: "#2563EB" },
          concluido: { bg: "#0F2A1E", text: "#34D399", border: "#059669" },
          impedido: { bg: "#2A1A1A", text: "#F87171", border: "#DC2626" },
          nao_iniciado: { bg: "#1E1A2A", text: "#A78BFA", border: "#7C3AED" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
