import type { CSSProperties } from "react";
import { MESH } from "./tokens";

export function Kbd({
  children,
  size = "sm",
  tone = "default",
  style,
}: {
  children: React.ReactNode;
  size?: "xs" | "sm" | "md";
  tone?: "default" | "amber";
  style?: CSSProperties;
}) {
  const dims =
    size === "xs"
      ? { fontSize: 9, padding: "1px 4px", h: 14 }
      : size === "md"
      ? { fontSize: 11, padding: "2px 7px", h: 20 }
      : { fontSize: 10, padding: "1px 6px", h: 17 };
  const color = tone === "amber" ? MESH.amber : MESH.fgDim;
  const border = tone === "amber" ? "rgba(245,165,36,0.4)" : MESH.borderHi;
  return (
    <kbd
      className="mesh-mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: dims.h,
        padding: dims.padding,
        fontSize: dims.fontSize,
        fontWeight: 500,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        color,
        background: MESH.bgElev,
        border: `1px solid ${border}`,
        borderRadius: 4,
        boxShadow: "0 1px 0 rgba(0,0,0,0.4)",
        ...style,
      }}
    >
      {children}
    </kbd>
  );
}
