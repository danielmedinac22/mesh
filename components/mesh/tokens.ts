export const MESH = {
  bg: "#0B0B0C",
  bgElev: "#111114",
  bgElev2: "#16161A",
  bgInput: "#0E0E11",
  border: "#1F1F22",
  borderHi: "#2A2A30",
  fg: "#EDEDED",
  fgDim: "#9A9AA2",
  fgMute: "#6A6A72",
  amber: "#F5A524",
  amberDim: "#7A5510",
  amberGlow: "rgba(245,165,36,0.12)",
  red: "#E5484D",
  redDim: "#3A1416",
  green: "#30A46C",
  greenDim: "#0E2E20",
  blue: "#5EB1EF",
  purple: "#B08CDD",
  signal: "#4C9AFF",
  signalDim: "#10243F",
  signalGlow: "rgba(76,154,255,0.14)",
} as const;

export const MESH_FONT = {
  display: "var(--font-display), 'Instrument Serif', Georgia, serif",
  sans: "var(--font-sans), Inter, system-ui, sans-serif",
  mono: "var(--font-mono), 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
} as const;

export const MESH_SPACE = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 28,
  xxl: 40,
  xxxl: 64,
  hero: 96,
} as const;

export const MESH_MOTION = {
  fast: "160ms",
  base: "240ms",
  slow: "420ms",
  cinema: "520ms",
  ease: "cubic-bezier(0.2, 0.8, 0.2, 1)",
  easeIn: "cubic-bezier(0.4, 0, 1, 1)",
  easeOut: "cubic-bezier(0, 0, 0.2, 1)",
} as const;

export const MESH_ELEV = {
  e1: "0 1px 0 rgba(0,0,0,0.4), 0 1px 2px rgba(0,0,0,0.4)",
  e2: "0 4px 14px rgba(0,0,0,0.5), 0 2px 4px rgba(0,0,0,0.4)",
  e3: "0 18px 48px rgba(0,0,0,0.6), 0 8px 18px rgba(0,0,0,0.45)",
  glowAmber: "0 0 0 1px rgba(245,165,36,0.18), 0 8px 32px rgba(245,165,36,0.12)",
  glowSignal: "0 0 0 1px rgba(76,154,255,0.18), 0 8px 32px rgba(76,154,255,0.12)",
} as const;

export const MESH_TRACK = {
  hud: "0.14em",
  label: "0.10em",
  tight: "-0.02em",
  display: "-0.03em",
} as const;
