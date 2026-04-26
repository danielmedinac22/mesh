"use client";

import { MESH, Pill } from "@/components/mesh";
import { SOURCE_META, type SourceKind } from "@/lib/role-playbooks";

export type ConnectState = "idle" | "connecting" | "fetching" | "done" | "error";

export function ConnectCard({
  source,
  state,
  count,
  selected,
  disabled,
  onToggle,
}: {
  source: SourceKind;
  state: ConnectState;
  count?: number;
  selected: boolean;
  disabled?: boolean;
  onToggle?: () => void;
}) {
  const meta = SOURCE_META[source];
  const live = meta.live && !disabled;
  const isInteractive = live && state === "idle";

  const pillTone =
    state === "done"
      ? "green"
      : state === "error"
      ? "red"
      : state === "connecting" || state === "fetching"
      ? "amber"
      : selected
      ? "amber"
      : "dim";

  const pillLabel =
    state === "done"
      ? `${count ?? 0} items`
      : state === "connecting"
      ? "auth…"
      : state === "fetching"
      ? "fetching…"
      : state === "error"
      ? "error"
      : !live
      ? "soon"
      : selected
      ? "selected"
      : "tap to add";

  return (
    <button
      type="button"
      disabled={!isInteractive}
      onClick={() => isInteractive && onToggle?.()}
      style={{
        position: "relative",
        padding: "16px 18px",
        borderRadius: 8,
        background: selected ? "rgba(245,165,36,0.06)" : MESH.bgElev,
        border: `1px solid ${
          selected
            ? "rgba(245,165,36,0.45)"
            : !live
            ? MESH.border
            : MESH.border
        }`,
        textAlign: "left",
        cursor: isInteractive ? "pointer" : !live ? "not-allowed" : "default",
        opacity: !live ? 0.55 : 1,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        color: MESH.fg,
        transition: "all var(--motion-fast) var(--ease)",
        minHeight: 110,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <SourceMark kind={source} />
        <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em" }}>
          {meta.label}
        </span>
        <span style={{ marginLeft: "auto" }}>
          <Pill tone={pillTone}>{pillLabel}</Pill>
        </span>
      </div>
      <p
        className="font-mono"
        style={{
          margin: 0,
          fontSize: 11.5,
          color: MESH.fgDim,
          lineHeight: 1.55,
        }}
      >
        {meta.tagline}
      </p>
    </button>
  );
}

function SourceMark({ kind }: { kind: SourceKind }) {
  const colorMap: Record<SourceKind, string> = {
    granola: "#FF8A4C",
    linear: "#5E6AD2",
    jira: "#2684FF",
    github: "#EDEDED",
    notion: "#EDEDED",
    figma: "#FF7262",
  };
  const c = colorMap[kind];
  return (
    <span
      style={{
        display: "inline-block",
        width: 16,
        height: 16,
        borderRadius: 4,
        background: `linear-gradient(135deg, ${c} 0%, ${c}80 100%)`,
        boxShadow: `0 0 0 1px ${MESH.border}`,
        flexShrink: 0,
      }}
    />
  );
}
