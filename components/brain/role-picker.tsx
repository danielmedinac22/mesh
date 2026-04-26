"use client";

import { useState } from "react";
import { MESH } from "@/components/mesh";
import { listPlaybooks } from "@/lib/role-playbooks";
import type { Role } from "@/lib/user-brain";

export function RolePicker({
  onPick,
}: {
  onPick: (role: Role, label: string, customLabel?: string) => void;
}) {
  const playbooks = listPlaybooks();
  const [hovered, setHovered] = useState<Role | null>(null);
  const [customRole, setCustomRole] = useState("");
  const otherActive = hovered === "other";

  return (
    <div
      style={{
        width: "100%",
        display: "flex",
        flexDirection: "column",
        gap: 18,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 12,
        }}
      >
        {playbooks.map((p) => {
          const isHover = hovered === p.id;
          const isOther = p.id === "other";
          return (
            <button
              key={p.id}
              type="button"
              onMouseEnter={() => setHovered(p.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => {
                if (isOther) {
                  const label = customRole.trim() || "Other";
                  onPick("other", label, customRole.trim() || undefined);
                } else {
                  onPick(p.id, p.label);
                }
              }}
              style={{
                position: "relative",
                padding: "16px 16px 14px",
                background: isHover ? "rgba(245,165,36,0.08)" : MESH.bgElev,
                border: `1px solid ${isHover ? "rgba(245,165,36,0.45)" : MESH.border}`,
                borderRadius: 8,
                color: MESH.fg,
                cursor: "pointer",
                textAlign: "left",
                display: "flex",
                flexDirection: "column",
                gap: 6,
                transition: "all var(--motion-fast) var(--ease)",
                boxShadow: isHover
                  ? "0 8px 24px rgba(0,0,0,0.4), inset 0 0 0 1px rgba(245,165,36,0.1)"
                  : "none",
                minHeight: 96,
              }}
            >
              <span
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  letterSpacing: "-0.01em",
                  color: isHover ? MESH.amber : MESH.fg,
                }}
              >
                {p.label}
              </span>
              <span
                className="font-mono"
                style={{
                  fontSize: 11,
                  color: MESH.fgMute,
                  lineHeight: 1.5,
                }}
              >
                {p.sources.primary.length} source
                {p.sources.primary.length === 1 ? "" : "s"} · {Object.keys(p.questions).length} dimensions
              </span>
            </button>
          );
        })}
      </div>

      {otherActive && (
        <input
          type="text"
          value={customRole}
          onChange={(e) => setCustomRole(e.target.value)}
          placeholder="Describe your role — e.g. Marketing Lead, Operations, Investor"
          style={{
            padding: "10px 12px",
            background: MESH.bgInput,
            border: `1px solid ${MESH.border}`,
            borderRadius: 6,
            color: MESH.fg,
            fontSize: 13,
            outline: "none",
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && customRole.trim()) {
              onPick("other", customRole.trim(), customRole.trim());
            }
          }}
        />
      )}
    </div>
  );
}
