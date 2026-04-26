"use client";

import { useState } from "react";
import { MESH } from "./tokens";
import { Pill, Dot } from "./pill";
import { NavIcon } from "./icons";

export type CheckLine = {
  script: string;
  status: "idle" | "running" | "ok" | "fail" | "skipped";
  output: string;
  duration_ms?: number;
};

export function ChecksCard({
  repo,
  displayName,
  lines,
  running,
  onRun,
}: {
  repo: string;
  displayName?: string;
  lines: CheckLine[];
  running: boolean;
  onRun: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 12,
        background: MESH.bgElev,
        border: `1px solid ${MESH.border}`,
        borderRadius: 6,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          className="font-mono"
          style={{ fontSize: 11, color: MESH.fg, fontWeight: 500 }}
        >
          {displayName ?? repo}
        </span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={onRun}
          disabled={running}
          className="font-mono"
          style={{
            padding: "4px 10px",
            borderRadius: 4,
            border: `1px solid ${MESH.border}`,
            background: running ? "transparent" : MESH.bg,
            color: running ? MESH.fgMute : MESH.fgDim,
            fontSize: 11,
            cursor: running ? "default" : "pointer",
          }}
        >
          {running ? "running…" : "run checks"}
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {lines.length === 0 ? (
          <span
            className="font-mono"
            style={{ fontSize: 11, color: MESH.fgMute }}
          >
            click run checks to typecheck + lint
          </span>
        ) : (
          lines.map((l) => (
            <CheckRow
              key={l.script}
              line={l}
              expanded={open === l.script}
              onToggle={() =>
                setOpen((cur) => (cur === l.script ? null : l.script))
              }
            />
          ))
        )}
      </div>
    </div>
  );
}

function CheckRow({
  line,
  expanded,
  onToggle,
}: {
  line: CheckLine;
  expanded: boolean;
  onToggle: () => void;
}) {
  const tone =
    line.status === "ok"
      ? "green"
      : line.status === "fail"
        ? "red"
        : line.status === "running"
          ? "amber"
          : "dim";
  const dotColor =
    line.status === "ok"
      ? MESH.green
      : line.status === "fail"
        ? MESH.red
        : line.status === "running"
          ? MESH.amber
          : MESH.fgMute;
  const label =
    line.status === "skipped"
      ? "no script"
      : line.status === "running"
        ? "running"
        : line.status === "ok"
          ? "ok"
          : line.status === "fail"
            ? "failed"
            : "queued";
  return (
    <div
      style={{
        background: MESH.bg,
        border: `1px solid ${MESH.border}`,
        borderRadius: 4,
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: "100%",
          textAlign: "left",
          background: "transparent",
          border: "none",
          padding: "6px 10px",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Dot color={dotColor} size={6} />
        <span
          className="font-mono"
          style={{ fontSize: 11.5, color: MESH.fg, fontWeight: 500 }}
        >
          {line.script}
        </span>
        <span style={{ flex: 1 }} />
        {line.duration_ms !== undefined && (
          <span
            className="font-mono"
            style={{ fontSize: 10, color: MESH.fgMute }}
          >
            {Math.round(line.duration_ms)}ms
          </span>
        )}
        <Pill tone={tone}>{label}</Pill>
        <NavIcon kind="caret" color={MESH.fgMute} size={10} />
      </button>
      {expanded && line.output && (
        <pre
          className="font-mono"
          style={{
            fontSize: 10.5,
            lineHeight: "15px",
            color: MESH.fgDim,
            background: MESH.bgInput,
            margin: 0,
            padding: "8px 10px",
            borderTop: `1px solid ${MESH.border}`,
            maxHeight: 200,
            overflow: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {line.output.slice(-4000)}
        </pre>
      )}
    </div>
  );
}
