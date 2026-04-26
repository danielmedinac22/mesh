"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AppShell, MESH, Pill, ThinkingPanelRaw } from "@/components/mesh";

type Row = { id: string; key: string; value: string };

function newRow(): Row {
  return { id: Math.random().toString(36).slice(2), key: "", value: "" };
}

type ImportSkipped = { key?: string; value?: string; reason?: string };
type ImportSummary = {
  imported: Record<string, string>;
  skipped: ImportSkipped[];
  notes: string;
  mode: "merge" | "replace";
};

export default function RepoEnvPage() {
  const params = useParams<{ name: string }>();
  const name = params.name;
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [importOpen, setImportOpen] = useState(false);
  const [importRaw, setImportRaw] = useState("");
  const [importMode, setImportMode] = useState<"merge" | "replace">("merge");
  const [importing, setImporting] = useState(false);
  const [importThinking, setImportThinking] = useState("");
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const importAbort = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/repos/${name}/env`, { cache: "no-store" });
        const json = (await res.json()) as { env: Record<string, string> };
        const initial = Object.entries(json.env ?? {}).map(([key, value]) => ({
          id: Math.random().toString(36).slice(2),
          key,
          value,
        }));
        setRows(initial.length > 0 ? initial : [newRow()]);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [name]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const env: Record<string, string> = {};
      for (const row of rows) {
        const k = row.key.trim();
        if (!k) continue;
        env[k] = row.value;
      }
      const res = await fetch(`/api/repos/${name}/env`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(env),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const statusLabel = saving ? "saving…" : savedAt ? "saved" : "ready";
  const statusTone: "amber" | "green" | "dim" = saving ? "amber" : savedAt ? "green" : "dim";

  async function onPickFile(file: File) {
    try {
      const text = await file.text();
      setImportRaw(text);
      setImportOpen(true);
      setImportSummary(null);
      setImportError(null);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    }
  }

  async function runImport() {
    if (!importRaw.trim()) return;
    setImporting(true);
    setImportThinking("");
    setImportSummary(null);
    setImportError(null);
    importAbort.current?.abort();
    const ctrl = new AbortController();
    importAbort.current = ctrl;
    try {
      const res = await fetch(`/api/repos/${name}/env/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw: importRaw, mode: importMode }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buf.indexOf("\n\n")) !== -1) {
          const frame = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          for (const line of frame.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            try {
              const ev = JSON.parse(payload) as
                | { type: "thinking"; delta: string }
                | { type: "usage" }
                | {
                    type: "result";
                    env: Record<string, string>;
                    imported: Record<string, string>;
                    skipped: ImportSkipped[];
                    notes: string;
                    mode: "merge" | "replace";
                  }
                | { type: "error"; message: string };
              if (ev.type === "thinking") {
                setImportThinking((p) => p + ev.delta);
              } else if (ev.type === "result") {
                const nextRows = Object.entries(ev.env).map(([k, v]) => ({
                  id: Math.random().toString(36).slice(2),
                  key: k,
                  value: v,
                }));
                setRows(nextRows.length > 0 ? nextRows : [newRow()]);
                setImportSummary({
                  imported: ev.imported,
                  skipped: ev.skipped,
                  notes: ev.notes,
                  mode: ev.mode,
                });
                setSavedAt(Date.now());
              } else if (ev.type === "error") {
                setImportError(ev.message);
              }
            } catch {
              // ignore malformed line
            }
          }
        }
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setImportError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setImporting(false);
    }
  }

  function resetImport() {
    importAbort.current?.abort();
    setImportRaw("");
    setImportThinking("");
    setImportSummary(null);
    setImportError(null);
    setImporting(false);
  }

  return (
    <AppShell
      title={
        <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <Link
            href="/repos"
            className="font-mono"
            style={{ fontSize: 11, color: MESH.fgMute, textDecoration: "none" }}
          >
            repos
          </Link>
          <span style={{ color: MESH.fgMute }}>/</span>
          <span>{name}</span>
          <span style={{ color: MESH.fgMute }}>/</span>
          <span className="font-mono" style={{ fontSize: 11, color: MESH.fgMute }}>
            env
          </span>
        </span>
      }
      subtitle={<>Per-repo environment variables</>}
      topRight={<Pill tone={statusTone}>{statusLabel}</Pill>}
    >
      {error && (
        <div
          className="font-mono"
          style={{
            margin: "12px 24px 0",
            padding: 10,
            borderRadius: 6,
            border: "1px solid rgba(229,72,77,0.3)",
            background: "rgba(229,72,77,0.06)",
            color: MESH.red,
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "24px 32px 40px",
          maxWidth: 900,
          width: "100%",
          margin: "0 auto",
        }}
      >
        <p
          style={{
            fontSize: 13,
            color: MESH.fgDim,
            lineHeight: 1.6,
            marginTop: 0,
            marginBottom: 24,
          }}
        >
          Stored locally in{" "}
          <code
            className="font-mono"
            style={{
              background: MESH.bgElev,
              padding: "2px 6px",
              borderRadius: 4,
              fontSize: 11.5,
              color: MESH.amber,
              border: `1px solid ${MESH.border}`,
            }}
          >
            .mesh/repos/{name}/.env.json
          </code>
          . Injected into the preview dev server when you validate a staged change in Ship.
        </p>

        {loading ? (
          <p className="font-mono" style={{ fontSize: 12, color: MESH.fgMute }}>
            loading…
          </p>
        ) : (
          <>
            <ImportPanel
              open={importOpen}
              onToggle={() => {
                if (importOpen) resetImport();
                setImportOpen((v) => !v);
              }}
              raw={importRaw}
              onRawChange={setImportRaw}
              mode={importMode}
              onModeChange={setImportMode}
              importing={importing}
              thinking={importThinking}
              summary={importSummary}
              error={importError}
              onSubmit={runImport}
              onReset={resetImport}
              onPickFile={onPickFile}
              fileInputRef={fileInputRef}
            />

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                paddingBottom: 10,
                borderBottom: `1px solid ${MESH.border}`,
                marginBottom: 12,
              }}
            >
              <span
                aria-hidden
                style={{ width: 4, height: 14, background: MESH.amber, borderRadius: 1 }}
              />
              <span className="mesh-hud" style={{ color: MESH.fgDim }}>
                ENVIRONMENT VARIABLES
              </span>
              <span
                className="mesh-mono"
                style={{ fontSize: 11, color: MESH.fgMute, marginLeft: "auto" }}
              >
                {rows.filter((r) => r.key.trim().length > 0).length} keys
              </span>
            </div>
            <div
              className="mesh-bracket-wrap"
              style={{
                border: `1px solid ${MESH.border}`,
                background: MESH.bgElev,
                overflow: "hidden",
                position: "relative",
              }}
            >
              <span className="mesh-bracket-bl" />
              <span className="mesh-bracket-br" />
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1.5fr 100px",
                  padding: "10px 14px",
                  background: MESH.bgElev2,
                  borderBottom: `1px solid ${MESH.border}`,
                }}
              >
                {["key", "value", ""].map((label) => (
                  <span
                    key={label}
                    className="font-mono"
                    style={{
                      fontSize: 10,
                      color: MESH.fgMute,
                      textTransform: "uppercase",
                      letterSpacing: "0.14em",
                    }}
                  >
                    {label}
                  </span>
                ))}
              </div>
              {rows.map((row, i) => (
                <div
                  key={row.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1.5fr 100px",
                    padding: "8px 14px",
                    borderBottom:
                      i < rows.length - 1 ? `1px solid ${MESH.border}` : "none",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <input
                    value={row.key}
                    placeholder="DATABASE_URL"
                    onChange={(e) => {
                      const next = [...rows];
                      next[i] = { ...row, key: e.target.value };
                      setRows(next);
                    }}
                    className="font-mono"
                    style={{
                      background: MESH.bg,
                      color: MESH.fg,
                      border: `1px solid ${MESH.border}`,
                      borderRadius: 5,
                      padding: "6px 10px",
                      fontSize: 12,
                      outline: "none",
                    }}
                  />
                  <input
                    value={row.value}
                    placeholder="postgres://…"
                    onChange={(e) => {
                      const next = [...rows];
                      next[i] = { ...row, value: e.target.value };
                      setRows(next);
                    }}
                    className="font-mono"
                    style={{
                      background: MESH.bg,
                      color: MESH.fg,
                      border: `1px solid ${MESH.border}`,
                      borderRadius: 5,
                      padding: "6px 10px",
                      fontSize: 12,
                      outline: "none",
                    }}
                  />
                  <button
                    onClick={() => {
                      const next = rows.filter((_, j) => j !== i);
                      setRows(next.length > 0 ? next : [newRow()]);
                    }}
                    className="font-mono"
                    style={{
                      background: "transparent",
                      color: MESH.fgMute,
                      border: `1px solid ${MESH.border}`,
                      borderRadius: 5,
                      padding: "6px 10px",
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    remove
                  </button>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button
                onClick={() => setRows([...rows, newRow()])}
                className="font-mono"
                style={{
                  padding: "8px 12px",
                  borderRadius: 5,
                  border: `1px solid ${MESH.border}`,
                  background: "transparent",
                  color: MESH.fgDim,
                  fontSize: 11.5,
                  cursor: "pointer",
                }}
              >
                + add row
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="font-mono"
                style={{
                  padding: "8px 14px",
                  borderRadius: 5,
                  border: `1px solid ${MESH.amber}`,
                  background: saving ? "transparent" : MESH.amber,
                  color: saving ? MESH.amber : "#0B0B0C",
                  fontSize: 11.5,
                  fontWeight: 500,
                  opacity: saving ? 0.6 : 1,
                  cursor: saving ? "default" : "pointer",
                }}
              >
                {saving ? "saving…" : "save"}
              </button>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

function ImportPanel({
  open,
  onToggle,
  raw,
  onRawChange,
  mode,
  onModeChange,
  importing,
  thinking,
  summary,
  error,
  onSubmit,
  onReset,
  onPickFile,
  fileInputRef,
}: {
  open: boolean;
  onToggle: () => void;
  raw: string;
  onRawChange: (s: string) => void;
  mode: "merge" | "replace";
  onModeChange: (m: "merge" | "replace") => void;
  importing: boolean;
  thinking: string;
  summary: ImportSummary | null;
  error: string | null;
  onSubmit: () => void;
  onReset: () => void;
  onPickFile: (file: File) => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
}) {
  const importedCount = summary ? Object.keys(summary.imported).length : 0;
  return (
    <div
      style={{
        marginBottom: 24,
        border: `1px solid ${open ? MESH.borderHi : MESH.border}`,
        borderRadius: 8,
        overflow: "hidden",
        background: MESH.bgElev,
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="font-mono"
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 16px",
          background: "transparent",
          border: "none",
          color: MESH.fg,
          textAlign: "left",
          cursor: "pointer",
          fontSize: 12,
        }}
      >
        <span
          aria-hidden
          style={{ width: 4, height: 14, background: MESH.amber, borderRadius: 1 }}
        />
        <span className="mesh-hud" style={{ color: MESH.fgDim }}>
          IMPORT FROM .ENV
        </span>
        <span style={{ color: MESH.fgMute, fontSize: 11 }}>
          paste or upload a file — Opus 4.7 organizes it
        </span>
        <span style={{ marginLeft: "auto", color: MESH.fgMute, fontSize: 11 }}>
          {open ? "−" : "+"}
        </span>
      </button>

      {open && (
        <div
          style={{
            padding: "0 16px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              className="font-mono"
              style={{
                padding: "6px 12px",
                borderRadius: 5,
                border: `1px solid ${MESH.border}`,
                background: "transparent",
                color: MESH.fgDim,
                fontSize: 11.5,
                cursor: importing ? "default" : "pointer",
              }}
            >
              choose file…
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".env,.env.local,.env.example,.env.development,.env.production,.txt,text/plain"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onPickFile(f);
                e.target.value = "";
              }}
              style={{ display: "none" }}
            />
            <span className="font-mono" style={{ fontSize: 10.5, color: MESH.fgMute }}>
              or paste content below
            </span>
            <span style={{ flex: 1 }} />
            <label
              className="font-mono"
              style={{
                fontSize: 10.5,
                color: MESH.fgMute,
                display: "flex",
                alignItems: "center",
                gap: 6,
                cursor: importing ? "default" : "pointer",
              }}
            >
              <input
                type="radio"
                name="env-import-mode"
                checked={mode === "merge"}
                disabled={importing}
                onChange={() => onModeChange("merge")}
              />
              merge with existing
            </label>
            <label
              className="font-mono"
              style={{
                fontSize: 10.5,
                color: MESH.fgMute,
                display: "flex",
                alignItems: "center",
                gap: 6,
                cursor: importing ? "default" : "pointer",
              }}
            >
              <input
                type="radio"
                name="env-import-mode"
                checked={mode === "replace"}
                disabled={importing}
                onChange={() => onModeChange("replace")}
              />
              replace all
            </label>
          </div>
          <textarea
            value={raw}
            onChange={(e) => onRawChange(e.target.value)}
            placeholder={`# paste your .env content here\nDATABASE_URL=postgres://…\nAPI_KEY=sk-…`}
            spellCheck={false}
            disabled={importing}
            rows={8}
            className="font-mono"
            style={{
              width: "100%",
              background: MESH.bg,
              color: MESH.fg,
              border: `1px solid ${MESH.border}`,
              borderRadius: 5,
              padding: "10px 12px",
              fontSize: 12,
              outline: "none",
              resize: "vertical",
              lineHeight: 1.55,
            }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={onSubmit}
              disabled={importing || !raw.trim()}
              className="font-mono"
              style={{
                padding: "8px 14px",
                borderRadius: 5,
                border: `1px solid ${MESH.amber}`,
                background: importing || !raw.trim() ? "transparent" : MESH.amber,
                color: importing || !raw.trim() ? MESH.amber : "#0B0B0C",
                fontSize: 11.5,
                fontWeight: 500,
                cursor: importing || !raw.trim() ? "default" : "pointer",
                opacity: !raw.trim() ? 0.6 : 1,
              }}
            >
              {importing ? "claude is parsing…" : "parse with opus 4.7"}
            </button>
            <button
              type="button"
              onClick={onReset}
              disabled={importing && !raw}
              className="font-mono"
              style={{
                padding: "8px 12px",
                borderRadius: 5,
                border: `1px solid ${MESH.border}`,
                background: "transparent",
                color: MESH.fgDim,
                fontSize: 11.5,
                cursor: "pointer",
              }}
            >
              clear
            </button>
          </div>

          {(importing || thinking) && (
            <ThinkingPanelRaw
              text={thinking}
              tokens={thinking.length}
              active={importing}
              header="Organizing variables"
              sub="opus 4.7 · normalizing values · stripping placeholders"
              placeholder="Waiting for Opus to start…"
              style={{ minHeight: 180, maxHeight: 320 }}
            />
          )}

          {error && (
            <div
              className="font-mono"
              style={{
                padding: "10px 12px",
                borderRadius: 5,
                background: "rgba(229,72,77,0.06)",
                border: "1px solid rgba(229,72,77,0.3)",
                color: MESH.red,
                fontSize: 11.5,
              }}
            >
              {error}
            </div>
          )}

          {summary && (
            <div
              style={{
                padding: "12px 14px",
                borderRadius: 6,
                background: "rgba(48,164,108,0.06)",
                border: `1px solid rgba(48,164,108,0.30)`,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div
                className="mesh-hud"
                style={{
                  color: MESH.green,
                  letterSpacing: "0.16em",
                  fontSize: 10,
                }}
              >
                IMPORTED · {importedCount} KEY{importedCount === 1 ? "" : "S"} ·{" "}
                {summary.mode === "merge" ? "MERGED" : "REPLACED"}
              </div>
              {summary.notes && (
                <div
                  style={{
                    fontSize: 12,
                    color: MESH.fgDim,
                    lineHeight: 1.55,
                  }}
                >
                  {summary.notes}
                </div>
              )}
              {summary.skipped.length > 0 && (
                <details>
                  <summary
                    className="font-mono"
                    style={{
                      fontSize: 11,
                      color: MESH.fgMute,
                      cursor: "pointer",
                    }}
                  >
                    skipped {summary.skipped.length} entr
                    {summary.skipped.length === 1 ? "y" : "ies"}
                  </summary>
                  <div
                    style={{
                      marginTop: 6,
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    {summary.skipped.map((s, i) => (
                      <div
                        key={i}
                        className="font-mono"
                        style={{
                          fontSize: 10.5,
                          color: MESH.fgMute,
                          lineHeight: 1.55,
                        }}
                      >
                        <span style={{ color: MESH.amber }}>
                          {s.key ?? "(no key)"}
                        </span>
                        {s.reason ? ` · ${s.reason}` : ""}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
