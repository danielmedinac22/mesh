"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AppShell, MESH, Pill, ThinkingPanelRaw } from "@/components/mesh";
import { displayRepoName } from "@/lib/repo-display";
import type { RepoRunPlan } from "@/lib/repo-runner";

type Row = { id: string; key: string; value: string };

type RunStatus = "idle" | "starting" | "ready" | "failed" | "stopped";
type SessionView = {
  status: RunStatus;
  port?: number;
  url?: string;
  pid?: number;
  script?: string;
  startedAt?: string;
  logTail: string[];
};

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
  const [repoLabel, setRepoLabel] = useState<string | null>(null);

  const [importOpen, setImportOpen] = useState(false);
  const [importRaw, setImportRaw] = useState("");
  const [importMode, setImportMode] = useState<"merge" | "replace">("merge");
  const [importing, setImporting] = useState(false);
  const [importThinking, setImportThinking] = useState("");
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const importAbort = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const importPanelRef = useRef<HTMLDivElement | null>(null);

  // ── Run plan + preview session ───────────────────────────────────────────
  const [plan, setPlan] = useState<RepoRunPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [session, setSession] = useState<SessionView>({ status: "idle", logTail: [] });
  const [runBusy, setRunBusy] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const sseAbort = useRef<AbortController | null>(null);

  const refreshPlan = useCallback(async () => {
    setPlanError(null);
    try {
      const [planRes, statusRes] = await Promise.all([
        fetch(`/api/preview/plan?repo=${encodeURIComponent(name)}`, { cache: "no-store" }),
        fetch(`/api/preview/status?repo=${encodeURIComponent(name)}`, { cache: "no-store" }),
      ]);
      const planJson = await planRes.json();
      if (!planRes.ok) throw new Error(planJson?.error ?? `HTTP ${planRes.status}`);
      setPlan(planJson.plan as RepoRunPlan);
      if (statusRes.ok) {
        const sj = await statusRes.json();
        if (sj?.session) {
          setSession({
            status: sj.session.status,
            port: sj.session.port,
            url: sj.session.url,
            pid: sj.session.pid,
            script: sj.session.script,
            startedAt: sj.session.startedAt,
            logTail: sj.session.logTail ?? [],
          });
        }
      }
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : String(err));
    }
  }, [name]);

  useEffect(() => {
    void refreshPlan();
    return () => {
      sseAbort.current?.abort();
    };
  }, [refreshPlan]);

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

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/repos/${encodeURIComponent(name)}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = (await res.json()) as {
          repo?: { name: string; githubRepo?: string };
        };
        if (json.repo) setRepoLabel(displayRepoName(json.repo));
      } catch {
        // breadcrumb falls back to raw name
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

  // Persist current rows as the saved env, so a fresh `Start` picks up edits
  // the user typed but didn't click "save" on yet.
  async function persistRowsToEnv(): Promise<boolean> {
    const env: Record<string, string> = {};
    for (const row of rows) {
      const k = row.key.trim();
      if (!k) continue;
      env[k] = row.value;
    }
    const res = await fetch(`/api/repos/${encodeURIComponent(name)}/env`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(env),
    });
    return res.ok;
  }

  async function startRun() {
    setRunBusy(true);
    setRunError(null);
    setSession((s) => ({ ...s, status: "starting", logTail: [] }));
    if (!(await persistRowsToEnv())) {
      setRunError("could not save env before starting");
      setRunBusy(false);
      setSession((s) => ({ ...s, status: "failed" }));
      return;
    }
    const ctrl = new AbortController();
    sseAbort.current = ctrl;
    try {
      const res = await fetch(`/api/preview/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: name }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const events = buf.split(/\n\n/);
        buf = events.pop() ?? "";
        for (const block of events) {
          const line = block.trim();
          if (!line.startsWith("data:")) continue;
          const json = line.slice(5).trim();
          if (!json) continue;
          let ev: { type: string; [k: string]: unknown };
          try {
            ev = JSON.parse(json);
          } catch {
            continue;
          }
          handleRunEvent(ev);
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setRunError(err instanceof Error ? err.message : String(err));
      setSession((s) => ({ ...s, status: "failed" }));
    } finally {
      setRunBusy(false);
    }
  }

  function handleRunEvent(ev: { type: string; [k: string]: unknown }) {
    switch (ev.type) {
      case "log": {
        const chunk = String(ev.chunk ?? "");
        if (!chunk) break;
        const newLines = chunk.split(/\r?\n/).filter((l) => l.length > 0);
        if (newLines.length === 0) break;
        setSession((s) => ({
          ...s,
          logTail: [...s.logTail, ...newLines].slice(-200),
        }));
        break;
      }
      case "ready":
        setSession((s) => ({
          ...s,
          status: "ready",
          port: typeof ev.port === "number" ? ev.port : s.port,
          url: typeof ev.url === "string" ? ev.url : s.url,
        }));
        break;
      case "failed":
        setRunError(typeof ev.reason === "string" ? ev.reason : "preview failed");
        setSession((s) => ({ ...s, status: "failed" }));
        break;
      case "status":
        if (typeof ev.status === "string") {
          setSession((s) => ({ ...s, status: ev.status as RunStatus }));
        }
        break;
    }
  }

  async function stopRun() {
    sseAbort.current?.abort();
    await fetch(`/api/preview/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo: name }),
    }).catch(() => null);
    setSession((s) => ({ ...s, status: "stopped" }));
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
          <span>{repoLabel ?? name}</span>
          <span style={{ color: MESH.fgMute }}>/</span>
          <span className="font-mono" style={{ fontSize: 11, color: MESH.fgMute }}>
            env
          </span>
        </span>
      }
      subtitle={<>Configure &amp; run locally</>}
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

        <RunPlanSection
          plan={plan}
          planError={planError}
          session={session}
          runError={runError}
          runBusy={runBusy}
          rows={rows}
          onStart={() => void startRun()}
          onStop={() => void stopRun()}
          onOpenImport={() => {
            setImportOpen(true);
            // Wait for the panel to mount before scrolling.
            setTimeout(() => {
              importPanelRef.current?.scrollIntoView({
                behavior: "smooth",
                block: "start",
              });
            }, 50);
          }}
        />

        {loading ? (
          <p className="font-mono" style={{ fontSize: 12, color: MESH.fgMute }}>
            loading…
          </p>
        ) : (
          <>
            <div ref={importPanelRef}>
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
            </div>

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

// ──────────────────────────────────────────────────────────────────────────
// Run plan section — Phase 6 (raise repo locally guided by Claude)
// Lives inside the env page so the env-import (Claude-parsed file upload) and
// the run controls share one screen.
// ──────────────────────────────────────────────────────────────────────────

function RunPlanSection({
  plan,
  planError,
  session,
  runError,
  runBusy,
  rows,
  onStart,
  onStop,
  onOpenImport,
}: {
  plan: RepoRunPlan | null;
  planError: string | null;
  session: SessionView;
  runError: string | null;
  runBusy: boolean;
  rows: Row[];
  onStart: () => void;
  onStop: () => void;
  onOpenImport: () => void;
}) {
  if (planError) {
    return (
      <div
        className="font-mono"
        style={{
          marginBottom: 24,
          padding: 10,
          borderRadius: 6,
          border: `1px solid ${MESH.border}`,
          background: MESH.bgElev,
          color: MESH.red,
          fontSize: 12,
        }}
      >
        {planError}
      </div>
    );
  }
  if (!plan) {
    return (
      <p
        className="font-mono"
        style={{ fontSize: 11.5, color: MESH.fgMute, marginBottom: 24 }}
      >
        analyzing repo…
      </p>
    );
  }

  // "missing" = required key not present in the editor at all. A key with an
  // empty value still counts as present (some apps allow empty optional vars).
  const presentKeys = new Set(
    rows.map((r) => r.key.trim()).filter((k) => k.length > 0),
  );
  const missing = plan.env.required.filter((k) => !presentKeys.has(k));
  // Start is gated only on having a runnable script. Missing env vars don't
  // block — the detector lists "required" conservatively (some keys are
  // prod-only, or false positives from code-scan). If a real var is missing,
  // the running process will crash and the log tail will say so.
  const canStart = !!plan.recommendedScript && session.status !== "starting";
  const startLabel = missing.length > 0 ? "Start anyway" : "Start";

  return (
    <div
      style={{
        border: `1px solid ${MESH.border}`,
        background: MESH.bgElev,
        borderRadius: 8,
        padding: 16,
        marginBottom: 24,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          paddingBottom: 8,
          borderBottom: `1px solid ${MESH.border}`,
        }}
      >
        <span
          aria-hidden
          style={{ width: 4, height: 12, background: MESH.amber, borderRadius: 1 }}
        />
        <span className="mesh-hud" style={{ color: MESH.fgDim }}>
          RUN LOCALLY
        </span>
        {plan.packageManager && <Pill tone="dim">{plan.packageManager}</Pill>}
        {plan.recommendedScript ? (
          <Pill tone="amber">
            {plan.packageManager ?? "npm"} run {plan.recommendedScript}
          </Pill>
        ) : (
          <Pill tone="dim">no run script</Pill>
        )}
        {plan.scripts.length > 1 && (
          <span className="font-mono" style={{ fontSize: 10.5, color: MESH.fgMute }}>
            (also: {plan.scripts.slice(1).map((s) => s.name).join(", ")})
          </span>
        )}
      </div>

      {plan.federation.length > 0 && (
        <PlanCallout tone="amber" title="federation detected">
          {plan.federation.map((f, i) => (
            <div
              key={i}
              className="font-mono"
              style={{ fontSize: 11.5, color: MESH.fgDim }}
            >
              {f.kind} · <code style={{ color: MESH.amber }}>{f.file}</code>
              {f.remotes && f.remotes.length > 0 && (
                <> · remotes: {f.remotes.join(", ")}</>
              )}
            </div>
          ))}
          <p
            className="font-mono"
            style={{ fontSize: 11, color: MESH.fgMute, margin: "4px 0 0" }}
          >
            Mesh aún no resuelve módulos federados cross-repo automáticamente — levanta los hosts referenciados aparte si los necesitas.
          </p>
        </PlanCallout>
      )}
      {plan.monorepo && (
        <PlanCallout tone="dim" title="monorepo detected">
          <div className="font-mono" style={{ fontSize: 11.5, color: MESH.fgDim }}>
            tool: {plan.monorepo.tool} ·{" "}
            <code style={{ color: MESH.amber }}>{plan.monorepo.file}</code>
          </div>
        </PlanCallout>
      )}
      {plan.dockerCompose && (
        <PlanCallout tone="dim" title="docker compose detected">
          <div className="font-mono" style={{ fontSize: 11.5, color: MESH.fgDim }}>
            <code style={{ color: MESH.amber }}>{plan.dockerCompose.file}</code>
            {plan.dockerCompose.services.length > 0 && (
              <> · services: {plan.dockerCompose.services.join(", ")}</>
            )}
          </div>
        </PlanCallout>
      )}

      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        {session.status !== "ready" ? (
          <button
            onClick={onStart}
            disabled={!canStart || runBusy}
            className="font-mono"
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: `1px solid ${canStart ? MESH.amber : MESH.border}`,
              background: canStart ? MESH.amber : MESH.bgInput,
              color: canStart ? "#1a1206" : MESH.fgMute,
              fontSize: 12.5,
              fontWeight: 600,
              cursor: canStart ? "pointer" : "not-allowed",
            }}
          >
            {session.status === "starting" ? "starting…" : startLabel}
          </button>
        ) : (
          <button
            onClick={onStop}
            className="font-mono"
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: `1px solid ${MESH.border}`,
              background: MESH.bgInput,
              color: MESH.fgDim,
              fontSize: 12.5,
              cursor: "pointer",
            }}
          >
            Stop
          </button>
        )}
        {session.status === "ready" && session.url && (
          <a
            href={session.url}
            target="_blank"
            rel="noreferrer"
            className="font-mono"
            style={{ fontSize: 12, color: MESH.amber }}
          >
            {session.url} ↗
          </a>
        )}
        {session.status === "starting" && <Pill tone="amber">starting</Pill>}
        {session.status === "failed" && <Pill tone="dim">failed</Pill>}
        {session.status === "stopped" && <Pill tone="dim">stopped</Pill>}
        {missing.length > 0 && (
          <div
            className="font-mono"
            style={{
              fontSize: 11,
              color: MESH.fgMute,
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span>
              {missing.length} env var{missing.length === 1 ? "" : "s"} missing
            </span>
            <button
              type="button"
              onClick={onOpenImport}
              className="font-mono"
              style={{
                background: "transparent",
                border: "none",
                padding: 0,
                color: MESH.amber,
                cursor: "pointer",
                fontSize: 11,
              }}
            >
              import .env →
            </button>
          </div>
        )}
        {missing.length === 0 && plan.env.required.length > 0 && (
          <span className="font-mono" style={{ fontSize: 11, color: MESH.fgMute }}>
            {plan.env.required.length} required vars · all set
          </span>
        )}
      </div>

      {missing.length > 0 && (
        <div
          style={{
            border: `1px solid ${MESH.border}`,
            borderRadius: 6,
            background: MESH.bgInput,
            padding: "8px 12px",
            maxHeight: 130,
            overflowY: "auto",
          }}
        >
          <div
            className="font-mono"
            style={{ fontSize: 10.5, color: MESH.fgMute, marginBottom: 4 }}
          >
            MISSING (from {plan.env.source}
            {plan.env.exampleFile ? ` · ${plan.env.exampleFile}` : ""})
          </div>
          <div
            className="font-mono"
            style={{
              fontSize: 11.5,
              color: MESH.fgDim,
              display: "flex",
              flexWrap: "wrap",
              gap: "4px 10px",
              lineHeight: 1.6,
            }}
          >
            {missing.map((k) => (
              <code key={k} style={{ color: MESH.amber }}>
                {k}
              </code>
            ))}
          </div>
        </div>
      )}

      {runError && (
        <p
          className="font-mono"
          style={{ fontSize: 11.5, color: MESH.red, margin: 0 }}
        >
          {runError}
        </p>
      )}

      {session.logTail.length > 0 && <LogTail lines={session.logTail} />}
    </div>
  );
}

function PlanCallout({
  tone,
  title,
  children,
}: {
  tone: "amber" | "dim";
  title: string;
  children: React.ReactNode;
}) {
  const border = tone === "amber" ? "rgba(214,158,46,0.35)" : MESH.border;
  const bg = tone === "amber" ? "rgba(214,158,46,0.06)" : MESH.bgInput;
  return (
    <div
      style={{
        border: `1px solid ${border}`,
        background: bg,
        borderRadius: 6,
        padding: "8px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div
        className="font-mono"
        style={{ fontSize: 10.5, color: MESH.fgMute, letterSpacing: 0.5 }}
      >
        {title.toUpperCase()}
      </div>
      {children}
    </div>
  );
}

function LogTail({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [lines]);
  return (
    <div
      ref={ref}
      className="font-mono"
      style={{
        background: "#0b0b0b",
        border: `1px solid ${MESH.border}`,
        borderRadius: 6,
        padding: 10,
        fontSize: 11,
        color: MESH.fgDim,
        height: 180,
        overflow: "auto",
        whiteSpace: "pre-wrap",
        lineHeight: 1.5,
      }}
    >
      {lines.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </div>
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
