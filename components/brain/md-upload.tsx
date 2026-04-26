"use client";

import { useCallback, useRef, useState, type DragEvent } from "react";
import { MESH } from "@/components/mesh";

export function MdUpload({
  onUploaded,
}: {
  onUploaded: () => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [hover, setHover] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const ingest = useCallback(
    async (files: FileList | File[]) => {
      setError(null);
      setDone(null);
      const arr = Array.from(files).filter(
        (f) => f.name.endsWith(".md") || f.type === "text/markdown" || f.type === "text/plain",
      );
      if (arr.length === 0) {
        setError("Only .md or .txt files");
        return;
      }
      setBusy(true);
      let okCount = 0;
      try {
        for (const f of arr) {
          const text = await f.text();
          const title = stripFrontmatterTitle(text) ?? f.name.replace(/\.[^.]+$/, "");
          const body = text.trim();
          const res = await fetch("/api/brain", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              kind: "note",
              body,
              title,
              source: "upload",
              ref: f.name,
              tags: ["upload"],
            }),
          });
          if (res.ok) okCount++;
        }
        setDone(`${okCount} file${okCount === 1 ? "" : "s"} ingested`);
        onUploaded();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [onUploaded],
  );

  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setHover(false);
    void ingest(e.dataTransfer.files);
  };

  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setHover(true);
      }}
      onDragLeave={() => setHover(false)}
      onDrop={onDrop}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: "22px 18px",
        borderRadius: 8,
        border: `1px dashed ${hover ? "rgba(245,165,36,0.5)" : MESH.border}`,
        background: hover ? "rgba(245,165,36,0.05)" : MESH.bgElev,
        color: MESH.fgDim,
        cursor: "pointer",
        transition: "all var(--motion-fast) var(--ease)",
      }}
    >
      <input
        ref={fileRef}
        type="file"
        accept=".md,.txt,text/markdown,text/plain"
        multiple
        hidden
        onChange={(e) => e.target.files && ingest(e.target.files)}
      />
      <span
        className="font-mono"
        style={{
          fontSize: 11,
          color: MESH.fgDim,
          textTransform: "uppercase",
          letterSpacing: "0.14em",
        }}
      >
        {busy ? "ingesting…" : hover ? "drop to upload" : "drag .md files here"}
      </span>
      <span
        style={{
          fontSize: 12,
          color: MESH.fgMute,
        }}
      >
        or click to select — multi-file supported
      </span>
      {error && (
        <span style={{ fontSize: 11, color: MESH.red, marginTop: 4 }}>{error}</span>
      )}
      {done && (
        <span
          className="font-mono"
          style={{ fontSize: 11, color: MESH.green, marginTop: 4 }}
        >
          {done}
        </span>
      )}
    </label>
  );
}

function stripFrontmatterTitle(text: string): string | null {
  // YAML frontmatter title: ---\ntitle: foo\n---
  const fm = text.match(/^---\s*\n([\s\S]*?)\n---/);
  if (fm) {
    const m = fm[1].match(/^title:\s*(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  // Or first markdown # heading
  const h = text.match(/^#\s+(.+)$/m);
  if (h) return h[1].trim();
  return null;
}
