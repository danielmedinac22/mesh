"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AppShell, MESH, Pill } from "@/components/mesh";

type Row = { id: string; key: string; value: string };

function newRow(): Row {
  return { id: Math.random().toString(36).slice(2), key: "", value: "" };
}

export default function RepoEnvPage() {
  const params = useParams<{ name: string }>();
  const name = params.name;
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

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
            <div
              style={{
                border: `1px solid ${MESH.border}`,
                borderRadius: 8,
                background: MESH.bgElev,
                overflow: "hidden",
              }}
            >
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
