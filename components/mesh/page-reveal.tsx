"use client";
import type { ReactNode, CSSProperties } from "react";

export function PageReveal({
  children,
  style,
  as: Tag = "div",
}: {
  children: ReactNode;
  style?: CSSProperties;
  as?: "div" | "section" | "main";
}) {
  return (
    <Tag className="mesh-reveal" style={style}>
      {children}
    </Tag>
  );
}
