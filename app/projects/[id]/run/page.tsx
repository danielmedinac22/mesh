"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AppShell, MESH, Pill, ThinkingPanelRaw } from "@/components/mesh";
import type { StoredRunPlan, RunRole } from "@/lib/run-planner";

type RunPlannerEvent =
  | { type: "thinking"; delta: string }
  | { type: "text"; delta: string }
  | { type: "done"; plan: StoredRunPlan; duration_ms: number }
  | { type: "error"; message: string };

type ProjectInfo = {
  id: string;
  name: string;
  label?: string;
  description?: string;
  repos: string[];
};

type RunSessionState = {
  status:
    | "idle"
    | "installing"
    | "starting"
    | "ready"
    | "failed"
    | "stopped";
  port?: number;
  url?: string;
  failKind?: string;
  failReason?: string;
  logTail: string[];
};

type ServerSession = {
  status: string;
  port: number;
  url: string;
  pid: number;
  script: string;
  startedAt: string;
  logTail: string[];
};

const ROLE_LABEL: Record<RunRole, string> = {
  host: "host",
  remote: "remote",
  backend: "backend",
  standalone: "standalone",
  skipped: "skipped",
};

const ROLE_TONE: Record<RunRole, "amber" | "dim"> = {
  host: "amber",
  remote: "dim",
  backend: "dim",
  standalone: "dim",
  skipped: "dim",
};

