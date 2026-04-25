"use client";

import { useState } from "react";
import { MESH } from "./tokens";
import { Pill, Dot } from "./pill";

export type PreviewLine = {
  repo: string;
  status:
    | "idle"
    | "installing"
    | "starting"
    | "ready"
    | "failed"
    | "stopped"
    | "unavailable";
  port?: number;
  url?: string;
  reason?: string;
  output: string;
};

const TONE: Record<PreviewLine["status"], "green" | "red" | "amber" | "dim" | "default"> = {
  idle: "dim",
  installing: "amber",
  starting: "amber",
  ready: "green",
  failed: "red",
  stopped: "dim",
  unavailable: "default",
};

const LABEL: Record<PreviewLine["status"], string> = {
  idle: "idle",
  installing: "installing deps",
  starting: "starting",
  ready: "ready",
  failed: "failed",
  stopped: "stopped",
  unavailable: "no dev script",
};

export function PreviewServerCard({
  line,
  busy,
  onStart,
  onStop,
}: {
  line: PreviewLine;
  busy: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  const [logsOpen, setLogsOpen] = useState(false);
  const dotColor =
    line.status === "ready"
      ? MESH.green
      : line.status === "failed"
        ? MESH.red
        : line.status === "starting" || line.status === "installing"
          ? MESH.amber
          : MESH.fgMute;
  const canStart =
    line.status === "idle" ||
    line.status === "stopped" ||
    line.status === "failed";
  const canStop = line.status === "ready" || line.status === "starting";

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
        <Dot color={dotColor} size={6} />
        <span
          className="font-mono"
          style={{ fontSize: 11.5, color: MESH.fg, fontWeight: 500 }}
        >
          {line.repo}
        </span>
        <Pill tone={TONE[line.status]}>{LABEL[line.status]}</Pill>
        <span style={{ flex: 1 }} />
        {canStop && (
          <button
            type="button"
            onClick={onStop}
            disabled={busy}
            className="font-mono"
            style={{
              padding: "4px 10px",
              borderRadius: 4,
              border: `1px solid ${MESH.border}`,
              background: MESH.bg,
              color: MESH.fgDim,
              fontSize: 11,
              cursor: busy ? "default" : "pointer",
            }}
          >
            stop
          </button>
        )}
        {canStart && line.status !== "unavailable" && (
          <button
            type="button"
            onClick={onStart}
            disabled={busy}
            className="font-mono"
            style={{
              padding: "4px 10px",
              borderRadius: 4,
              border: `1px solid ${MESH.amber}`,
              background: busy ? "transparent" : MESH.amber,
              color: busy ? MESH.amber : "#0B0B0C",
              fontSize: 11,
              cursor: busy ? "default" : "pointer",
            }}
          >
            start preview
          </button>
        )}
      </div>
      {line.url && line.status === "ready" && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 10px",
            background: MESH.bg,
            border: `1px solid rgba(48,164,108,0.25)`,
            borderRadius: 4,
          }}
        >
          <span
            className="font-mono"
            style={{ fontSize: 10, color: MESH.fgMute }}
          >
            preview
          </span>
          <a
            href={line.url}
            target="_blank"
            rel="noreferrer"
            className="font-mono"
            style={{
              fontSize: 11.5,
              color: MESH.green,
              textDecoration: "underline",
              wordBreak: "break-all",
            }}
          >
            {line.url}
          </a>
          <span style={{ flex: 1 }} />
          {line.port && (
            <span
              className="font-mono"
              style={{ fontSize: 10, color: MESH.fgMute }}
            >
              :{line.port}
            </span>
          )}
        </div>
      )}
      {line.reason && line.status === "failed" && (
        <div
          className="font-mono"
          style={{
            fontSize: 10.5,
            color: MESH.red,
            padding: "6px 10px",
            background: "rgba(229,72,77,0.05)",
            border: "1px solid rgba(229,72,77,0.2)",
            borderRadius: 4,
            wordBreak: "break-all",
          }}
        >
          {line.reason}
        </div>
      )}
      {line.output && (
        <button
          type="button"
          onClick={() => setLogsOpen((v) => !v)}
          className="font-mono"
          style={{
            fontSize: 10,
            color: MESH.fgDim,
            background: "transparent",
            border: "none",
            padding: 0,
            textAlign: "left",
            cursor: "pointer",
          }}
        >
          {logsOpen ? "hide logs" : "show logs"} ({line.output.split("\n").length} lines)
        </button>
      )}
      {logsOpen && line.output && (
        <pre
          className="font-mono"
          style={{
            fontSize: 10,
            lineHeight: "14px",
            color: MESH.fgDim,
            background: MESH.bgInput,
            margin: 0,
            padding: "8px 10px",
            borderRadius: 4,
            border: `1px solid ${MESH.border}`,
            maxHeight: 220,
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
