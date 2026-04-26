"use client";

import { useState, type ReactNode } from "react";
import { MESH } from "@/components/mesh";
import { ProvenanceBadge } from "./provenance-badge";
import type { ProvenanceRef } from "@/lib/user-brain";

export function ProfileSection({
  label,
  filled,
  provenance,
  confidence,
  children,
  onAsk,
  onClear,
  span = 1,
}: {
  label: string;
  filled: boolean;
  provenance?: ProvenanceRef[];
  confidence?: number;
  children: ReactNode;
  onAsk?: () => void;
  onClear?: () => void;
  span?: 1 | 2;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <section
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        gridColumn: span === 2 ? "span 2" : undefined,
        position: "relative",
        padding: "16px 18px 14px",
        background: MESH.bgElev,
        border: `1px solid ${MESH.border}`,
        borderRadius: 8,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minHeight: 130,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <span
          aria-hidden
          style={{
            width: 4,
            height: 12,
            background: filled ? MESH.amber : MESH.border,
            borderRadius: 1,
          }}
        />
        <span
          className="font-mono"
          style={{
            fontSize: 10.5,
            color: filled ? MESH.fgDim : MESH.fgMute,
            textTransform: "uppercase",
            letterSpacing: "0.14em",
          }}
        >
          {label}
        </span>
        {typeof confidence === "number" && filled && (
          <ConfidenceBar value={confidence} />
        )}
        <ProvenanceBadge provenance={provenance} />
      </header>

      <div style={{ flex: 1 }}>{children}</div>

      {filled && hovered && (onAsk || onClear) && (
        <footer
          style={{
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
            opacity: 0.85,
          }}
        >
          {onAsk && (
            <ActionButton onClick={onAsk}>refresh</ActionButton>
          )}
          {onClear && (
            <ActionButton onClick={onClear} tone="red">
              clear
            </ActionButton>
          )}
        </footer>
      )}
    </section>
  );
}

export function EmptyDimension({
  hint,
  onAsk,
}: {
  hint: string;
  onAsk?: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        color: MESH.fgMute,
        fontSize: 12.5,
        lineHeight: 1.55,
        padding: "6px 0",
      }}
    >
      <span style={{ fontStyle: "italic" }}>{hint}</span>
      {onAsk && (
        <button
          type="button"
          onClick={onAsk}
          className="font-mono"
          style={{
            alignSelf: "flex-start",
            background: "transparent",
            border: `1px solid ${MESH.border}`,
            borderRadius: 4,
            padding: "4px 10px",
            color: MESH.amber,
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          ask Mesh
        </button>
      )}
    </div>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone = value > 0.7 ? MESH.green : value > 0.4 ? MESH.amber : MESH.fgMute;
  return (
    <span
      title={`confidence ${pct}%`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        marginLeft: 4,
      }}
    >
      <span
        style={{
          width: 36,
          height: 3,
          background: MESH.border,
          borderRadius: 2,
          overflow: "hidden",
          display: "block",
        }}
      >
        <span
          style={{
            display: "block",
            width: `${pct}%`,
            height: "100%",
            background: tone,
          }}
        />
      </span>
    </span>
  );
}

function ActionButton({
  children,
  onClick,
  tone,
}: {
  children: ReactNode;
  onClick: () => void;
  tone?: "red";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="font-mono"
      style={{
        background: "transparent",
        border: `1px solid ${MESH.border}`,
        borderRadius: 4,
        padding: "3px 8px",
        color: tone === "red" ? MESH.red : MESH.fgDim,
        fontSize: 10.5,
        cursor: "pointer",
        textTransform: "lowercase",
        letterSpacing: "0.04em",
      }}
    >
      {children}
    </button>
  );
}
