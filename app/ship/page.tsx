"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AppShell,
  ChecksCard,
  CinemaThinking,
  DiffViewer,
  Dot,
  Kbd,
  MESH,
  MESH_MOTION,
  ModalShell,
  ModalLabel,
  NavIcon,
  Pill,
  PreviewServerCard,
  PrimaryButton,
  SecondaryButton,
  TicketReadyCard,
  type CheckLine,
  type CinemaMode,
  type CinemaPhase,
  type DiffFileView,
  type PreviewEnvWarning,
  type PreviewLine,
  type SidebarRepo,
  type TicketReadySummary,
} from "@/components/mesh";
import { displayRepoName } from "@/lib/repo-display";

type RepoRecord = {
  name: string;
  localPath: string;
  githubOwner?: string;
  githubRepo?: string;
  defaultBranch: string;
  connectedAt: string;
  filesIndexed?: number;
  tokensEst?: number;
};

type ReadyTicket = {
  id: string;
  title: string;
  status: "for_review";
  plan_id?: string;
  prs_count: number;
  labels?: string[];
};

type SavedPlan = {
  id: string;
  ticket: string;
  classification: {
    repos_touched: string[];
    target_branch: string;
    summary: string;
  };
  plan: {
    schema_version?: string;
    spec?: { summary?: string };
    tests?: { step: number; repo: string; file: string; action: string }[];
    implementation?: { step: number; repo: string; file: string; action: string }[];
    plan?: { step: number; repo: string; file: string; action: string }[];
  };
};

type FullTicket = {
  id: string;
  title: string;
  description?: string;
  status: string;
  plan_id?: string;
  labels: string[];
  prs: {
    repo: string;
    url: string;
    simulated: boolean;
    number?: number;
    html_url?: string;
  }[];
  adjustments: {
    at: string;
    instruction: string;
    previous_plan_id: string;
  }[];
};

type AdjustEvent =
  | { type: "thinking"; delta: string }
  | { type: "text"; delta: string }
  | { type: "edit-ready"; file: string; additions_estimate: number }
  | {
      type: "commit";
      repo: string;
      sha: string;
      message: string;
      files: string[];
    }
  | { type: "push"; repo: string; pushed: boolean; reason?: string }
  | { type: "done"; duration_ms: number; files_touched: number }
  | { type: "error"; message: string };

type ApproveResult = {
  repo: string;
  url: string;
  number?: number;
  simulated: boolean;
  marked_ready: boolean;
  reason?: string;
};

