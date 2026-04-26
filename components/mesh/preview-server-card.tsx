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

export type PreviewEnvWarning = {
  missing: string[];
  source: "env-example" | "code-scan" | "none";
  exampleFile?: string | null;
  scannedFiles?: number | null;
};

export function PreviewServerCard({
  line,
  busy,
  onStart,
  onStop,
  envWarning,
  envHref,
  onForceStart,
  onDismissWarning,
}: {
  line: PreviewLine;
  busy: boolean;
  onStart: () => void;
  onStop: () => void;
  envWarning?: PreviewEnvWarning | null;
  envHref?: string;
  onForceStart?: () => void;
  onDismissWarning?: () => void;
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
      {envWarning && envWarning.missing.length > 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: "10px 12px",
            background: "rgba(245,165,36,0.06)",
            border: `1px solid ${MESH.amber}55`,
            borderRadius: 6,
          }}
        >
          <div
            className="mesh-hud"
            style={{
              color: MESH.amber,
              letterSpacing: "0.16em",
              fontSize: 10,
            }}
          >
            MESH FOUND {envWarning.missing.length} ENV KEY
            {envWarning.missing.length === 1 ? "" : "S"} THIS REPO NEEDS
          </div>
          <div
            className="font-mono"
            style={{
              fontSize: 11,
              color: MESH.fgDim,
              lineHeight: 1.55,
            }}
          >
            {envWarning.source === "env-example"
              ? `From ${envWarning.exampleFile ?? ".env.example"}`
              : envWarning.source === "code-scan"
                ? `Detected by scanning ${envWarning.scannedFiles ?? 0} source files`
                : "No env source found"}
            . Set these to make the preview boot reliably.
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
            }}
          >
            {envWarning.missing.map((k) => (
              <span
                key={k}
                className="font-mono"
                style={{
                  fontSize: 10.5,
                  padding: "3px 8px",
                  borderRadius: 4,
                  background: MESH.bg,
                  border: `1px solid ${MESH.amber}40`,
                  color: MESH.amber,
                  letterSpacing: "0.04em",
                }}
              >
                {k}
              </span>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {envHref && (
              <a
                href={envHref}
                className="font-mono"
                style={{
                  padding: "4px 10px",
                  borderRadius: 4,
                  border: `1px solid ${MESH.amber}`,
                  background: MESH.amber,
                  color: "#0B0B0C",
                  fontSize: 11,
                  textDecoration: "none",
                  fontWeight: 600,
                }}
              >
                set vars →
              </a>
            )}
            {onForceStart && (
              <button
                type="button"
                onClick={onForceStart}
                className="font-mono"
                style={{
                  padding: "4px 10px",
                  borderRadius: 4,
                  border: `1px solid ${MESH.border}`,
                  background: "transparent",
                  color: MESH.fgDim,
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                start anyway
              </button>
            )}
            {onDismissWarning && (
              <button
                type="button"
                onClick={onDismissWarning}
                aria-label="Dismiss warning"
                className="font-mono"
                style={{
                  marginLeft: "auto",
                  padding: "4px 8px",
                  borderRadius: 4,
                  background: "transparent",
                  border: "none",
                  color: MESH.fgMute,
                  fontSize: 10,
                  cursor: "pointer",
                }}
              >
                dismiss
              </button>
            )}
          </div>
        </div>
      )}
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