export default function ProjectRunPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [plan, setPlan] = useState<StoredRunPlan | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [planning, setPlanning] = useState(false);
  const [thinking, setThinking] = useState("");
  const [planError, setPlanError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ── live run state (per repo) ────────────────────────────────────────────
  const [runs, setRuns] = useState<Record<string, RunSessionState>>({});
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const runAbortRef = useRef<AbortController | null>(null);

  const updateRun = useCallback(
    (repo: string, patch: Partial<RunSessionState>) => {
      setRuns((cur) => ({
        ...cur,
        [repo]: { ...(cur[repo] ?? { status: "idle", logTail: [] }), ...patch },
      }));
    },
    [],
  );

  const appendLog = useCallback((repo: string, chunk: string) => {
    if (!chunk) return;
    const newLines = chunk.split(/\r?\n/).filter((l) => l.length > 0);
    if (newLines.length === 0) return;
    setRuns((cur) => {
      const prev = cur[repo] ?? { status: "idle", logTail: [] };
      return {
        ...cur,
        [repo]: {
          ...prev,
          logTail: [...prev.logTail, ...newLines].slice(-200),
        },
      };
    });
  }, []);

  const hydrateRuns = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/preview/status?project=${encodeURIComponent(projectId)}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const j = (await res.json()) as {
        sessions: { repo: string; session: ServerSession | null }[];
      };
      const next: Record<string, RunSessionState> = {};
      for (const s of j.sessions) {
        if (!s.session) continue;
        next[s.repo] = {
          status: s.session.status as RunSessionState["status"],
          port: s.session.port || undefined,
          url: s.session.url || undefined,
          logTail: s.session.logTail ?? [],
        };
      }
      setRuns(next);
    } catch {
      // silent — empty state is fine
    }
  }, [projectId]);

  const runAll = useCallback(async () => {
    if (!plan) return;
    setRunning(true);
    setRunError(null);
    // Reset run state for non-skipped repos so the user sees progress fresh.
    setRuns((cur) => {
      const next: Record<string, RunSessionState> = { ...cur };
      for (const r of plan.perRepo) {
        if (r.role === "skipped") continue;
        next[r.name] = { status: "starting", logTail: [] };
      }
      return next;
    });
    runAbortRef.current?.abort();
    const ctrl = new AbortController();
    runAbortRef.current = ctrl;
    try {
      const res = await fetch(`/api/preview/start-project`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
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
        let sep: number;
        while ((sep = buf.indexOf("\n\n")) !== -1) {
          const frame = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          for (const line of frame.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            let ev: Record<string, unknown>;
            try {
              ev = JSON.parse(payload) as Record<string, unknown>;
            } catch {
              continue;
            }
            handleProjectEvent(ev);
          }
        }
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setRunError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setRunning(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, projectId]);

  const handleProjectEvent = useCallback(
    (ev: Record<string, unknown>) => {
      const repo = typeof ev.repo === "string" ? ev.repo : null;
      const type = ev.type as string;
      if (repo) {
        switch (type) {
          case "status":
            updateRun(repo, {
              status: (ev.status as RunSessionState["status"]) ?? "starting",
            });
            break;
          case "log":
            appendLog(repo, String(ev.chunk ?? ""));
            break;
          case "ready":
            updateRun(repo, {
              status: "ready",
              port: typeof ev.port === "number" ? ev.port : undefined,
              url: typeof ev.url === "string" ? ev.url : undefined,
            });
            break;
          case "failed":
            updateRun(repo, {
              status: "failed",
              failKind:
                typeof ev.failKind === "string" ? ev.failKind : undefined,
              failReason:
                typeof ev.reason === "string" ? ev.reason : undefined,
            });
            break;
        }
      }
    },
    [updateRun, appendLog],
  );

  const stopAll = useCallback(async () => {
    runAbortRef.current?.abort();
    await fetch(`/api/preview/stop-project`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    }).catch(() => null);
    // Clear in-memory runs so cards drop back to idle.
    setRuns({});
  }, [projectId]);

  // ── load project + cached plan, auto-generate if missing ─────────────────
  useEffect(() => {
    void (async () => {
      try {
        const projRes = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}`,
          { cache: "no-store" },
        );
        if (projRes.ok) {
          const j = await projRes.json();
          if (j?.project) {
            setProject({
              id: j.project.id,
              name: j.project.name,
              label: j.project.label,
              description: j.project.description,
              repos: j.project.repos ?? [],
            });
          }
        }
        // Hydrate any in-flight or finished sessions in parallel — they
        // survive Next dev reloads, so the user sees status without re-run.
        void hydrateRuns();
        const planRes = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/run-plan`,
          { cache: "no-store" },
        );
        if (planRes.ok) {
          const j = (await planRes.json()) as { plan: StoredRunPlan | null };
          if (j.plan) {
            setPlan(j.plan);
            setBootstrapping(false);
            return;
          }
        }
        setBootstrapping(false);
        // No cached plan → kick off generation immediately.
        void runPlanner();
      } catch (err) {
        setBootstrapping(false);
        setPlanError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      abortRef.current?.abort();
      runAbortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const runPlanner = useCallback(async () => {
    setPlanning(true);
    setPlanError(null);
    setThinking("");
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/run-plan`,
        {
          method: "POST",
          signal: ctrl.signal,
        },
      );
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
        let sep: number;
        while ((sep = buf.indexOf("\n\n")) !== -1) {
          const frame = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          for (const line of frame.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            let ev: RunPlannerEvent;
            try {
              ev = JSON.parse(payload) as RunPlannerEvent;
            } catch {
              continue;
            }
            if (ev.type === "thinking") {
              setThinking((t) => t + ev.delta);
            } else if (ev.type === "done") {
              setPlan(ev.plan);
            } else if (ev.type === "error") {
              setPlanError(ev.message);
            }
          }
        }
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setPlanError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setPlanning(false);
    }
  }, [projectId]);

  return (
    <AppShell
      title={
        <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <Link
            href="/projects"
            className="font-mono"
            style={{ fontSize: 11, color: MESH.fgMute, textDecoration: "none" }}
          >
            projects
          </Link>
          <span style={{ color: MESH.fgMute }}>/</span>
          <span>{project?.name ?? projectId}</span>
          <span style={{ color: MESH.fgMute }}>/</span>
          <span className="font-mono" style={{ fontSize: 11, color: MESH.fgMute }}>
            run
          </span>
        </span>
      }
      subtitle={<>Levantar el proyecto local</>}
      topRight={
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {plan && (
            <RunAllButton
              running={running}
              hasReady={Object.values(runs).some((r) => r.status === "ready")}
              onRun={() => void runAll()}
              onStop={() => void stopAll()}
            />
          )}
          <button
            onClick={() => void runPlanner()}
            disabled={planning}
            className="font-mono"
            style={{
              padding: "6px 12px",
              borderRadius: 5,
              border: `1px solid ${MESH.border}`,
              color: planning ? MESH.fgMute : MESH.fgDim,
              fontSize: 11.5,
              background: "transparent",
              cursor: planning ? "wait" : "pointer",
            }}
          >
            {planning ? "thinking…" : plan ? "re-plan" : "plan"}
          </button>
        </div>
      }
    >
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "24px 32px 80px",
          maxWidth: 1100,
          width: "100%",
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: 24,
        }}
      >
        {planError && (
          <div
            className="font-mono"
            style={{
              padding: 10,
              borderRadius: 6,
              border: "1px solid rgba(229,72,77,0.3)",
              background: "rgba(229,72,77,0.06)",
              color: MESH.red,
              fontSize: 12,
            }}
          >
            {planError}
          </div>
        )}

        {bootstrapping ? (
          <PlannerThinking
            thinking=""
            planning={true}
            label="checking cache…"
          />
        ) : (planning || thinking.length > 0) ? (
          <PlannerThinking thinking={thinking} planning={planning} />
        ) : null}

        {runError && (
          <div
            className="font-mono"
            style={{
              padding: 10,
              borderRadius: 6,
              border: "1px solid rgba(229,72,77,0.3)",
              background: "rgba(229,72,77,0.06)",
              color: MESH.red,
              fontSize: 12,
            }}
          >
            {runError}
          </div>
        )}

        {plan ? (
          <PlanView
            plan={plan}
            project={project}
            runs={runs}
            running={running}
          />
        ) : (
          !bootstrapping &&
          !planning && (
            <p
              className="font-mono"
              style={{ fontSize: 12, color: MESH.fgMute }}
            >
              No hay plan todavía. Click <strong>plan</strong> arriba.
            </p>
          )
        )}
      </div>
    </AppShell>
  );
}

function PlannerThinking({
  thinking,
  planning,
  label,
}: {
  thinking: string;
  planning: boolean;
  label?: string;
}) {
  return (
    <div
      style={{
        border: `1px solid ${MESH.border}`,
        borderRadius: 8,
        background: MESH.bgElev,
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <span
          aria-hidden
          style={{ width: 4, height: 12, background: MESH.amber, borderRadius: 1 }}
        />
        <span className="mesh-hud" style={{ color: MESH.fgDim }}>
          CLAUDE PLANNING
        </span>
        {planning && <Pill tone="amber">{label ?? "streaming"}</Pill>}
      </div>
      {thinking.length > 0 ? (
        <ThinkingPanelRaw text={thinking} />
      ) : (
        <p
          className="font-mono"
          style={{
            fontSize: 11.5,
            color: MESH.fgMute,
            margin: 0,
            lineHeight: 1.6,
          }}
        >
          {label ?? "starting…"}
        </p>
      )}
    </div>
  );
}

function PlanView({
  plan,
  project,
  runs,
  running,
}: {
  plan: StoredRunPlan;
  project: ProjectInfo | null;
  runs: Record<string, RunSessionState>;
  running: boolean;
}) {
  const totalRepos = plan.perRepo.length;
  const skipped = plan.perRepo.filter((r) => r.role === "skipped").length;
  const runnable = totalRepos - skipped;
  const readyCount = Object.values(runs).filter(
    (r) => r.status === "ready",
  ).length;
  const failedCount = Object.values(runs).filter(
    (r) => r.status === "failed",
  ).length;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Section title="Plan">
        <div
          style={{
            border: `1px solid ${MESH.border}`,
            borderRadius: 8,
            background: MESH.bgElev,
            padding: 14,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 10,
            }}
          >
            <Pill tone="amber">
              {plan.waves.length} {plan.waves.length === 1 ? "wave" : "waves"}
            </Pill>
            <Pill tone="dim">
              {runnable}/{totalRepos} runnable
            </Pill>
            {skipped > 0 && <Pill tone="dim">{skipped} skipped</Pill>}
            {readyCount > 0 && (
              <Pill tone="green">
                {readyCount}/{runnable} ready
              </Pill>
            )}
            {failedCount > 0 && (
              <Pill tone="red">
                {failedCount} failed
              </Pill>
            )}
            {running && <Pill tone="amber">running</Pill>}
            <span
              className="font-mono"
              style={{ fontSize: 10.5, color: MESH.fgMute, marginLeft: "auto" }}
            >
              generated {plan.generated_at}
            </span>
          </div>
          <p
            style={{
              fontSize: 13,
              color: MESH.fgDim,
              lineHeight: 1.6,
              margin: 0,
            }}
          >
            {plan.rationale}
          </p>
          {plan.waves.length > 0 && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                paddingTop: 8,
                borderTop: `1px solid ${MESH.border}`,
              }}
            >
              {plan.waves.map((wave, i) => (
                <div
                  key={i}
                  className="font-mono"
                  style={{
                    fontSize: 12,
                    color: MESH.fgDim,
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 6,
                    alignItems: "center",
                  }}
                >
                  <span style={{ color: MESH.fgMute, minWidth: 60 }}>
                    wave {i + 1}
                  </span>
                  {wave.map((repo) => (
                    <code key={repo} style={{ color: MESH.amber }}>
                      {repo}
                    </code>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </Section>

      <Section title="Repos">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
            gap: 10,
          }}
        >
          {plan.perRepo.map((r) => (
            <RepoCard
              key={r.name}
              name={r.name}
              role={r.role}
              wave={r.wave}
              reason={r.reason}
              connectedToProject={project?.repos.includes(r.name) ?? true}
              run={runs[r.name]}
            />
          ))}
        </div>
      </Section>
    </div>
  );
}

const STATUS_TONE: Record<RunSessionState["status"], "amber" | "green" | "red" | "dim"> = {
  idle: "dim",
  installing: "amber",
  starting: "amber",
  ready: "green",
  failed: "red",
  stopped: "dim",
};

const FAIL_KIND_HINT: Record<string, string> = {
  "no-script": "no run script and no docker-compose detected",
  install: "install failed — check log for lock conflicts or missing deps",
  start: "process exited unexpectedly — check log for stack trace",
  "ready-timeout": "didn't print ready marker in 30s",
  "docker-not-running":
    "Docker daemon is not running. Start Docker Desktop and click Run again.",
  "docker-compose-failed":
    "docker compose up failed — check log for missing image, port conflict, etc.",
};

function RepoCard({
  name,
  role,
  wave,
  reason,
  connectedToProject,
  run,
}: {
  name: string;
  role: RunRole;
  wave: number | null;
  reason: string;
  connectedToProject: boolean;
  run?: RunSessionState;
}) {
  const dim = role === "skipped" || !connectedToProject;
  const [showLog, setShowLog] = useState(false);
  const status = run?.status ?? "idle";
  const lastLog =
    run?.logTail && run.logTail.length > 0
      ? run.logTail[run.logTail.length - 1]
      : null;
  return (
    <div
      style={{
        border: `1px solid ${
          status === "failed"
            ? "rgba(229,72,77,0.35)"
            : status === "ready"
              ? "rgba(48,164,108,0.35)"
              : MESH.border
        }`,
        borderRadius: 7,
        background: MESH.bgElev,
        padding: 12,
        opacity: dim && status === "idle" ? 0.7 : 1,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Link
          href={`/repos/${encodeURIComponent(name)}/env`}
          className="font-mono"
          style={{
            fontSize: 12.5,
            color: MESH.fg,
            textDecoration: "none",
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={name}
        >
          {name}
        </Link>
        <Pill tone={ROLE_TONE[role]}>{ROLE_LABEL[role]}</Pill>
        {wave !== null && <Pill tone="dim">wave {wave}</Pill>}
        {run && status !== "idle" && (
          <Pill tone={STATUS_TONE[status]}>{status}</Pill>
        )}
      </div>

      <p
        style={{
          fontSize: 11.5,
          color: MESH.fgDim,
          lineHeight: 1.5,
          margin: 0,
        }}
      >
        {reason}
      </p>

      {status === "ready" && run?.url && (
        <a
          href={run.url}
          target="_blank"
          rel="noreferrer"
          className="font-mono"
          style={{ fontSize: 11.5, color: MESH.amber }}
        >
          {run.url} ↗
        </a>
      )}

      {status === "failed" && (
        <FailureBlock
          repoName={name}
          failKind={run?.failKind}
          failReason={run?.failReason}
          logTail={run?.logTail ?? []}
        />
      )}

      {(status === "starting" || status === "installing") && lastLog && (
        <code
          className="font-mono"
          style={{
            fontSize: 10.5,
            color: MESH.fgMute,
            display: "block",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            background: MESH.bgInput,
            border: `1px solid ${MESH.border}`,
            borderRadius: 4,
            padding: "4px 8px",
          }}
          title={lastLog}
        >
          {lastLog}
        </code>
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        {(run?.logTail.length ?? 0) > 0 && (
          <button
            onClick={() => setShowLog((s) => !s)}
            className="font-mono"
            style={{
              background: "transparent",
              border: "none",
              padding: 0,
              color: MESH.fgMute,
              cursor: "pointer",
              fontSize: 11,
            }}
          >
            {showLog ? "hide log" : `view log (${run!.logTail.length})`}
          </button>
        )}
        <Link
          href={`/repos/${encodeURIComponent(name)}/env`}
          className="font-mono"
          style={{ fontSize: 11, color: MESH.amber, marginLeft: "auto" }}
        >
          configure & run →
        </Link>
      </div>

      {showLog && run?.logTail && run.logTail.length > 0 && (
        <div
          className="font-mono"
          style={{
            background: "#0b0b0b",
            border: `1px solid ${MESH.border}`,
            borderRadius: 6,
            padding: 8,
            fontSize: 10.5,
            color: MESH.fgDim,
            maxHeight: 180,
            overflow: "auto",
            whiteSpace: "pre-wrap",
            lineHeight: 1.5,
          }}
        >
          {run.logTail.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function RunAllButton({
  running,
  hasReady,
  onRun,
  onStop,
}: {
  running: boolean;
  hasReady: boolean;
  onRun: () => void;
  onStop: () => void;
}) {
  if (running) {
    return (
      <button
        onClick={onStop}
        className="font-mono"
        style={{
          padding: "6px 14px",
          borderRadius: 5,
          border: `1px solid ${MESH.border}`,
          color: MESH.fgDim,
          fontSize: 11.5,
          background: MESH.bgInput,
          cursor: "pointer",
        }}
      >
        Stop all
      </button>
    );
  }
  return (
    <>
      {hasReady && (
        <button
          onClick={onStop}
          className="font-mono"
          style={{
            padding: "6px 12px",
            borderRadius: 5,
            border: `1px solid ${MESH.border}`,
            color: MESH.fgDim,
            fontSize: 11.5,
            background: "transparent",
            cursor: "pointer",
          }}
        >
          Stop all
        </button>
      )}
      <button
        onClick={onRun}
        className="font-mono"
        style={{
          padding: "6px 14px",
          borderRadius: 5,
          border: `1px solid ${MESH.amber}`,
          color: "#1a1206",
          fontSize: 11.5,
          fontWeight: 600,
          background: MESH.amber,
          cursor: "pointer",
        }}
      >
        {hasReady ? "Run again" : "Run all"}
      </button>
    </>
  );
}

function FailureBlock({
  repoName,
  failKind,
  failReason,
  logTail,
}: {
  repoName: string;
  failKind?: string;
  failReason?: string;
  logTail: string[];
}) {
  const hint = failKind ? FAIL_KIND_HINT[failKind] : null;
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnosis, setDiagnosis] = useState<{
    diagnosis: string;
    actionLabel: string;
    actionDetail: string;
  } | null>(null);
  const [diagError, setDiagError] = useState<string | null>(null);

  async function askClaude() {
    setDiagnosing(true);
    setDiagError(null);
    try {
      const res = await fetch(`/api/preview/diagnose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo: repoName,
          failKind,
          reason: failReason,
          logTail,
        }),
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
        let sep: number;
        while ((sep = buf.indexOf("\n\n")) !== -1) {
          const frame = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          for (const line of frame.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            try {
              const ev = JSON.parse(payload) as {
                type: string;
                diagnosis?: string;
                actionLabel?: string;
                actionDetail?: string;
                message?: string;
              };
              if (ev.type === "result") {
                setDiagnosis({
                  diagnosis: ev.diagnosis ?? "",
                  actionLabel: ev.actionLabel ?? "",
                  actionDetail: ev.actionDetail ?? "",
                });
              } else if (ev.type === "error") {
                setDiagError(ev.message ?? "diagnose failed");
              }
            } catch {
              // ignore
            }
          }
        }
      }
    } catch (err) {
      setDiagError(err instanceof Error ? err.message : String(err));
    } finally {
      setDiagnosing(false);
    }
  }

  return (
    <div
      style={{
        border: "1px solid rgba(229,72,77,0.3)",
        background: "rgba(229,72,77,0.06)",
        borderRadius: 6,
        padding: 10,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div
        className="font-mono"
        style={{
          fontSize: 10.5,
          color: MESH.red,
          letterSpacing: 0.5,
        }}
      >
        {failKind ? failKind.toUpperCase().replace(/-/g, " ") : "FAILED"}
      </div>
      {failReason && (
        <div
          className="font-mono"
          style={{ fontSize: 11.5, color: MESH.fgDim, lineHeight: 1.5 }}
        >
          {failReason}
        </div>
      )}
      {hint && (
        <div
          className="font-mono"
          style={{ fontSize: 11, color: MESH.fgMute, lineHeight: 1.5 }}
        >
          {hint}
        </div>
      )}
      {diagnosis ? (
        <div
          style={{
            marginTop: 4,
            paddingTop: 8,
            borderTop: "1px dashed rgba(214,158,46,0.35)",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <div
            className="font-mono"
            style={{
              fontSize: 10.5,
              color: MESH.amber,
              letterSpacing: 0.5,
            }}
          >
            CLAUDE SAYS
          </div>
          <p
            style={{
              fontSize: 12,
              color: MESH.fg,
              margin: 0,
              lineHeight: 1.55,
            }}
          >
            {diagnosis.diagnosis}
          </p>
          {diagnosis.actionLabel && (
            <p
              style={{
                fontSize: 11.5,
                color: MESH.fgDim,
                margin: 0,
                lineHeight: 1.55,
              }}
            >
              <strong style={{ color: MESH.amber }}>
                {diagnosis.actionLabel}:
              </strong>{" "}
              {diagnosis.actionDetail}
            </p>
          )}
        </div>
      ) : diagError ? (
        <div
          className="font-mono"
          style={{ fontSize: 11, color: MESH.red, lineHeight: 1.5 }}
        >
          {diagError}
        </div>
      ) : (
        <button
          onClick={() => void askClaude()}
          disabled={diagnosing}
          className="font-mono"
          style={{
            background: "transparent",
            border: "none",
            padding: 0,
            color: MESH.amber,
            cursor: diagnosing ? "wait" : "pointer",
            fontSize: 11,
            alignSelf: "flex-start",
          }}
        >
          {diagnosing ? "thinking…" : "ask Claude →"}
        </button>
      )}
      <RetryButton repoName={repoName} failKind={failKind} />
    </div>
  );
}

function RetryButton({
  repoName,
  failKind,
}: {
  repoName: string;
  failKind?: string;
}) {
  const [busy, setBusy] = useState<null | "full" | "deps-only">(null);
  const [err, setErr] = useState<string | null>(null);
  async function retry(composeMode?: "full" | "deps-only") {
    setBusy(composeMode ?? "full");
    setErr(null);
    try {
      const res = await fetch(`/api/preview/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo: repoName,
          ...(composeMode ? { composeMode } : {}),
        }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      // Drain the SSE so the request finishes; the project status poller
      // will pick up state changes via /api/preview/status.
      const reader = res.body.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }
  const showDepsOnly =
    failKind === "docker-compose-failed" || failKind === "docker-not-running";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
      }}
    >
      <button
        onClick={() => void retry()}
        disabled={busy !== null}
        className="font-mono"
        style={{
          background: "transparent",
          border: `1px solid ${MESH.border}`,
          borderRadius: 5,
          padding: "4px 10px",
          color: MESH.fgDim,
          cursor: busy ? "wait" : "pointer",
          fontSize: 11,
          alignSelf: "flex-start",
        }}
      >
        {busy === "full" ? "retrying…" : "retry"}
      </button>
      {showDepsOnly && (
        <button
          onClick={() => void retry("deps-only")}
          disabled={busy !== null}
          className="font-mono"
          style={{
            background: "transparent",
            border: `1px solid ${MESH.amber}`,
            borderRadius: 5,
            padding: "4px 10px",
            color: MESH.amber,
            cursor: busy ? "wait" : "pointer",
            fontSize: 11,
            alignSelf: "flex-start",
          }}
          title="Run only services without `build:` (db, redis, …) — skip app images that need creds"
        >
          {busy === "deps-only" ? "starting deps…" : "retry — deps only"}
        </button>
      )}
      {err && (
        <span
          className="font-mono"
          style={{ fontSize: 10.5, color: MESH.red }}
        >
          {err}
        </span>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h2
        className="mesh-hud"
        style={{
          margin: 0,
          marginBottom: 12,
          color: MESH.fgDim,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <span
          aria-hidden
          style={{ width: 4, height: 12, background: MESH.amber, borderRadius: 1 }}
        />
        {title}
      </h2>
      {children}
    </div>
  );
}
