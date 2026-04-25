import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "1.5rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: [
          "var(--font-mono)",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },
      colors: {
        // Shadcn-compat tokens (existing pages depend on these)
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        // Mesh direct-hex tokens
        mesh: {
          bg: "var(--mesh-bg)",
          "bg-elev": "var(--mesh-bg-elev)",
          "bg-elev-2": "var(--mesh-bg-elev-2)",
          "bg-input": "var(--mesh-bg-input)",
          border: "var(--mesh-border)",
          "border-hi": "var(--mesh-border-hi)",
          fg: "var(--mesh-fg)",
          "fg-dim": "var(--mesh-fg-dim)",
          "fg-mute": "var(--mesh-fg-mute)",
          amber: "var(--mesh-amber)",
          "amber-dim": "var(--mesh-amber-dim)",
          green: "var(--mesh-green)",
          red: "var(--mesh-red)",
          blue: "var(--mesh-blue)",
          purple: "var(--mesh-purple)",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
