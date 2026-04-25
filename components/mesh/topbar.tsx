import type { ReactNode } from "react";
import { MESH } from "./tokens";

export function TopBar({
  title,
  subtitle,
  right,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div
      style={{
        height: 60,
        borderBottom: `1px solid ${MESH.border}`,
        display: "flex",
        alignItems: "center",
        padding: "0 28px",
        gap: 16,
        flexShrink: 0,
        background: MESH.bg,
        position: "relative",
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: 0,
          top: "50%",
          width: 3,
          height: 18,
          transform: "translateY(-50%)",
          background: MESH.amber,
        }}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div
          className="mesh-display"
          style={{
            fontSize: 22,
            color: MESH.fg,
            letterSpacing: "-0.02em",
            lineHeight: 1,
          }}
        >
          {title}
        </div>
        {subtitle && (
          <div className="mesh-hud" style={{ color: MESH.fgMute }}>
            {subtitle}
          </div>
        )}
      </div>
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
        {right}
      </div>
    </div>
  );
}
