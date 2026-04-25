import type { ReactNode, CSSProperties } from "react";

export function CornerBrackets({
  tone = "default",
  inset = false,
  className = "",
  style,
  children,
}: {
  tone?: "default" | "amber" | "signal";
  inset?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  const toneClass =
    tone === "amber"
      ? "mesh-bracket-amber"
      : tone === "signal"
      ? "mesh-bracket-signal"
      : "";
  const insetStyle: CSSProperties = inset ? { padding: 1 } : {};
  return (
    <div
      className={`mesh-bracket-wrap ${toneClass} ${className}`}
      style={{ ...insetStyle, ...style }}
    >
      {children}
      <span className="mesh-bracket-bl" />
      <span className="mesh-bracket-br" />
    </div>
  );
}
