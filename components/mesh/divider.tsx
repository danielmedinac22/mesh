import type { CSSProperties } from "react";
import { MESH } from "./tokens";

export function Divider({
  label,
  align = "left",
  tone = "default",
  style,
}: {
  label?: string;
  align?: "left" | "center" | "right";
  tone?: "default" | "amber" | "signal";
  style?: CSSProperties;
}) {
  const color =
    tone === "amber" ? MESH.amber : tone === "signal" ? "var(--mesh-signal)" : MESH.fgMute;

  if (!label) {
    return (
      <div
        style={{
          height: 1,
          background: MESH.border,
          width: "100%",
          ...style,
        }}
      />
    );
  }

  const labelEl = (
    <span
      className="mesh-hud"
      style={{
        color,
        whiteSpace: "nowrap",
        padding: "0 10px",
      }}
    >
      <span style={{ marginRight: 6, opacity: 0.6 }}>—</span>
      {label}
      <span style={{ marginLeft: 6, opacity: 0.6 }}>—</span>
    </span>
  );

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 0,
        width: "100%",
        ...style,
      }}
    >
      {align !== "left" && <div style={{ flex: 1, height: 1, background: MESH.border }} />}
      {labelEl}
      {align !== "right" && <div style={{ flex: 1, height: 1, background: MESH.border }} />}
    </div>
  );
}
