"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MESH } from "./tokens";
import { Dot } from "./pill";

export type ProjectColor = "amber" | "violet" | "blue" | "green" | "red" | "slate";

export const PROJECT_COLOR_MAP: Record<ProjectColor, string> = {
  amber: MESH.amber,
  violet: MESH.purple,
  blue: MESH.blue,
  green: MESH.green,
  red: MESH.red,
  slate: MESH.fgMute,
};

export type ProjectSummary = {
  id: string;
  name: string;
  label?: string;
  color: ProjectColor;
  repoCount: number;
};

export function ProjectSwitcher({
  projects,
  currentId,
  onChanged,
  variant = "default",
}: {
  projects: ProjectSummary[];
  currentId: string | null;
  onChanged?: () => void;
  variant?: "default" | "inline";
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [label, setLabel] = useState("");
  const [color, setColor] = useState<ProjectColor>("amber");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const current =
    projects.find((p) => p.id === currentId) ?? projects[0] ?? null;

  const select = useCallback(
    async (id: string) => {
      if (id === currentId) {
        setOpen(false);
        return;
      }
      setBusy(true);
      try {
        await fetch(`/api/projects/${encodeURIComponent(id)}/select`, {
          method: "POST",
        });
        setOpen(false);
        onChanged?.();
        router.refresh();
      } finally {
        setBusy(false);
      }
    },
    [currentId, onChanged, router],
  );

  const submitCreate = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          label: label.trim() || undefined,
          color,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data?.error === "string" ? data.error : "create failed");
        return;
      }
      setName("");
      setLabel("");
      setColor("amber");
      setCreating(false);
      setOpen(false);
      onChanged?.();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }, [name, label, color, onChanged, router]);

  const inline = variant === "inline";
  return (
    <div ref={ref} style={{ position: "relative", padding: inline ? 0 : "0 12px" }}>
      {!inline && (
        <div
          className="font-mono"
          style={{
            fontSize: 10,
            color: MESH.fgMute,
            textTransform: "uppercase",
            letterSpacing: "0.14em",
            marginBottom: 6,
            padding: "0 6px",
          }}
        >
          Project
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 10px",
          borderRadius: 6,
          background: open ? MESH.bgElev : "transparent",
          border: `1px solid ${open ? MESH.borderHi : MESH.border}`,
          color: MESH.fg,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        {current ? (
          <>
            <Dot color={PROJECT_COLOR_MAP[current.color]} size={7} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  letterSpacing: "-0.01em",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {current.name}
              </div>
              {current.label && (
                <div
                  className="font-mono"
                  style={{
                    fontSize: 10,
                    color: MESH.fgMute,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {current.label}
                </div>
              )}
            </div>
          </>
        ) : (
          <span
            className="font-mono"
            style={{ fontSize: 12, color: MESH.fgMute }}
          >
            No project yet
          </span>
        )}
        <span
          style={{
            color: MESH.fgMute,
            fontSize: 10,
            marginLeft: "auto",
            transform: open ? "rotate(180deg)" : undefined,
            transition: "transform 120ms",
          }}
        >
          ▾
        </span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: inline ? 0 : 12,
            right: inline ? 0 : 12,
            background: MESH.bgElev,
            border: `1px solid ${MESH.borderHi}`,
            borderRadius: 8,
            padding: 6,
            zIndex: 50,
            boxShadow: "0 12px 24px rgba(0,0,0,0.4)",
          }}
        >
          {projects.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={busy}
              onClick={() => select(p.id)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 10px",
                borderRadius: 5,
                background:
                  p.id === currentId ? "rgba(245,165,36,0.06)" : "transparent",
                border: "none",
                color: MESH.fg,
                cursor: busy ? "wait" : "pointer",
                textAlign: "left",
              }}
            >
              <Dot color={PROJECT_COLOR_MAP[p.color]} size={6} />
              <span
                style={{
                  fontSize: 12,
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {p.name}
              </span>
              <span
                className="font-mono"
                style={{ fontSize: 10, color: MESH.fgMute }}
              >
                {p.repoCount}
              </span>
            </button>
          ))}
          {!creating ? (
            <button
              type="button"
              onClick={() => setCreating(true)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px",
                borderRadius: 5,
                background: "transparent",
                border: "none",
                color: MESH.fgDim,
                cursor: "pointer",
                textAlign: "left",
                marginTop: 4,
                borderTop:
                  projects.length > 0 ? `1px solid ${MESH.border}` : undefined,
              }}
            >
              <span style={{ fontSize: 12, color: MESH.amber }}>+</span>
              <span style={{ fontSize: 12 }}>New project</span>
            </button>
          ) : (
            <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Project name"
                style={{
                  padding: "6px 8px",
                  background: MESH.bgInput,
                  border: `1px solid ${MESH.border}`,
                  borderRadius: 4,
                  color: MESH.fg,
                  fontSize: 12,
                  outline: "none",
                }}
              />
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Label (optional, e.g. SaaS billing)"
                style={{
                  padding: "6px 8px",
                  background: MESH.bgInput,
                  border: `1px solid ${MESH.border}`,
                  borderRadius: 4,
                  color: MESH.fg,
                  fontSize: 12,
                  outline: "none",
                }}
              />
              <div style={{ display: "flex", gap: 6, paddingTop: 2 }}>
                {(Object.keys(PROJECT_COLOR_MAP) as ProjectColor[]).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    aria-label={`color ${c}`}
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 999,
                      background: PROJECT_COLOR_MAP[c],
                      border:
                        color === c
                          ? `2px solid ${MESH.fg}`
                          : `2px solid transparent`,
                      cursor: "pointer",
                      padding: 0,
                    }}
                  />
                ))}
              </div>
              {error && (
                <div
                  className="font-mono"
                  style={{ fontSize: 10, color: MESH.red }}
                >
                  {error}
                </div>
              )}
              <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={() => {
                    setCreating(false);
                    setError(null);
                  }}
                  style={{
                    padding: "5px 10px",
                    background: "transparent",
                    border: `1px solid ${MESH.border}`,
                    borderRadius: 4,
                    color: MESH.fgDim,
                    fontSize: 11,
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busy || !name.trim()}
                  onClick={submitCreate}
                  style={{
                    padding: "5px 10px",
                    background: MESH.amber,
                    border: `1px solid ${MESH.amber}`,
                    borderRadius: 4,
                    color: "#0B0B0C",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: busy ? "wait" : "pointer",
                    opacity: !name.trim() ? 0.5 : 1,
                  }}
                >
                  Create
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