export default function ShipPage() {
  const [tickets, setTickets] = useState<ReadyTicket[]>([]);
  const [activeTicketId, setActiveTicketId] = useState<string | null>(null);
  const [activeTicket, setActiveTicket] = useState<FullTicket | null>(null);
  const [plan, setPlan] = useState<SavedPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [diffByRepo, setDiffByRepo] = useState<
    Record<string, { files: DiffFileView[]; base: string; branch: string } | null>
  >({});
  const [diffLoading, setDiffLoading] = useState(false);
  const [checksByRepo, setChecksByRepo] = useState<Record<string, CheckLine[]>>(
    {},
  );
  const [checksRunning, setChecksRunning] = useState<Record<string, boolean>>({});
  const [previewByRepo, setPreviewByRepo] = useState<Record<string, PreviewLine>>(
    {},
  );
  const [previewBusy, setPreviewBusy] = useState<Record<string, boolean>>({});
  const [envWarnByRepo, setEnvWarnByRepo] = useState<
    Record<string, PreviewEnvWarning | null>
  >({});
  const [approving, setApproving] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [adjustModalOpen, setAdjustModalOpen] = useState(false);
  const [adjustRepo, setAdjustRepo] = useState<string>("");
  const [adjustInstruction, setAdjustInstruction] = useState("");
  const [adjustRunning, setAdjustRunning] = useState(false);
  const [adjustEvents, setAdjustEvents] = useState<AdjustEvent[]>([]);
  const [cinemaMode, setCinemaMode] = useState<CinemaMode>("off");
  const [repoRegistry, setRepoRegistry] = useState<RepoRecord[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/repos", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { repos: RepoRecord[] };
        setRepoRegistry(json.repos ?? []);
      } catch {
        // silent — labels fall back to raw name
      }
    })();
  }, []);

  const nameToDisplay = useMemo(
    () =>
      Object.fromEntries(
        repoRegistry.map((r) => [r.name, displayRepoName(r)] as const),
      ),
    [repoRegistry],
  );
  // forceSim removed: PR creation happens during Build's "Proceed Ship",
  // and approve/discard already honor each PR's `simulated` flag.

  const loadTickets = useCallback(async () => {
    try {
      const res = await fetch("/api/build/tickets/ready", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { tickets: ReadyTicket[] };
      setTickets(data.tickets);
      if (!activeTicketId && data.tickets[0]) setActiveTicketId(data.tickets[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [activeTicketId]);

  useEffect(() => {
    void loadTickets();
  }, [loadTickets]);

  const loadDiff = useCallback(async (ticketId: string, repo: string) => {
    setDiffLoading(true);
    try {
      const res = await fetch(
        `/api/ship/diff?ticket_id=${encodeURIComponent(ticketId)}&repo=${encodeURIComponent(repo)}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setDiffByRepo((prev) => ({
        ...prev,
        [repo]: {
          files: data.files ?? [],
          base: data.base ?? "main",
          branch: data.branch ?? "",
        },
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDiffByRepo((prev) => ({ ...prev, [repo]: null }));
    } finally {
      setDiffLoading(false);
    }
  }, []);

  // Load full ticket + plan + diff whenever active ticket changes.
  useEffect(() => {
    setActiveTicket(null);
    setPlan(null);
    setDiffByRepo({});
    setChecksByRepo({});
    setChecksRunning({});
    setPreviewByRepo({});
    setPreviewBusy({});
    setError(null);
    if (!activeTicketId) return;
    const ticketId = activeTicketId;
    void (async () => {
      try {
        const [ticketRes, plansRes] = await Promise.all([
          fetch(`/api/build/tickets/${encodeURIComponent(ticketId)}`, {
            cache: "no-store",
          }),
          fetch("/api/plans", { cache: "no-store" }),
        ]);
        if (ticketRes.ok) {
          const data = (await ticketRes.json()) as { ticket: FullTicket };
          setActiveTicket(data.ticket ?? null);
        }
        if (plansRes.ok) {
          const summary = tickets.find((t) => t.id === ticketId);
          const plansData = (await plansRes.json()) as { plans: SavedPlan[] };
          const found = plansData.plans.find((p) => p.id === summary?.plan_id) ?? null;
          setPlan(found);
          if (found) {
            for (const repo of found.classification.repos_touched) {
              void loadDiff(ticketId, repo);
            }
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [activeTicketId, tickets, loadDiff]);

  async function runChecks(repo: string) {
    setChecksRunning((prev) => ({ ...prev, [repo]: true }));
    setChecksByRepo((prev) => ({
      ...prev,
      [repo]: ["typecheck", "lint"].map((s) => ({
        script: s,
        status: "running",
        output: "",
      })),
    }));
    try {
      const res = await fetch("/api/ship/checks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      await consumeSse(res.body, (raw) => {
        try {
          const ev = JSON.parse(raw) as
            | { type: "check-start"; script: string }
            | { type: "check-output"; script: string; chunk: string }
            | {
                type: "check-done";
                script: string;
                status: "ok" | "fail" | "skipped";
                duration_ms: number;
              }
            | { type: "done" }
            | { type: "error"; message: string };
          if (ev.type === "error") {
            setError(ev.message);
            return;
          }
          if (ev.type === "done") return;
          setChecksByRepo((prev) => {
            const cur = [...(prev[repo] ?? [])];
            const idx = cur.findIndex((c) => c.script === ev.script);
            if (ev.type === "check-start") {
              if (idx >= 0) cur[idx] = { ...cur[idx], status: "running", output: "" };
              else cur.push({ script: ev.script, status: "running", output: "" });
            } else if (ev.type === "check-output") {
              if (idx >= 0) cur[idx] = { ...cur[idx], output: cur[idx].output + ev.chunk };
              else cur.push({ script: ev.script, status: "running", output: ev.chunk });
            } else if (ev.type === "check-done") {
              if (idx >= 0)
                cur[idx] = {
                  ...cur[idx],
                  status: ev.status === "skipped" ? "skipped" : ev.status,
                  duration_ms: ev.duration_ms,
                };
            }
            return { ...prev, [repo]: cur };
          });
        } catch {
          // ignore
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecksRunning((prev) => ({ ...prev, [repo]: false }));
    }
  }

  const previewControllers = useRef<Record<string, AbortController | null>>({});

  async function startPreview(repo: string, opts?: { force?: boolean }) {
    if (!activeTicketId) return;
    setPreviewBusy((prev) => ({ ...prev, [repo]: true }));
    if (!opts?.force) {
      try {
        const checkRes = await fetch("/api/preview/check-env", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repo }),
        });
        if (checkRes.ok) {
          const check = (await checkRes.json()) as {
            ok: boolean;
            missing: string[];
            source: PreviewEnvWarning["source"];
            exampleFile: string | null;
            scannedFiles: number | null;
          };
          if (!check.ok && check.missing.length > 0) {
            setEnvWarnByRepo((prev) => ({
              ...prev,
              [repo]: {
                missing: check.missing,
                source: check.source,
                exampleFile: check.exampleFile,
                scannedFiles: check.scannedFiles,
              },
            }));
            setPreviewBusy((prev) => ({ ...prev, [repo]: false }));
            return;
          }
        }
      } catch {
        // best-effort — fall through and let preview attempt itself
      }
    }
    setEnvWarnByRepo((prev) => ({ ...prev, [repo]: null }));
    setPreviewByRepo((prev) => ({
      ...prev,
      [repo]: {
        repo,
        status: "starting",
        output: prev[repo]?.output ?? "",
      },
    }));
    const ctrl = new AbortController();
    previewControllers.current[repo] = ctrl;
    try {
      const res = await fetch("/api/preview/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket_id: activeTicketId, repo }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      await consumeSse(res.body, (raw) => {
        try {
          const ev = JSON.parse(raw) as
            | { type: "status"; status: PreviewLine["status"] }
            | { type: "log"; chunk: string }
            | { type: "ready"; port: number; url: string }
            | { type: "failed"; reason: string };
          setPreviewByRepo((prev) => {
            const cur = prev[repo] ?? { repo, status: "starting", output: "" };
            if (ev.type === "status") {
              return { ...prev, [repo]: { ...cur, status: ev.status } };
            }
            if (ev.type === "log") {
              return { ...prev, [repo]: { ...cur, output: cur.output + ev.chunk } };
            }
            if (ev.type === "ready") {
              return {
                ...prev,
                [repo]: { ...cur, status: "ready", port: ev.port, url: ev.url },
              };
            }
            if (ev.type === "failed") {
              return {
                ...prev,
                [repo]: { ...cur, status: "failed", reason: ev.reason },
              };
            }
            return prev;
          });
        } catch {
          // ignore
        }
      });
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setPreviewBusy((prev) => ({ ...prev, [repo]: false }));
      previewControllers.current[repo] = null;
    }
  }

  async function stopPreview(repo: string) {
    if (!activeTicketId) return;
    setPreviewBusy((prev) => ({ ...prev, [repo]: true }));
    try {
      previewControllers.current[repo]?.abort();
      await fetch("/api/preview/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket_id: activeTicketId, repo }),
      });
      setPreviewByRepo((prev) => ({
        ...prev,
        [repo]: prev[repo]
          ? { ...prev[repo], status: "stopped", url: undefined, port: undefined }
          : { repo, status: "stopped", output: "" },
      }));
    } finally {
      setPreviewBusy((prev) => ({ ...prev, [repo]: false }));
    }
  }

  async function approve() {
    if (!activeTicketId || !activeTicket) return;
    if (!window.confirm("Mark all draft PRs as ready for review?")) return;
    setApproving(true);
    setError(null);
    try {
      const res = await fetch("/api/ship/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket_id: activeTicketId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const failed = (data.results as ApproveResult[]).filter(
        (r) => !r.marked_ready,
      );
      if (failed.length > 0) {
        setError(
          `partial: ${failed.length} PR${failed.length === 1 ? "" : "s"} could not be marked ready (${failed
            .map((f) => f.reason ?? "unknown")
            .join(" · ")})`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApproving(false);
      void loadTickets();
      // Reload active ticket so the labels/prs reflect the new state.
      if (activeTicketId) {
        const cur = activeTicketId;
        void fetch(`/api/build/tickets/${encodeURIComponent(cur)}`, {
          cache: "no-store",
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => d && setActiveTicket(d.ticket ?? null))
          .catch(() => null);
      }
    }
  }

  async function discard() {
    if (!activeTicketId) return;
    if (
      !window.confirm(
        "Discard everything? This closes the PR(s), deletes the feature branch, and resets the ticket back to drafted.",
      )
    )
      return;
    setDiscarding(true);
    setError(null);
    try {
      const res = await fetch("/api/ship/discard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket_id: activeTicketId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (Array.isArray(data.errors) && data.errors.length > 0) {
        setError(
          `discard partial: ${data.errors.map((e: { repo: string; message: string }) => `${e.repo}: ${e.message}`).join(" · ")}`,
        );
      }
      setDiffByRepo({});
      setChecksByRepo({});
      setPreviewByRepo({});
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDiscarding(false);
      void loadTickets();
    }
  }

  function openAdjust(repo: string) {
    setAdjustRepo(repo);
    setAdjustInstruction("");
    setAdjustEvents([]);
    setAdjustModalOpen(true);
    setCinemaMode("off");
  }

  async function runAdjust() {
    if (!activeTicketId || !adjustRepo || !adjustInstruction.trim()) return;
    setAdjustRunning(true);
    setAdjustEvents([]);
    setAdjustModalOpen(false);
    setCinemaMode("cinema");
    try {
      const res = await fetch("/api/ship/adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticket_id: activeTicketId,
          repo: adjustRepo,
          instruction: adjustInstruction.trim(),
        }),
      });
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${text || "no body"}`);
      }
      await consumeSse(res.body, (raw) => {
        try {
          const ev = JSON.parse(raw) as AdjustEvent;
          setAdjustEvents((prev) => [...prev, ev]);
        } catch {
          // ignore
        }
      });
      // Refresh diff so user sees the new commits.
      if (activeTicketId) await loadDiff(activeTicketId, adjustRepo);
      // Refresh ticket so the adjustments list updates.
      const r = await fetch(
        `/api/build/tickets/${encodeURIComponent(activeTicketId)}`,
        { cache: "no-store" },
      );
      if (r.ok) {
        const d = await r.json();
        setActiveTicket(d.ticket ?? null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdjustRunning(false);
    }
  }

  // Sidebar repos mirror the plan's touched repos so the global Sidebar
  // shows the right scope on Ship.
  const sidebarRepos: SidebarRepo[] = (plan?.classification.repos_touched ?? []).map(
    (r) => ({
      name: r,
      branch: plan?.classification.target_branch ?? "main",
      changes: "for review",
    }),
  );

  const repos = plan?.classification.repos_touched ?? [];

  const ticketCardSummaries: TicketReadySummary[] = tickets.map((t) => {
    const tplan = t.id === activeTicketId && plan ? plan : null;
    return {
      id: t.id,
      title: t.title,
      branch: tplan?.classification.target_branch ?? "—",
      reposTouched: tplan?.classification.repos_touched ?? [],
      steps: tplan ? planSteps(tplan.plan).length : 0,
      status: "pending_review" as const,
    };
  });

  const adjustThinking = useMemo(
    () =>
      adjustEvents
        .filter((e): e is AdjustEvent & { type: "thinking" } => e.type === "thinking")
        .map((e) => e.delta)
        .join(""),
    [adjustEvents],
  );
  const adjustCommits = useMemo(
    () =>
      adjustEvents.filter(
        (e): e is AdjustEvent & { type: "commit" } => e.type === "commit",
      ),
    [adjustEvents],
  );
  const adjustEditedFiles = useMemo(
    () =>
      adjustEvents.filter(
        (e): e is AdjustEvent & { type: "edit-ready" } => e.type === "edit-ready",
      ),
    [adjustEvents],
  );
  const adjustError = useMemo(
    () =>
      adjustEvents.find(
        (e): e is AdjustEvent & { type: "error" } => e.type === "error",
      ),
    [adjustEvents],
  );
  const adjustDone = useMemo(
    () => adjustEvents.some((e) => e.type === "done"),
    [adjustEvents],
  );

  const adjustPhases: CinemaPhase[] = useMemo(
    () => [
      { id: "reasoning", label: "Reason", tone: "amber" },
      { id: "editing", label: "Edit", tone: "amber" },
      { id: "committing", label: "Commit", tone: "signal" },
      { id: "pushing", label: "Push", tone: "signal" },
      { id: "done", label: "PR updated", tone: "green" },
    ],
    [],
  );

  const adjustPhase: CinemaPhase | null = useMemo(() => {
    const has = (t: AdjustEvent["type"]) => adjustEvents.some((e) => e.type === t);
    if (has("done")) return adjustPhases[4];
    if (has("push")) return adjustPhases[3];
    if (has("commit")) return adjustPhases[2];
    if (has("edit-ready")) return adjustPhases[1];
    if (adjustRunning || has("thinking")) return adjustPhases[0];
    return null;
  }, [adjustEvents, adjustPhases, adjustRunning]);

  const adjustTokens = useMemo(
    () =>
      adjustEvents.reduce(
        (n, e) => (e.type === "thinking" ? n + e.delta.length : n),
        0,
      ),
    [adjustEvents],
  );

  const cinemaTitle = adjustDone
    ? "Adjustment shipped"
    : adjustError
      ? "Adjustment failed"
      : "Adjusting branch";

  const cinemaSubtitle = adjustRepo
    ? `${adjustRepo} · ${adjustInstruction.slice(0, 96)}${adjustInstruction.length > 96 ? "…" : ""}`
    : "";

  const adjustPrUrl = useMemo(() => {
    const pr = activeTicket?.prs?.find(
      (p) => p.repo === adjustRepo && (p.html_url || p.url),
    );
    return pr?.html_url ?? pr?.url ?? null;
  }, [activeTicket, adjustRepo]);

  const isApproved = !!activeTicket?.labels?.includes("approved");

  return (
    <AppShell
      title="Ship"
      subtitle="validate · adjust · mark ready"
      repos={sidebarRepos}
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
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ flex: 1, wordBreak: "break-word" }}>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="font-mono"
            style={{
              background: "transparent",
              border: "none",
              color: MESH.red,
              cursor: "pointer",
              fontSize: 14,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
      )}

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: "300px 1fr",
        }}
      >
        <aside
          style={{
            borderRight: `1px solid ${MESH.border}`,
            padding: "14px 14px 24px",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            background: MESH.bg,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "0 4px 6px",
            }}
          >
            <span
              className="font-mono"
              style={{
                fontSize: 10,
                color: MESH.fgMute,
                textTransform: "uppercase",
                letterSpacing: "0.14em",
              }}
            >
              For review · {ticketCardSummaries.length}
            </span>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              onClick={loadTickets}
              className="font-mono"
              style={{
                fontSize: 10,
                color: MESH.fgMute,
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: 0,
              }}
            >
              refresh
            </button>
          </div>
          {ticketCardSummaries.length === 0 ? (
            <p
              className="font-mono"
              style={{
                fontSize: 11,
                color: MESH.fgMute,
                padding: "16px 8px",
                lineHeight: 1.5,
              }}
            >
              no tickets in for review. open Build, draft a ticket, approve a plan, and proceed to ship.
            </p>
          ) : (
            ticketCardSummaries.map((t) => (
              <TicketReadyCard
                key={t.id}
                ticket={t}
                selected={t.id === activeTicketId}
                onSelect={setActiveTicketId}
              />
            ))
          )}
        </aside>

        <div
          style={{
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            background: MESH.bg,
          }}
        >
          {!activeTicketId || !activeTicket ? (
            <EmptyState />
          ) : (
            <Workspace
              ticket={activeTicket}
              repos={repos}
              nameToDisplay={nameToDisplay}
              diffByRepo={diffByRepo}
              diffLoading={diffLoading}
              onReloadDiff={(repo) =>
                activeTicketId && void loadDiff(activeTicketId, repo)
              }
              checksByRepo={checksByRepo}
              checksRunning={checksRunning}
              onRunChecks={runChecks}
              previewByRepo={previewByRepo}
              previewBusy={previewBusy}
              envWarnByRepo={envWarnByRepo}
              onStartPreview={(r) => startPreview(r)}
              onForceStartPreview={(r) => startPreview(r, { force: true })}
              onDismissEnvWarn={(r) =>
                setEnvWarnByRepo((prev) => ({ ...prev, [r]: null }))
              }
              onStopPreview={stopPreview}
              onApprove={approve}
              onDiscard={discard}
              onAdjust={openAdjust}
              approving={approving}
              discarding={discarding}
              isApproved={isApproved}
            />
          )}
        </div>
      </div>

      {adjustModalOpen && (
        <AdjustModal
          repo={adjustRepo}
          instruction={adjustInstruction}
          onInstructionChange={setAdjustInstruction}
          running={adjustRunning}
          onSubmit={runAdjust}
          onClose={() => {
            if (adjustRunning) return;
            setAdjustModalOpen(false);
          }}
        />
      )}

      <CinemaThinking
        mode={cinemaMode}
        text={adjustThinking}
        active={adjustRunning}
        tokens={adjustTokens}
        phase={adjustPhase}
        phases={adjustPhases}
        title={cinemaTitle}
        subtitle={cinemaSubtitle}
        meta={
          adjustError ? (
            <Pill tone="red">error</Pill>
          ) : adjustDone ? (
            <Pill tone="green">
              {adjustCommits.length} commit{adjustCommits.length === 1 ? "" : "s"}
            </Pill>
          ) : (
            <Pill tone="amber">{adjustEditedFiles.length} files</Pill>
          )
        }
        footer={
          adjustDone ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {adjustPrUrl && (
                <a
                  href={adjustPrUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mesh-mono"
                  style={{
                    padding: "6px 12px",
                    background: MESH.green,
                    color: "#0A1A12",
                    border: `1px solid ${MESH.green}`,
                    borderRadius: 6,
                    fontSize: 11,
                    textTransform: "uppercase",
                    letterSpacing: "0.14em",
                    textDecoration: "none",
                    fontWeight: 600,
                  }}
                >
                  open PR ↗
                </a>
              )}
              <button
                type="button"
                onClick={() => setCinemaMode("off")}
                className="mesh-mono"
                style={{
                  padding: "6px 12px",
                  background: "transparent",
                  color: MESH.fgDim,
                  border: `1px solid ${MESH.borderHi}`,
                  borderRadius: 6,
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "0.14em",
                  cursor: "pointer",
                }}
              >
                close
              </button>
            </div>
          ) : (
            <span
              className="mesh-mono"
              style={{ fontSize: 11, color: MESH.fgMute }}
            >
              <Kbd size="xs">esc</Kbd> to dock
            </span>
          )
        }
        onDismiss={() =>
          setCinemaMode(adjustRunning || adjustDone ? "docked" : "off")
        }
        onExpand={() => setCinemaMode("cinema")}
      />
    </AppShell>
  );
}

function planSteps(p: SavedPlan["plan"]): { step: number }[] {
  if (p?.schema_version === "2") {
    return [...(p.tests ?? []), ...(p.implementation ?? [])];
  }
  return p?.plan ?? [];
}

async function consumeSse(
  body: ReadableStream<Uint8Array>,
  onMessage: (raw: string) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const raw = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      for (const line of raw.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        onMessage(line.slice(6));
      }
    }
  }
}

