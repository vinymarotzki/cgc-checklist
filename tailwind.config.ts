import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
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
        app: {
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
        // Tokens do shadcn/ui (ver src/app/globals.css, bloco @layer base) — o
        // CLI escreve essas cores direto em CSS (@theme, estilo Tailwind v4),
        // mas este projeto roda Tailwind v3, que só resolve `bg-card`,
        // `border-border` etc. se a cor estiver mapeada aqui.
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        background: "var(--background)",
        foreground: "var(--foreground)",
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
        sidebar: {
          DEFAULT: "var(--sidebar)",
          foreground: "var(--sidebar-foreground)",
          primary: "var(--sidebar-primary)",
          "primary-foreground": "var(--sidebar-primary-foreground)",
          accent: "var(--sidebar-accent)",
          "accent-foreground": "var(--sidebar-accent-foreground)",
          border: "var(--sidebar-border)",
          ring: "var(--sidebar-ring)",
        },
        chart: {
          "1": "var(--chart-1)",
          "2": "var(--chart-2)",
          "3": "var(--chart-3)",
          "4": "var(--chart-4)",
          "5": "var(--chart-5)",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [],
};

export default config;
