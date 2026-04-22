"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

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
        const res = await fetch(`/api/repos/${name}/env`, {
          cache: "no-store",
        });
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

  return (
    <main className="min-h-screen bg-background text-foreground p-6 flex flex-col gap-6 max-w-3xl mx-auto">
      <header className="flex items-baseline justify-between border-b border-border pb-4">
        <div className="flex items-baseline gap-3">
          <Link
            href="/repos"
            className="text-xs font-mono text-muted-foreground hover:text-accent"
          >
            repos
          </Link>
          <span className="text-muted-foreground">/</span>
          <h1 className="text-xl font-mono">{name}</h1>
          <span className="text-muted-foreground">/</span>
          <span className="text-sm font-mono text-muted-foreground">env</span>
        </div>
        <span className="text-xs font-mono text-muted-foreground">
          {saving ? "saving..." : savedAt ? "saved" : "ready"}
        </span>
      </header>

      <p className="text-sm text-muted-foreground">
        Per-repo environment variables. Stored locally in{" "}
        <code className="font-mono text-xs">.mesh/repos/{name}/.env.json</code>.
        These are not executed yet — they&apos;ll be picked up when build and
        preview land in later phases.
      </p>

      {error && (
        <div className="rounded-md border border-destructive bg-destructive/10 text-destructive p-3 font-mono text-xs">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground font-mono">loading...</p>
      ) : (
        <>
          <table className="w-full text-sm font-mono">
            <thead>
              <tr className="text-xs uppercase tracking-wider text-muted-foreground text-left">
                <th className="pb-2 font-normal">key</th>
                <th className="pb-2 font-normal">value</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.id}>
                  <td className="pr-2 py-1">
                    <input
                      className="w-full rounded-md border border-border bg-muted/50 px-2 py-1 focus:outline-none focus:border-accent"
                      value={row.key}
                      placeholder="DATABASE_URL"
                      onChange={(e) => {
                        const next = [...rows];
                        next[i] = { ...row, key: e.target.value };
                        setRows(next);
                      }}
                    />
                  </td>
                  <td className="pr-2 py-1">
                    <input
                      className="w-full rounded-md border border-border bg-muted/50 px-2 py-1 focus:outline-none focus:border-accent"
                      value={row.value}
                      placeholder="postgres://..."
                      onChange={(e) => {
                        const next = [...rows];
                        next[i] = { ...row, value: e.target.value };
                        setRows(next);
                      }}
                    />
                  </td>
                  <td className="py-1 w-16">
                    <button
                      onClick={() => {
                        const next = rows.filter((_, j) => j !== i);
                        setRows(next.length > 0 ? next : [newRow()]);
                      }}
                      className="text-xs text-muted-foreground hover:text-destructive"
                    >
                      remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex gap-2">
            <button
              onClick={() => setRows([...rows, newRow()])}
              className="text-xs font-mono rounded-md border border-border px-3 py-1.5 hover:border-accent hover:text-accent"
            >
              + add row
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="text-xs font-mono rounded-md border border-accent bg-accent text-accent-foreground px-3 py-1.5 hover:opacity-90 disabled:opacity-50"
            >
              save
            </button>
          </div>
        </>
      )}
    </main>
  );
}