function EmptyState() {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 14,
        padding: 32,
      }}
    >
      <span className="mesh-hud" style={{ color: MESH.fgMute }}>
        · SHIP CONSOLE
      </span>
      <h2
        className="mesh-display"
        style={{
          margin: 0,
          fontSize: 36,
          color: MESH.fgDim,
          letterSpacing: "-0.02em",
          lineHeight: 1.1,
          textAlign: "center",
        }}
      >
        Pick a ticket on the left,
        <br />
        <span className="mesh-display-italic" style={{ color: MESH.fg }}>
          and we go to work.
        </span>
      </h2>
      <p
        style={{
          fontSize: 13,
          color: MESH.fgMute,
          maxWidth: 460,
          textAlign: "center",
          lineHeight: 1.7,
          margin: 0,
        }}
      >
        Ship operates on tickets that moved to <b style={{ color: MESH.fgDim }}>for review</b>.
        Claude has staged commits and opened the draft PR. Validate the diff, run checks,
        spin a preview, adjust if needed, then mark ready.
      </p>
    </div>
  );
}

function Workspace({
  ticket,
  repos,
  nameToDisplay,
  diffByRepo,
  diffLoading,
  onReloadDiff,
  checksByRepo,
  checksRunning,
  onRunChecks,
  previewByRepo,
  previewBusy,
  envWarnByRepo,
  onStartPreview,
  onForceStartPreview,
  onDismissEnvWarn,
  onStopPreview,
  onApprove,
  onDiscard,
  onAdjust,
  approving,
  discarding,
  isApproved,
}: {
  ticket: FullTicket;
  repos: string[];
  nameToDisplay: Record<string, string>;
  diffByRepo: Record<string, { files: DiffFileView[]; base: string; branch: string } | null>;
  diffLoading: boolean;
  onReloadDiff: (repo: string) => void;
  checksByRepo: Record<string, CheckLine[]>;
  checksRunning: Record<string, boolean>;
  onRunChecks: (repo: string) => void;
  previewByRepo: Record<string, PreviewLine>;
  previewBusy: Record<string, boolean>;
  envWarnByRepo: Record<string, PreviewEnvWarning | null>;
  onStartPreview: (repo: string) => void;
  onForceStartPreview: (repo: string) => void;
  onDismissEnvWarn: (repo: string) => void;
  onStopPreview: (repo: string) => void;
  onApprove: () => void;
  onDiscard: () => void;
  onAdjust: (repo: string) => void;
  approving: boolean;
  discarding: boolean;
  isApproved: boolean;
}) {
  const [selectedRepo, setSelectedRepo] = useState<string | null>(repos[0] ?? null);
  useEffect(() => {
    if (!selectedRepo && repos[0]) setSelectedRepo(repos[0]);
  }, [repos, selectedRepo]);
  const activeRepo = selectedRepo ?? repos[0];
  const diff = activeRepo ? diffByRepo[activeRepo] : null;

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        padding: "20px 24px 28px",
        display: "flex",
        flexDirection: "column",
        gap: 18,
      }}
    >
      <PrSummary ticket={ticket} isApproved={isApproved} />

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {repos.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setSelectedRepo(r)}
            className="font-mono"
            style={{
              padding: "6px 12px",
              borderRadius: 5,
              border: `1px solid ${activeRepo === r ? MESH.amber : MESH.border}`,
              background: activeRepo === r ? "rgba(245,165,36,0.08)" : MESH.bgElev,
              color: activeRepo === r ? MESH.amber : MESH.fgDim,
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            {nameToDisplay[r] ?? r}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={onDiscard}
          disabled={discarding || approving}
          className="font-mono"
          style={{
            padding: "8px 12px",
            borderRadius: 6,
            border: `1px solid ${MESH.border}`,
            background: "transparent",
            color: MESH.red,
            fontSize: 12,
            cursor: discarding || approving ? "default" : "pointer",
          }}
        >
          {discarding ? "discarding…" : "discard"}
        </button>
        <button
          type="button"
          onClick={() => activeRepo && onAdjust(activeRepo)}
          disabled={!activeRepo || approving || discarding}
          className="font-mono"
          style={{
            padding: "8px 12px",
            borderRadius: 6,
            border: `1px solid ${MESH.amber}`,
            background: "transparent",
            color: MESH.amber,
            fontSize: 12,
            cursor: !activeRepo || approving || discarding ? "default" : "pointer",
          }}
        >
          adjust
        </button>
        <button
          type="button"
          onClick={onApprove}
          disabled={approving || discarding || isApproved}
          className="font-mono"
          style={{
            padding: "8px 14px",
            borderRadius: 6,
            border: `1px solid ${MESH.green}`,
            background:
              approving || discarding || isApproved
                ? "transparent"
                : "rgba(48,164,108,0.18)",
            color: MESH.green,
            fontSize: 12,
            fontWeight: 500,
            cursor:
              approving || discarding || isApproved ? "default" : "pointer",
          }}
        >
          {isApproved
            ? "marked ready"
            : approving
              ? "marking ready…"
              : "approve & mark ready"}
        </button>
      </div>

      <Section
        label="Diff"
        sub={`compare ${diff?.branch ?? activeRepo} vs ${diff?.base ?? "base"}`}
        collapsible
        defaultCollapsed
        collapsedSummary={(() => {
          if (!activeRepo) return "no repo selected";
          if (diff === undefined) return "loading…";
          if (diff === null) return "failed to load";
          const additions = diff.files.reduce((n, f) => n + f.additions, 0);
          const deletions = diff.files.reduce((n, f) => n + f.deletions, 0);
          return `${diff.files.length} file${diff.files.length === 1 ? "" : "s"} · +${additions} −${deletions}`;
        })()}
        right={
          <button
            type="button"
            onClick={() => activeRepo && onReloadDiff(activeRepo)}
            disabled={diffLoading || !activeRepo}
            className="font-mono"
            style={{
              fontSize: 10,
              color: MESH.fgMute,
              background: "transparent",
              border: "none",
              cursor: diffLoading || !activeRepo ? "default" : "pointer",
              padding: 0,
            }}
          >
            {diffLoading ? "loading…" : "refresh"}
          </button>
        }
      >
        {!activeRepo ? (
          <p className="font-mono" style={{ fontSize: 11, color: MESH.fgMute }}>
            no repo selected
          </p>
        ) : diff === undefined ? (
          <p className="font-mono" style={{ fontSize: 11, color: MESH.fgMute }}>
            loading diff…
          </p>
        ) : diff === null ? (
          <p className="font-mono" style={{ fontSize: 11, color: MESH.fgMute }}>
            failed to load diff — click refresh
          </p>
        ) : (
          <DiffViewer files={diff.files} base={diff.base} branch={diff.branch} />
        )}
      </Section>

      <Section
        label="Checks"
        sub="typecheck + lint per repo"
        collapsible
        defaultCollapsed
        collapsedSummary={(() => {
          const running = repos.filter((r) => checksRunning[r]).length;
          if (running > 0)
            return `${running} running · ${repos.length} repo${repos.length === 1 ? "" : "s"}`;
          const ran = repos.filter((r) => (checksByRepo[r]?.length ?? 0) > 0).length;
          if (ran === 0)
            return `${repos.length} repo${repos.length === 1 ? "" : "s"} · idle`;
          return `${ran}/${repos.length} ran`;
        })()}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {repos.map((r) => (
            <ChecksCard
              key={r}
              repo={r}
              displayName={nameToDisplay[r]}
              lines={checksByRepo[r] ?? []}
              running={!!checksRunning[r]}
              onRun={() => onRunChecks(r)}
            />
          ))}
        </div>
      </Section>

      <Section
        label="Preview"
        sub="dev server with this repo's env vars"
        collapsible
        defaultCollapsed
        collapsedSummary={(() => {
          const live = repos.filter(
            (r) =>
              previewByRepo[r] &&
              previewByRepo[r]!.status !== "idle" &&
              previewByRepo[r]!.status !== "stopped",
          ).length;
          if (live > 0)
            return `${live} running · ${repos.length} repo${repos.length === 1 ? "" : "s"}`;
          return `${repos.length} repo${repos.length === 1 ? "" : "s"} · idle`;
        })()}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {repos.map((r) => {
            const line: PreviewLine = previewByRepo[r] ?? {
              repo: r,
              status: "idle",
              output: "",
            };
            return (
              <PreviewServerCard
                key={r}
                line={line}
                displayName={nameToDisplay[r]}
                busy={!!previewBusy[r]}
                envWarning={envWarnByRepo[r] ?? null}
                envHref={`/repos/${encodeURIComponent(r)}/env`}
                onForceStart={() => onForceStartPreview(r)}
                onDismissWarning={() => onDismissEnvWarn(r)}
                onStart={() => onStartPreview(r)}
                onStop={() => onStopPreview(r)}
              />
            );
          })}
        </div>
      </Section>

      {ticket.adjustments.length > 0 && (
        <Section
          label="Adjustments"
          sub={`${ticket.adjustments.length} addendum${ticket.adjustments.length === 1 ? "" : "s"}`}
          collapsible
          defaultCollapsed
          collapsedSummary={`${ticket.adjustments.length} addendum${ticket.adjustments.length === 1 ? "" : "s"}`}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {ticket.adjustments
              .slice()
              .reverse()
              .map((a, i) => (
                <div
                  key={`${a.at}-${i}`}
                  style={{
                    padding: "8px 10px",
                    background: MESH.bgElev,
                    border: `1px solid ${MESH.border}`,
                    borderRadius: 5,
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  <span
                    className="font-mono"
                    style={{
                      fontSize: 10,
                      color: MESH.fgMute,
                      letterSpacing: "0.04em",
                    }}
                  >
                    {new Date(a.at).toLocaleString()}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      color: MESH.fg,
                      lineHeight: 1.5,
                      wordBreak: "break-word",
                    }}
                  >
                    {a.instruction}
                  </span>
                </div>
              ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function PrSummary({
  ticket,
  isApproved,
}: {
  ticket: FullTicket;
  isApproved: boolean;
}) {
  if (ticket.prs.length === 0) {
    return (
      <div
        style={{
          padding: 16,
          border: `1px dashed ${MESH.border}`,
          borderRadius: 8,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div
          className="mesh-display"
          style={{
            fontSize: 22,
            color: MESH.fgDim,
            letterSpacing: "-0.01em",
            fontStyle: "italic",
          }}
        >
          No PRs attached yet.
        </div>
        <div
          className="mesh-hud"
          style={{ color: MESH.fgMute }}
        >
          ONCE GENERATE FINISHES, DRAFT PRs SHOW HERE
        </div>
      </div>
    );
  }
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        padding: "20px 22px",
        background: MESH.bgElev,
        border: `1px solid ${MESH.borderHi}`,
        borderRadius: 10,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(60% 80% at 100% 0%, ${
            isApproved ? "rgba(48,164,108,0.10)" : "rgba(245,165,36,0.08)"
          } 0%, transparent 60%)`,
          pointerEvents: "none",
        }}
      />
      <header
        style={{
          position: "relative",
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0, flex: 1 }}>
          <span className="mesh-hud" style={{ color: MESH.fgMute }}>
            PULL REQUESTS · {ticket.prs.length}
          </span>
          <h2
            className="mesh-display"
            style={{
              margin: 0,
              fontSize: 28,
              color: MESH.fg,
              letterSpacing: "-0.02em",
              lineHeight: 1.15,
              minWidth: 0,
              wordBreak: "break-word",
              overflowWrap: "anywhere",
            }}
          >
            {ticket.title}
          </h2>
          <span
            className="mesh-mono"
            style={{ fontSize: 11, color: MESH.fgMute }}
          >
            {ticket.id} · {ticket.labels.join(" · ") || "no labels"}
          </span>
        </div>
        <div style={{ flexShrink: 0 }}>
          <Pill tone={isApproved ? "green" : "amber"}>
            {isApproved ? "ready to merge" : "awaiting review"}
          </Pill>
        </div>
      </header>
      {ticket.prs.map((pr) => (
        <div
          key={pr.url}
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 12px",
            background: MESH.bg,
            border: `1px solid ${pr.simulated ? MESH.border : "rgba(48,164,108,0.25)"}`,
            borderRadius: 6,
          }}
        >
          <NavIcon
            kind="pr"
            color={pr.simulated ? MESH.fgDim : isApproved ? MESH.green : MESH.amber}
            size={12}
          />
          <span
            className="font-mono"
            style={{ fontSize: 11.5, color: MESH.fg, fontWeight: 500 }}
          >
            {pr.repo}
          </span>
          <Pill tone={pr.simulated ? "default" : isApproved ? "green" : "amber"}>
            {pr.simulated
              ? "simulated"
              : isApproved
                ? "ready"
                : "draft"}
            {pr.number !== undefined ? ` · #${pr.number}` : ""}
          </Pill>
          <a
            href={pr.url}
            target="_blank"
            rel="noreferrer"
            className="font-mono"
            style={{
              fontSize: 11,
              color: MESH.amber,
              textDecoration: "underline",
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {pr.url}
          </a>
        </div>
      ))}
    </div>
  );
}

function Section({
  label,
  sub,
  right,
  children,
  collapsible,
  defaultCollapsed,
  collapsedSummary,
}: {
  label: string;
  sub?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  collapsedSummary?: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState<boolean>(
    collapsible ? !!defaultCollapsed : false,
  );
  const isCollapsed = !!collapsible && collapsed;

  const toggleStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 12,
    background: "transparent",
    border: "none",
    padding: 0,
    margin: 0,
    cursor: collapsible ? "pointer" : "default",
    textAlign: "left",
    font: "inherit",
    color: "inherit",
    minWidth: 0,
    flex: 1,
  };

  const labelGroup = (
    <>
      <span
        aria-hidden
        style={{ width: 4, height: 14, background: MESH.amber, borderRadius: 1 }}
      />
      {collapsible && (
        <span
          aria-hidden
          style={{
            display: "inline-flex",
            transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
            transition: `transform ${MESH_MOTION.fast} ${MESH_MOTION.ease}`,
            color: MESH.fgDim,
          }}
        >
          <NavIcon kind="caret" size={12} color={MESH.fgDim} />
        </span>
      )}
      <span className="mesh-hud" style={{ color: MESH.fgDim }}>
        {label}
      </span>
      {isCollapsed
        ? collapsedSummary && (
            <span
              className="mesh-mono"
              style={{
                fontSize: 11,
                color: MESH.fgMute,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                minWidth: 0,
              }}
            >
              {collapsedSummary}
            </span>
          )
        : sub && (
            <span
              className="mesh-mono"
              style={{
                fontSize: 11,
                color: MESH.fgMute,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                minWidth: 0,
              }}
            >
              {sub}
            </span>
          )}
    </>
  );

  const headerStyle: React.CSSProperties = collapsible
    ? {
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        background: MESH.bgElev,
        border: `1px solid ${MESH.border}`,
        borderRadius: 6,
        transition: `border-color ${MESH_MOTION.fast} ${MESH_MOTION.ease}`,
      }
    : {
        display: "flex",
        alignItems: "center",
        gap: 12,
        paddingBottom: 8,
        borderBottom: `1px solid ${MESH.border}`,
      };

  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: collapsible ? 10 : 12,
      }}
    >
      <div style={headerStyle}>
        {collapsible ? (
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-expanded={!isCollapsed}
            style={toggleStyle}
          >
            {labelGroup}
          </button>
        ) : (
          <>
            {labelGroup}
            <span style={{ flex: 1 }} />
          </>
        )}
        {!isCollapsed && right}
      </div>
      {!isCollapsed && children}
    </section>
  );
}

function AdjustModal({
  repo,
  instruction,
  onInstructionChange,
  running,
  onSubmit,
  onClose,
}: {
  repo: string;
  instruction: string;
  onInstructionChange: (v: string) => void;
  running: boolean;
  onSubmit: () => void;
  onClose: () => void;
}) {
  return (
    <ModalShell
      open
      title={
        <span style={{ display: "inline-flex", alignItems: "baseline", gap: 8 }}>
          <span className="mesh-display" style={{ fontSize: 24, letterSpacing: "-0.01em" }}>
            Adjust
          </span>
          <span className="mesh-mono" style={{ fontSize: 12, color: MESH.fgDim }}>
            {repo}
          </span>
        </span>
      }
      meta="addendum commit on existing branch — PR auto-updates"
      onClose={onClose}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <ModalLabel>Instruction</ModalLabel>
        <textarea
          value={instruction}
          onChange={(e) => onInstructionChange(e.target.value)}
          disabled={running}
          autoFocus
          placeholder="e.g. add a default value to the new env var so the readme example still works"
          rows={5}
          className="font-mono"
          style={{
            background: MESH.bgInput,
            color: MESH.fg,
            border: `1px solid ${MESH.border}`,
            borderRadius: 6,
            padding: "12px 14px",
            fontSize: 12.5,
            lineHeight: 1.6,
            resize: "vertical",
            outline: "none",
          }}
        />
        <div
          className="mesh-hud"
          style={{
            color: MESH.fgMute,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span>WHEN YOU SEND</span>
          <span style={{ color: MESH.fgDim }}>·</span>
          <span style={{ color: MESH.fgDim, textTransform: "none", letterSpacing: 0, fontSize: 11 }}>
            Claude reasons → edits files → commits → pushes. You watch the whole thing in
            cinema mode.
          </span>
        </div>

        <div
          style={{
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
          }}
        >
          <SecondaryButton onClick={onClose} disabled={running}>
            cancel
          </SecondaryButton>
          <PrimaryButton
            onClick={onSubmit}
            disabled={running || !instruction.trim()}
          >
            {running ? "running…" : "send to Claude"}
          </PrimaryButton>
        </div>
      </div>
    </ModalShell>
  );
}
