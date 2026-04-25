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
        height: 56,
        borderBottom: `1px solid ${MESH.border}`,
        display: "flex",
        alignItems: "center",
        padding: "0 24px",
        gap: 16,
        flexShrink: 0,
        background: MESH.bg,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div
          style={{ fontSize: 14, fontWeight: 500, color: MESH.fg, letterSpacing: "-0.01em" }}
        >
          {title}
        </div>
        {subtitle && (
          <div className="font-mono" style={{ fontSize: 11, color: MESH.fgMute }}>
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
