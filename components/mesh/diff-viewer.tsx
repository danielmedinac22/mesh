"use client";

import { useMemo, useState } from "react";
import { MESH } from "./tokens";
import { Pill } from "./pill";
import { NavIcon } from "./icons";

export type DiffHunkLine = { kind: "ctx" | "add" | "del"; text: string };
export type DiffHunkView = {
  header: string;
  oldStart: number;
  newStart: number;
  lines: DiffHunkLine[];
};
export type DiffFileView = {
  path: string;
  oldPath?: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  binary: boolean;
  hunks: DiffHunkView[];
};

const STATUS_TONE: Record<DiffFileView["status"], "green" | "red" | "amber" | "default"> = {
  added: "green",
  deleted: "red",
  modified: "amber",
  renamed: "default",
};

export function DiffViewer({
  files,
  base,
  branch,
  empty,
}: {
  files: DiffFileView[];
  base: string;
  branch: string;
  empty?: string;
}) {
  const [activePath, setActivePath] = useState<string | null>(
    files[0]?.path ?? null,
  );
  const active = useMemo(
    () => files.find((f) => f.path === activePath) ?? files[0] ?? null,
    [files, activePath],
  );

  if (files.length === 0) {
    return (
      <div
        className="font-mono"
        style={{
          fontSize: 11,
          color: MESH.fgMute,
          padding: 14,
          border: `1px dashed ${MESH.border}`,
          borderRadius: 6,
        }}
      >
        {empty ?? `no changes between ${branch} and ${base}`}
      </div>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "240px 1fr",
        gap: 12,
        minHeight: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          maxHeight: 520,
          overflowY: "auto",
          paddingRight: 4,
        }}
      >
        <div
          className="font-mono"
          style={{
            fontSize: 9,
            color: MESH.fgMute,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            margin: "2px 4px 6px",
          }}
        >
          {files.length} file{files.length !== 1 ? "s" : ""} · {branch} → {base}
        </div>
        {files.map((f) => {
          const isActive = f.path === active?.path;
          return (
            <button
              type="button"
              key={f.path}
              onClick={() => setActivePath(f.path)}
              style={{
                textAlign: "left",
                background: isActive ? "rgba(245,165,36,0.08)" : "transparent",
                border: `1px solid ${
                  isActive ? "rgba(245,165,36,0.35)" : "transparent"
                }`,
                borderRadius: 5,
                padding: "6px 8px",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <NavIcon kind="file" color={MESH.fgDim} size={10} />
                <span
                  className="font-mono"
                  style={{
                    fontSize: 11,
                    color: isActive ? MESH.amber : MESH.fg,
                    fontWeight: 500,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  {basename(f.path)}
                </span>
                <Pill tone={STATUS_TONE[f.status]}>{f.status[0].toUpperCase()}</Pill>
              </div>
              <div
                className="font-mono"
                style={{
                  fontSize: 9.5,
                  color: MESH.fgMute,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {dirname(f.path)}
              </div>
              <div
                className="font-mono"
                style={{ fontSize: 9.5, display: "flex", gap: 6 }}
              >
                <span style={{ color: MESH.green }}>+{f.additions}</span>
                <span style={{ color: MESH.red }}>−{f.deletions}</span>
              </div>
            </button>
          );
        })}
      </div>
      <div
        style={{
          background: MESH.bgInput,
          border: `1px solid ${MESH.border}`,
          borderRadius: 6,
          maxHeight: 520,
          overflow: "auto",
          padding: "8px 10px",
        }}
      >
        {active ? <FileBody file={active} /> : null}
      </div>
    </div>
  );
}

function FileBody({ file }: { file: DiffFileView }) {
  if (file.binary) {
    return (
      <div className="font-mono" style={{ fontSize: 11, color: MESH.fgMute }}>
        binary file ({file.additions + file.deletions} bytes changed)
      </div>
    );
  }
  if (file.hunks.length === 0) {
    return (
      <div className="font-mono" style={{ fontSize: 11, color: MESH.fgMute }}>
        no hunks (file is {file.status})
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        className="font-mono"
        style={{
          fontSize: 11,
          color: MESH.fg,
          fontWeight: 500,
          paddingBottom: 6,
          borderBottom: `1px solid ${MESH.border}`,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span>{file.path}</span>
        <span style={{ color: MESH.green, fontSize: 10 }}>+{file.additions}</span>
        <span style={{ color: MESH.red, fontSize: 10 }}>−{file.deletions}</span>
      </div>
      {file.hunks.map((h, i) => (
        <Hunk key={i} hunk={h} />
      ))}
    </div>
  );
}

function Hunk({ hunk }: { hunk: DiffHunkView }) {
  let oldLn = hunk.oldStart;
  let newLn = hunk.newStart;
  return (
    <div>
      <div
        className="font-mono"
        style={{
          fontSize: 10,
          color: MESH.fgMute,
          background: MESH.bgElev,
          padding: "2px 6px",
          borderRadius: 3,
          marginBottom: 4,
        }}
      >
        {hunk.header}
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {hunk.lines.map((line, idx) => {
          const bg =
            line.kind === "add"
              ? "rgba(48,164,108,0.10)"
              : line.kind === "del"
                ? "rgba(229,72,77,0.10)"
                : "transparent";
          const fg =
            line.kind === "add"
              ? MESH.green
              : line.kind === "del"
                ? MESH.red
                : MESH.fgDim;
          const sign =
            line.kind === "add" ? "+" : line.kind === "del" ? "−" : " ";
          const oldLabel = line.kind === "add" ? "" : oldLn;
          const newLabel = line.kind === "del" ? "" : newLn;
          if (line.kind !== "add") oldLn += 1;
          if (line.kind !== "del") newLn += 1;
          return (
            <div
              key={idx}
              className="font-mono"
              style={{
                display: "grid",
                gridTemplateColumns: "32px 32px 14px 1fr",
                fontSize: 11,
                lineHeight: "17px",
                background: bg,
                color: fg,
              }}
            >
              <span style={{ color: MESH.fgMute, textAlign: "right", paddingRight: 6 }}>
                {oldLabel}
              </span>
              <span style={{ color: MESH.fgMute, textAlign: "right", paddingRight: 6 }}>
                {newLabel}
              </span>
              <span style={{ textAlign: "center" }}>{sign}</span>
              <span style={{ whiteSpace: "pre" }}>{line.text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1);
}
function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
}
