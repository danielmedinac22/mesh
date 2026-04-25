import type { CSSProperties, ReactNode } from "react";
import { MESH } from "./tokens";

export type PillTone = "default" | "amber" | "green" | "red" | "dim";

const TONES: Record<PillTone, { bg: string; fg: string; bd: string }> = {
  default: { bg: "#16161A", fg: MESH.fgDim, bd: MESH.border },
  amber: { bg: "rgba(245,165,36,0.08)", fg: MESH.amber, bd: "rgba(245,165,36,0.25)" },
  green: { bg: "rgba(48,164,108,0.08)", fg: MESH.green, bd: "rgba(48,164,108,0.28)" },
  red: { bg: "rgba(229,72,77,0.08)", fg: MESH.red, bd: "rgba(229,72,77,0.3)" },
  dim: { bg: "transparent", fg: MESH.fgMute, bd: MESH.border },
};

export function Pill({
  children,
  tone = "default",
  style,
}: {
  children: ReactNode;
  tone?: PillTone;
  style?: CSSProperties;
}) {
  const t = TONES[tone];
  return (
    <span
      className="font-mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 11,
        lineHeight: "16px",
        background: t.bg,
        color: t.fg,
        border: `1px solid ${t.bd}`,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

export function Dot({ color = MESH.green, size = 6 }: { color?: string; size?: number }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: 999,
        background: color,
        flexShrink: 0,
      }}
    />
  );
}
