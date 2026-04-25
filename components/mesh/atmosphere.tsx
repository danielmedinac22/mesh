"use client";
import { usePathname } from "next/navigation";
import { useMemo } from "react";

type GlowConfig = { x: string; y: string; color: string };

const ROUTE_GLOW: Record<string, GlowConfig> = {
  "/": { x: "82%", y: "8%", color: "rgba(245, 165, 36, 0.14)" },
  "/connect": { x: "20%", y: "12%", color: "rgba(76, 154, 255, 0.12)" },
  "/build": { x: "78%", y: "18%", color: "rgba(245, 165, 36, 0.12)" },
  "/ship": { x: "70%", y: "10%", color: "rgba(48, 164, 108, 0.12)" },
  "/skills": { x: "85%", y: "20%", color: "rgba(176, 140, 221, 0.10)" },
  "/repos": { x: "30%", y: "12%", color: "rgba(245, 165, 36, 0.10)" },
  "/projects": { x: "75%", y: "10%", color: "rgba(245, 165, 36, 0.10)" },
  "/brain": { x: "20%", y: "85%", color: "rgba(76, 154, 255, 0.10)" },
  "/settings": { x: "85%", y: "15%", color: "rgba(245, 165, 36, 0.08)" },
};

const DEFAULT: GlowConfig = { x: "78%", y: "12%", color: "rgba(245, 165, 36, 0.10)" };

function pickGlow(pathname: string | null): GlowConfig {
  if (!pathname) return DEFAULT;
  for (const key of Object.keys(ROUTE_GLOW)) {
    if (key === "/" ? pathname === "/" : pathname.startsWith(key)) {
      return ROUTE_GLOW[key];
    }
  }
  return DEFAULT;
}

export function Atmosphere({
  override,
}: {
  override?: Partial<GlowConfig>;
}) {
  const pathname = usePathname();
  const cfg = useMemo(() => ({ ...pickGlow(pathname), ...override }), [pathname, override]);

  return (
    <>
      <div
        className="mesh-glow-route"
        style={
          {
            "--glow-x": cfg.x,
            "--glow-y": cfg.y,
            "--glow-color": cfg.color,
          } as React.CSSProperties
        }
      />
      <div className="mesh-grain" />
      <div className="mesh-vignette" />
    </>
  );
}
