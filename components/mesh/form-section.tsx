import type { ReactNode, CSSProperties } from "react";
import { MESH } from "./tokens";

export function FormSection({
  label,
  hint,
  children,
  layout = "row",
  optional,
  style,
}: {
  label: string;
  hint?: ReactNode;
  optional?: boolean;
  children: ReactNode;
  layout?: "row" | "stacked";
  style?: CSSProperties;
}) {
  const isRow = layout === "row";
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: isRow ? "168px 1fr" : "1fr",
        gap: isRow ? 24 : 8,
        padding: "20px 0",
        borderBottom: `1px solid ${MESH.border}`,
        ...style,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingTop: isRow ? 4 : 0 }}>
        <span className="mesh-label" style={{ color: MESH.fg }}>
          {label}
        </span>
        {optional && (
          <span className="mesh-hud" style={{ color: MESH.fgMute, fontSize: 9 }}>
            optional
          </span>
        )}
        {hint && isRow && (
          <span style={{ fontSize: 12, color: MESH.fgMute, lineHeight: 1.5 }}>{hint}</span>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
        {children}
        {hint && !isRow && (
          <span style={{ fontSize: 12, color: MESH.fgMute, lineHeight: 1.5 }}>{hint}</span>
        )}
      </div>
    </div>
  );
}

export function FormGroup({
  title,
  caption,
  children,
  style,
}: {
  title: string;
  caption?: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        ...style,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          paddingBottom: 12,
          borderBottom: `1px solid ${MESH.borderHi}`,
        }}
      >
        <span className="mesh-hud" style={{ color: MESH.fgDim }}>
          {title}
        </span>
        {caption && (
          <span className="mesh-mono" style={{ fontSize: 11, color: MESH.fgMute }}>
            {caption}
          </span>
        )}
      </header>
      <div style={{ display: "flex", flexDirection: "column" }}>{children}</div>
    </section>
  );
}
