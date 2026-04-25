"use client";

import type { ReactNode } from "react";
import { MESH } from "./tokens";

export type KanbanColumnTone = "dim" | "amber" | "green" | "inbox";

const COLOR: Record<KanbanColumnTone, string> = {
  inbox: MESH.fgMute,
  dim: MESH.fgMute,
  amber: MESH.amber,
  green: MESH.green,
};

const GLOW: Record<KanbanColumnTone, string> = {
  inbox: "transparent",
  dim: "transparent",
  amber: "rgba(245,165,36,0.10)",
  green: "rgba(48,164,108,0.08)",
};

export function KanbanColumn({
  title,
  subtitle,
  tone,
  count,
  children,
  footer,
  index,
}: {
  title: string;
  subtitle?: string;
  tone: KanbanColumnTone;
  count: number;
  children: ReactNode;
  footer?: ReactNode;
  index?: number;
}) {
  const accent = COLOR[tone];
  const glow = GLOW[tone];
  return (
    <section
      style={{
        flex: 1,
        minWidth: 280,
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
      }}
    >
      <header
        style={{
          padding: "0 6px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          position: "relative",
        }}
      >
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: -2,
            left: -8,
            right: -8,
            bottom: 8,
            background: `radial-gradient(80% 80% at 0% 0%, ${glow} 0%, transparent 70%)`,
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "baseline",
            gap: 12,
          }}
        >
          <span
            className="mesh-mono"
            style={{
              fontSize: 10,
              color: MESH.fgMute,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
            }}
          >
            {typeof index === "number" ? String(index + 1).padStart(2, "0") : "—"}
          </span>
          <span
            className="mesh-display"
            style={{
              fontSize: 22,
              color: MESH.fg,
              letterSpacing: "-0.01em",
              lineHeight: 1,
            }}
          >
            {title}
          </span>
          <span
            className="mesh-mono"
            style={{
              marginLeft: "auto",
              fontSize: 22,
              color: count > 0 ? accent : MESH.fgMute,
              fontWeight: 500,
              fontVariantNumeric: "tabular-nums",
              letterSpacing: "-0.02em",
              lineHeight: 1,
            }}
          >
            {String(count).padStart(2, "0")}
          </span>
        </div>
        {subtitle && (
          <div
            className="mesh-hud"
            style={{
              color: MESH.fgMute,
              paddingLeft: 28,
            }}
          >
            {subtitle}
          </div>
        )}
        <div
          aria-hidden
          style={{
            position: "relative",
            height: 1,
            background: `linear-gradient(to right, ${accent} 0%, ${accent} 24px, ${MESH.border} 24px, ${MESH.border} 100%)`,
            marginTop: 4,
          }}
        />
      </header>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          paddingRight: 4,
          paddingBottom: 12,
        }}
      >
        {children}
      </div>
      {footer && <div style={{ paddingTop: 8, flexShrink: 0 }}>{footer}</div>}
    </section>
  );
}
