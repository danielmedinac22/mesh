"use client";

import type { ReactNode } from "react";
import { MESH } from "./tokens";
import { Dot } from "./pill";

export type KanbanColumnTone = "dim" | "amber" | "green" | "inbox";

const COLOR: Record<KanbanColumnTone, string> = {
  inbox: MESH.fgMute,
  dim: MESH.fgMute,
  amber: MESH.amber,
  green: MESH.green,
};

export function KanbanColumn({
  title,
  subtitle,
  tone,
  count,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  tone: KanbanColumnTone;
  count: number;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const dotColor = COLOR[tone];
  return (
    <section
      style={{
        flex: 1,
        minWidth: 260,
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
      }}
    >
      <header
        style={{
          padding: "0 4px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Dot color={dotColor} size={7} />
          <span
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: MESH.fg,
              letterSpacing: "-0.01em",
            }}
          >
            {title}
          </span>
          <span style={{ flex: 1 }} />
          <span
            className="font-mono"
            style={{ fontSize: 11, color: MESH.fgMute }}
          >
            {count}
          </span>
        </div>
        {subtitle && (
          <div
            className="font-mono"
            style={{
              fontSize: 9,
              color: MESH.fgMute,
              textTransform: "uppercase",
              letterSpacing: "0.14em",
              paddingLeft: 15,
            }}
          >
            {subtitle}
          </div>
        )}
      </header>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          paddingRight: 4,
          paddingBottom: 12,
        }}
      >
        {children}
      </div>
      {footer && (
        <div style={{ paddingTop: 8, flexShrink: 0 }}>{footer}</div>
      )}
    </section>
  );
}
