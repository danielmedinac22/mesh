import { MESH } from "./tokens";

export type IconKind =
  | "home"
  | "connect"
  | "build"
  | "ship"
  | "skills"
  | "settings"
  | "branch"
  | "check"
  | "x"
  | "dot"
  | "spinner"
  | "caret"
  | "search"
  | "file"
  | "pr"
  | "bolt";

export function NavIcon({
  kind,
  color = MESH.fgDim,
  size = 14,
}: {
  kind: IconKind;
  color?: string;
  size?: number;
}) {
  const s = {
    width: size,
    height: size,
    stroke: color,
    strokeWidth: 1.4,
    fill: "none",
    display: "block" as const,
  };
  switch (kind) {
    case "home":
      return (
        <svg viewBox="0 0 16 16" {...s}>
          <path d="M2.5 7.5L8 3l5.5 4.5M4 7v6h8V7" />
        </svg>
      );
    case "connect":
      return (
        <svg viewBox="0 0 16 16" {...s}>
          <path d="M6 3H4a2 2 0 00-2 2v6a2 2 0 002 2h2M10 3h2a2 2 0 012 2v6a2 2 0 01-2 2h-2M5 8h6" />
        </svg>
      );
    case "build":
      return (
        <svg viewBox="0 0 16 16" {...s}>
          <path d="M2 4.5A1.5 1.5 0 013.5 3h9A1.5 1.5 0 0114 4.5v5A1.5 1.5 0 0112.5 11H7L4 13.5V11H3.5A1.5 1.5 0 012 9.5z" />
        </svg>
      );
    case "ship":
      return (
        <svg viewBox="0 0 16 16" {...s}>
          <path d="M3 10l5-7 5 7M5.5 10v3h5v-3" />
        </svg>
      );
    case "skills":
      return (
        <svg viewBox="0 0 16 16" {...s}>
          <path d="M8 2l1.8 3.6L14 6.2l-3 2.9.7 4.1L8 11.3 4.3 13.2 5 9.1 2 6.2l4.2-.6z" />
        </svg>
      );
    case "settings":
      return (
        <svg viewBox="0 0 16 16" {...s}>
          <circle cx="8" cy="8" r="2.2" />
          <path d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4M12.6 12.6l-1.4-1.4M4.8 4.8L3.4 3.4" />
        </svg>
      );
    case "branch":
      return (
        <svg viewBox="0 0 16 16" {...s}>
          <circle cx="4" cy="3.5" r="1.5" />
          <circle cx="4" cy="12.5" r="1.5" />
          <circle cx="12" cy="5.5" r="1.5" />
          <path d="M4 5v6M4 8.5c4 0 8-1 8-4" />
        </svg>
      );
    case "check":
      return (
        <svg viewBox="0 0 16 16" {...s}>
          <path d="M3 8.5l3 3 7-7" />
        </svg>
      );
    case "x":
      return (
        <svg viewBox="0 0 16 16" {...s}>
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      );
    case "dot":
      return (
        <svg viewBox="0 0 16 16" {...s}>
          <circle cx="8" cy="8" r="2" fill={color} stroke="none" />
        </svg>
      );
    case "spinner":
      return (
        <svg viewBox="0 0 16 16" {...s} style={{ animation: "spin 1s linear infinite" }}>
          <path d="M8 2a6 6 0 016 6" />
        </svg>
      );
    case "caret":
      return (
        <svg viewBox="0 0 16 16" {...s}>
          <path d="M5 6l3 3 3-3" />
        </svg>
      );
    case "search":
      return (
        <svg viewBox="0 0 16 16" {...s}>
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.5 10.5L13 13" />
        </svg>
      );
    case "file":
      return (
        <svg viewBox="0 0 16 16" {...s}>
          <path d="M4 2h5l3 3v9H4z" />
        </svg>
      );
    case "pr":
      return (
        <svg viewBox="0 0 16 16" {...s}>
          <circle cx="4" cy="3.5" r="1.5" />
          <circle cx="4" cy="12.5" r="1.5" />
          <circle cx="12" cy="12.5" r="1.5" />
          <path d="M4 5v6M12 7.5V11M10 3.5h1a1 1 0 011 1v2M9 2.5l-1 1 1 1" />
        </svg>
      );
    case "bolt":
      return (
        <svg viewBox="0 0 16 16" {...s}>
          <path d="M9 2l-4 7h3l-1 5 4-7H8z" />
        </svg>
      );
    default:
      return null;
  }
}

export function MeshMark({ size = 18, color = MESH.fg }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ display: "block" }}>
      <circle cx="5" cy="5" r="2.2" stroke={color} strokeWidth="1.4" />
      <circle cx="19" cy="5" r="2.2" stroke={color} strokeWidth="1.4" />
      <circle cx="5" cy="19" r="2.2" stroke={color} strokeWidth="1.4" />
      <circle cx="19" cy="19" r="2.2" stroke={color} strokeWidth="1.4" />
      <circle cx="12" cy="12" r="2.4" fill={color} />
      <path
        d="M7 6.5L10.5 10.5M13.5 10.5L17 6.5M7 17.5L10.5 13.5M13.5 13.5L17 17.5"
        stroke={color}
        strokeWidth="1.2"
      />
    </svg>
  );
}
