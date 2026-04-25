"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell, MESH, Pill } from "@/components/mesh";
import { Dot } from "@/components/mesh/pill";
import { PROJECT_COLOR_MAP, type ProjectColor } from "@/components/mesh/project-switcher";
import type { Memory } from "@/lib/memory";

type ProjectOnboarding = {
  dismissed?: boolean;
  stepsSeen?: string[];
};

type ProjectRecord = {
  id: string;
  name: string;
  label?: string;
  color: ProjectColor;
  description?: string;
  repos: string[];
  onboarding?: ProjectOnboarding;
};

type RepoRecord = {
  name: string;
  defaultBranch: string;
  tokensEst?: number;
  ingestedAt?: string;
};

type TicketEntry = {
  id: string;
  title: string;
  status: "inbox" | "drafted" | "in_process" | "for_review";
  updated_at: string;
  prs_count?: number;
};

export default function Home() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [repos, setRepos] = useState<RepoRecord[]>([]);
  const [memory, setMemory] = useState<Memory | null>(null);
  const [tickets, setTickets] = useState<TicketEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [projectsRes, reposRes, memoryRes, ticketsRes] = await Promise.all([
        fetch("/api/projects", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/repos", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/memory", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/build/tickets", { cache: "no-store" }).then((r) => r.json()),
      ]);
      setProjects((projectsRes.projects ?? []) as ProjectRecord[]);
      setCurrentProjectId(projectsRes.currentProjectId ?? null);
      setRepos((reposRes.repos ?? []) as RepoRecord[]);
      setMemory((memoryRes.memory ?? null) as Memory | null);
      setTickets((ticketsRes.tickets ?? []) as TicketEntry[]);
    } catch {
      // silent — Home degrades gracefully
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const project =
    projects.find((p) => p.id === currentProjectId) ?? projects[0] ?? null;
  const showEmpty = !loading && !project;

  if (loading) {
    return (
      <AppShell noTopBar>
        <div
          className="font-mono"
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: MESH.fgMute,
            fontSize: 12,
          }}
        >
          loading…
        </div>
      </AppShell>
    );
  }

  if (showEmpty) {
    return <EmptyHome />;
  }

  return (
    <PopulatedHome
      project={project!}
      repos={repos}
      memory={memory}
      tickets={tickets}
      onTicketCreated={() => router.push("/build")}
      onReload={load}
    />
  );
}

function EmptyHome() {
  return (
    <AppShell noTopBar>
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          padding: "20px 36px 48px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                style={{
                  fontSize: 16,
                  fontWeight: 600,
                  letterSpacing: "-0.02em",
                  color: MESH.fg,
                }}
              >
                Welcome to Mesh
              </span>
            </div>
            <div
              className="font-mono"
              style={{
                fontSize: 11,
                color: MESH.fgMute,
                marginTop: 4,
                letterSpacing: "0.02em",
              }}
            >
              no projects yet · create your first to begin
            </div>
          </div>
          <Pill tone="amber">Opus 4.7 · 1M</Pill>
        </div>

        <div
          style={{
            flex: 1,
            display: "grid",
            gridTemplateColumns: "1.05fr 1fr",
            gap: 56,
            marginTop: 64,
          }}
        >
          <div style={{ maxWidth: 520 }}>
            <div
              className="font-mono"
              style={{
                fontSize: 10,
                color: MESH.amber,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                marginBottom: 20,
              }}
            >
              Welcome to Mesh
            </div>
            <h1
              style={{
                fontSize: 44,
                fontWeight: 600,
                letterSpacing: "-0.03em",
                lineHeight: 1.1,
                margin: 0,
                color: MESH.fg,
              }}
            >
              The living layer
              <br />
              over your codebase.
            </h1>
            <p
              style={{
                fontSize: 14,
                color: MESH.fgDim,
                lineHeight: 1.65,
                marginTop: 20,
                maxWidth: 440,
              }}
            >
              A project is a set of related repos — web, api, analytics,
              content. Connect them once and Mesh turns tickets into
              coordinated PRs across the whole system.
            </p>

            <CreateFirstProjectForm />

            <div
              style={{
                marginTop: 52,
                paddingTop: 20,
                borderTop: `1px solid ${MESH.border}`,
                display: "flex",
                flexDirection: "column",
                gap: 16,
              }}
            >
              <Step
                n="01"
                title="Connect"
                desc="Mesh ingests your repos, extracts invariants, and maps cross-repo flows."
              />
              <Step
                n="02"
                title="Build"
                desc="Paste a ticket. Get a cited plan across every affected repo."
              />
              <Step
                n="03"
                title="Ship"
                desc="Execute the plan. Skills enforce invariants in real-time. PRs ready to review."
              />
            </div>
          </div>

          <div
            style={{
              border: `1px solid ${MESH.border}`,
              borderRadius: 12,
              padding: 20,
              position: "relative",
              minHeight: 420,
              background:
                "radial-gradient(60% 70% at 70% 40%, rgba(245,165,36,0.06) 0%, rgba(11,11,12,0) 60%), #0C0C0E",
            }}
          >
            <GraphPreview />
            <div
              className="font-mono"
              style={{
                position: "absolute",
                left: 20,
                bottom: 16,
                fontSize: 10,
                color: MESH.fgMute,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
              }}
            >
              Cross-repo graph · preview
            </div>
            <div
              className="font-mono"
              style={{
                position: "absolute",
                right: 20,
                bottom: 16,
                fontSize: 10,
                color: MESH.fgMute,
                letterSpacing: "0.02em",
              }}
            >
              your repos will appear here
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function Step({ n, title, desc }: { n: string; title: string; desc: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "32px 120px 1fr", gap: 12 }}>
      <span
        className="font-mono"
        style={{ fontSize: 11, color: MESH.fgMute, paddingTop: 2 }}
      >
        {n}
      </span>
      <span style={{ fontSize: 13, fontWeight: 600, color: MESH.fg }}>
        {title}
      </span>
      <span
        className="font-mono"
        style={{ fontSize: 12, color: MESH.fgDim, lineHeight: 1.55 }}
      >
        {desc}
      </span>
    </div>
  );
}

function CreateFirstProjectForm() {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, color: "amber" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data?.error === "string" ? data.error : "create failed");
        setBusy(false);
        return;
      }
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "create failed");
      setBusy(false);
    }
  }, [name, busy]);

  const canSubmit = name.trim().length > 0 && !busy;

  return (
    <div style={{ marginTop: 28 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 12px 10px 14px",
          background: MESH.bgElev,
          border: `1px solid ${MESH.border}`,
          borderRadius: 8,
          maxWidth: 460,
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
          Project
        </span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSubmit) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="e.g. flarebill"
          autoFocus
          disabled={busy}
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            color: MESH.fg,
            fontSize: 13.5,
          }}
        />
        <button
          type="button"
          disabled={!canSubmit}
          onClick={submit}
          style={{
            padding: "7px 14px",
            background: canSubmit ? MESH.amber : MESH.bgElev2,
            color: canSubmit ? "#0B0B0C" : MESH.fgMute,
            border: `1px solid ${canSubmit ? MESH.amber : MESH.border}`,
            borderRadius: 6,
            fontSize: 12.5,
            fontWeight: 600,
            cursor: canSubmit ? "pointer" : "not-allowed",
          }}
        >
          {busy ? "Creating…" : "Create →"}
        </button>
      </div>
      {error && (
        <div
          className="font-mono"
          style={{ fontSize: 11, color: MESH.red, marginTop: 8 }}
        >
          {error}
        </div>
      )}
      <div
        className="font-mono"
        style={{ fontSize: 11, color: MESH.fgMute, marginTop: 10 }}
      >
        Then connect your repos, review skills, and ship your first PR.
      </div>
    </div>
  );
}

function GraphPreview() {
  return (
    <svg width="100%" height="380" viewBox="0 0 480 380" aria-hidden>
      <g stroke={MESH.border} strokeWidth={1} fill="none" strokeDasharray="3,5">
        <line x1="140" y1="130" x2="330" y2="90" />
        <line x1="140" y1="130" x2="360" y2="220" />
        <line x1="140" y1="130" x2="230" y2="270" />
        <line x1="330" y1="90" x2="400" y2="180" />
        <line x1="400" y1="180" x2="360" y2="220" />
        <line x1="360" y1="220" x2="230" y2="270" />
      </g>
      <GraphNode cx={140} cy={130} label="web" />
      <GraphNode cx={330} cy={90} label="api" highlighted />
      <GraphNode cx={400} cy={180} label="analytics" />
      <GraphNode cx={360} cy={220} label="design-sys" />
      <GraphNode cx={230} cy={270} label="content" />
    </svg>
  );
}

function GraphNode({
  cx,
  cy,
  label,
  highlighted,
}: {
  cx: number;
  cy: number;
  label: string;
  highlighted?: boolean;
}) {
  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={highlighted ? 14 : 12}
        fill={MESH.bgElev2}
        stroke={highlighted ? MESH.amber : MESH.borderHi}
        strokeWidth={1}
      />
      <circle cx={cx} cy={cy} r={3} fill={MESH.fgDim} />
      <text
        x={cx}
        y={cy + 30}
        textAnchor="middle"
        style={{
          fontFamily: "var(--font-mono, ui-monospace)",
          fontSize: 10,
          fill: MESH.fgDim,
        }}
      >
        {label}
      </text>
    </g>
  );
}

function PopulatedHome({
  project,
  repos,
  memory,
  tickets,
  onTicketCreated,
  onReload,
}: {
  project: ProjectRecord;
  repos: RepoRecord[];
  memory: Memory | null;
  tickets: TicketEntry[];
  onTicketCreated: () => void;
  onReload: () => void;
}) {
  const invariantCount =
    (memory?.invariants?.length ?? 0) +
    (memory?.repos?.reduce((n, r) => n + (r.invariants?.length ?? 0), 0) ?? 0);
  const flowCount = memory?.cross_repo_flows?.length ?? 0;
  const staleCount = repos.filter((r) => !r.ingestedAt).length;
  const projectColor = PROJECT_COLOR_MAP[project.color];

  return (
    <AppShell noTopBar>
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          padding: "20px 32px 48px",
          overflow: "auto",
        }}
      >
        {/* Topbar */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
            paddingBottom: 20,
          }}
        >
          <div>
            <Link
              href={`/projects/${encodeURIComponent(project.id)}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <Dot color={projectColor} size={8} />
              <span
                style={{
                  fontSize: 16,
                  fontWeight: 600,
                  letterSpacing: "-0.02em",
                  color: MESH.fg,
                }}
              >
                {project.name}
              </span>
              {project.label && <Pill tone="dim">{project.label}</Pill>}
              <span
                className="font-mono"
                style={{ fontSize: 10, color: MESH.fgMute, marginLeft: 4 }}
              >
                open →
              </span>
            </Link>
            <div
              className="font-mono"
              style={{
                fontSize: 11,
                color: MESH.fgMute,
                marginTop: 4,
                letterSpacing: "0.02em",
              }}
            >
              {repos.length} repos · {invariantCount} invariants · {flowCount} cross-repo flows
            </div>
          </div>
          <Pill tone="amber">Opus 4.7 · 1M</Pill>
        </div>

        {/* Hero */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            padding: "36px 0 24px",
          }}
        >
          <h1
            style={{
              margin: 0,
              fontSize: 34,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              color: MESH.fg,
            }}
          >
            Welcome back, <span style={{ color: MESH.fg }}>you</span>
          </h1>
          <span
            className="font-mono"
            style={{ fontSize: 11, color: MESH.fgMute }}
          >
            {formatToday()}
          </span>
        </div>

        <NewTicketInput
          projectId={project.id}
          onCreated={onTicketCreated}
        />

        <OnboardingCard
          project={project}
          repos={repos}
          invariants={invariantCount}
          tickets={tickets}
          onChanged={onReload}
        />

        <StatsRow
          repos={repos}
          invariantCount={invariantCount}
          flowCount={flowCount}
          staleCount={staleCount}
        />

        <FlowRow staleCount={staleCount} tickets={tickets} />

        <YourWork tickets={tickets} />

        <button
          type="button"
          onClick={onReload}
          style={{ display: "none" }}
          aria-hidden
        />
      </div>
    </AppShell>
  );
}

function NewTicketInput({
  projectId,
  onCreated,
}: {
  projectId: string;
  onCreated: () => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const canSubmit = value.trim().length > 2 && !busy;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        const el = inputRef.current;
        if (el) {
          el.focus();
          el.select();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submit = useCallback(async () => {
    const v = value.trim();
    if (!v) return;
    setBusy(true);
    try {
      const title = v.length > 80 ? v.slice(0, 80) : v;
      const description = v.length > 80 ? v : "";
      const res = await fetch("/api/build/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description, projectId }),
      });
      if (res.ok) {
        setValue("");
        onCreated();
      }
    } finally {
      setBusy(false);
    }
  }, [value, projectId, onCreated]);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        borderRadius: 10,
        background: MESH.bgElev,
        border: `1px solid ${MESH.border}`,
        marginBottom: 24,
      }}
    >
      <span
        className="font-mono"
        style={{
          fontSize: 10,
          color: MESH.fgMute,
          textTransform: "uppercase",
          letterSpacing: "0.14em",
          minWidth: 72,
        }}
      >
        New ticket
      </span>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && canSubmit) {
            e.preventDefault();
            void submit();
          }
        }}
        placeholder="Paste a Linear / Jira ticket, or describe the change…"
        style={{
          flex: 1,
          background: "transparent",
          border: "none",
          outline: "none",
          color: MESH.fg,
          fontSize: 13.5,
        }}
      />
      <span
        className="font-mono"
        style={{
          fontSize: 10,
          color: MESH.fgMute,
          padding: "3px 7px",
          border: `1px solid ${MESH.border}`,
          borderRadius: 4,
          background: MESH.bgInput,
        }}
      >
        ⌘K
      </span>
      <button
        type="button"
        disabled={!canSubmit}
        onClick={submit}
        style={{
          padding: "7px 14px",
          background: canSubmit ? MESH.amber : MESH.bgElev2,
          color: canSubmit ? "#0B0B0C" : MESH.fgMute,
          border: `1px solid ${canSubmit ? MESH.amber : MESH.border}`,
          borderRadius: 6,
          fontSize: 12.5,
          fontWeight: 600,
          cursor: canSubmit ? "pointer" : "not-allowed",
        }}
      >
        Draft plan →
      </button>
    </div>
  );
}

type OnboardingStep = {
  key: string;
  title: string;
  desc: string;
  done: boolean;
  href?: string;
  onClick?: () => void;
};

function OnboardingCard({
  project,
  repos,
  invariants,
  tickets,
  onChanged,
}: {
  project: ProjectRecord;
  repos: RepoRecord[];
  invariants: number;
  tickets: TicketEntry[];
  onChanged: () => void;
}) {
  const onboarding = project.onboarding ?? { dismissed: false, stepsSeen: [] };
  const stepsSeen = onboarding.stepsSeen ?? [];
  const dismissed = onboarding.dismissed === true;

  const patchOnboarding = useCallback(
    async (patch: Partial<ProjectOnboarding>) => {
      const next = {
        dismissed: onboarding.dismissed ?? false,
        stepsSeen: onboarding.stepsSeen ?? [],
        ...patch,
      };
      try {
        await fetch(`/api/projects/${encodeURIComponent(project.id)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ onboarding: next }),
        });
      } catch {
        // best-effort — UI will reconcile on next reload
      }
      onChanged();
    },
    [project.id, onboarding.dismissed, onboarding.stepsSeen, onChanged],
  );

  const stale = repos.filter((r) => !r.ingestedAt).length;
  const ticketCount = tickets.length;
  const prCount = tickets.reduce((n, t) => n + (t.prs_count ?? 0), 0);

  const connectDone = repos.length > 0 && stale === 0;
  const skillsDone = stepsSeen.includes("skills");
  const ticketDone = ticketCount > 0;
  const shipDone = prCount > 0;

  const steps: OnboardingStep[] = [
    {
      key: "connect",
      title: "Connect repos",
      desc: connectDone
        ? `${repos.length} repo${repos.length > 1 ? "s" : ""} indexed.`
        : repos.length === 0
          ? "Add your first repo so Mesh can index it."
          : `${stale} of ${repos.length} repo${repos.length > 1 ? "s" : ""} still indexing.`,
      done: connectDone,
      href: "/connect",
    },
    {
      key: "skills",
      title: "Review skills",
      desc: skillsDone
        ? `${invariants} invariants in your guard rails.`
        : `${invariants} invariants extracted · review the rules guarding your code.`,
      done: skillsDone,
      href: "/settings#skills",
      onClick: () => {
        if (!skillsDone) {
          void patchOnboarding({
            stepsSeen: Array.from(new Set([...stepsSeen, "skills"])),
          });
        }
      },
    },
    {
      key: "ticket",
      title: "Create first ticket",
      desc: ticketDone
        ? `${ticketCount} ticket${ticketCount > 1 ? "s" : ""} created.`
        : "Open the ticket composer in Build.",
      done: ticketDone,
      href: "/build?new=1",
    },
    {
      key: "ship",
      title: "Ship first PR",
      desc: shipDone
        ? `${prCount} PR${prCount > 1 ? "s" : ""} opened.`
        : "Execute a plan and open your first PR.",
      done: shipDone,
      href: "/ship",
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;
  const activeIdx = steps.findIndex((s) => !s.done);

  if (dismissed || allDone) return null;

  return (
    <div
      style={{
        padding: 18,
        borderRadius: 10,
        background:
          "radial-gradient(120% 120% at 0% 0%, rgba(245,165,36,0.10) 0%, rgba(11,11,12,0) 60%), " +
          MESH.bgElev,
        border: "1px solid rgba(245,165,36,0.28)",
        marginBottom: 24,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <span
            className="font-mono"
            style={{
              fontSize: 10,
              color: MESH.amber,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
            }}
          >
            Onboarding · {doneCount} / {steps.length}
          </span>
          <span style={{ fontSize: 14, fontWeight: 600, color: MESH.fg }}>
            Get {project.name} ready to ship
          </span>
        </div>
        <button
          type="button"
          onClick={() => void patchOnboarding({ dismissed: true })}
          style={{
            background: "transparent",
            border: "none",
            color: MESH.fgMute,
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          Dismiss
        </button>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 10,
        }}
      >
        {steps.map((s, idx) => (
          <OnboardingStepCard
            key={s.key}
            step={s}
            index={idx + 1}
            isActive={idx === activeIdx}
          />
        ))}
      </div>
    </div>
  );
}

function OnboardingStepCard({
  step,
  index,
  isActive,
}: {
  step: OnboardingStep;
  index: number;
  isActive: boolean;
}) {
  const inner = (
    <div
      style={{
        position: "relative",
        padding: 14,
        borderRadius: 8,
        background: step.done
          ? MESH.bg
          : isActive
            ? "rgba(245,165,36,0.06)"
            : MESH.bg,
        border: step.done
          ? `1px solid ${MESH.border}`
          : isActive
            ? "1px solid rgba(245,165,36,0.32)"
            : `1px solid ${MESH.border}`,
        opacity: step.done ? 0.7 : 1,
        cursor: step.done ? "default" : "pointer",
        height: "100%",
        textAlign: "left",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 6,
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Dot
            color={step.done ? MESH.green : isActive ? MESH.amber : MESH.fgMute}
            size={6}
          />
          <span
            className="font-mono"
            style={{ fontSize: 10, color: MESH.fgMute }}
          >
            0{index}
          </span>
        </div>
        {isActive && !step.done && (
          <span
            style={{
              fontSize: 11,
              color: MESH.amber,
              fontWeight: 600,
            }}
          >
            →
          </span>
        )}
      </div>
      <div
        style={{
          fontSize: 12.5,
          fontWeight: 600,
          color: step.done ? MESH.fgDim : MESH.fg,
          marginBottom: 6,
        }}
      >
        {step.title}
      </div>
      <div
        className="font-mono"
        style={{
          fontSize: 11,
          color: MESH.fgDim,
          lineHeight: 1.5,
        }}
      >
        {step.desc}
      </div>
    </div>
  );

  if (step.done) return inner;

  if (step.href) {
    return (
      <Link
        href={step.href}
        onClick={step.onClick}
        style={{ textDecoration: "none", color: "inherit" }}
      >
        {inner}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={step.onClick}
      style={{
        all: "unset",
        cursor: "pointer",
        display: "block",
      }}
    >
      {inner}
    </button>
  );
}

function StatsRow({
  repos,
  invariantCount,
  flowCount,
  staleCount,
}: {
  repos: RepoRecord[];
  invariantCount: number;
  flowCount: number;
  staleCount: number;
}) {
  const indexed = repos.length - staleCount;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 12,
        padding: 16,
        borderRadius: 10,
        background: MESH.bgElev,
        border: `1px solid ${MESH.border}`,
        marginBottom: 20,
      }}
    >
      <Stat
        label="Repos"
        value={
          <>
            <span style={{ color: MESH.amber }}>{indexed}</span>
            <span style={{ color: MESH.fgMute, fontSize: 18 }}> / {repos.length}</span>
          </>
        }
        hint={`${staleCount} stale · 0 error`}
      />
      <Stat
        label="Invariants"
        value={invariantCount || 0}
        hint="cross-repo + per-repo"
      />
      <Stat
        label="Cross-repo flows"
        value={flowCount || 0}
        hint={flowCount > 0 ? "ready to trace" : "none yet"}
      />
      <Stat label="Last session" value="—" hint="no sessions yet" />
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint: string;
}) {
  return (
    <div>
      <div
        className="font-mono"
        style={{
          fontSize: 10,
          color: MESH.fgMute,
          textTransform: "uppercase",
          letterSpacing: "0.12em",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 28,
          fontWeight: 600,
          lineHeight: 1,
          color: MESH.fg,
          marginBottom: 8,
        }}
      >
        {value}
      </div>
      <div
        className="font-mono"
        style={{ fontSize: 11, color: MESH.fgDim }}
      >
        {hint}
      </div>
    </div>
  );
}

function FlowRow({
  staleCount,
  tickets,
}: {
  staleCount: number;
  tickets: TicketEntry[];
}) {
  const running = tickets.filter(
    (t) => t.status === "in_process" || t.status === "drafted",
  ).length;
  const prs = tickets.filter((t) => t.status === "for_review").length;
  const connectState = staleCount > 0 ? "ATTN" : "IDLE";
  const buildState = running > 0 ? "ATTN" : "IDLE";
  const shipState = prs > 0 ? "ATTN" : "IDLE";
  return (
    <div
      style={{
        padding: 16,
        borderRadius: 10,
        background: MESH.bgElev,
        border: `1px solid ${MESH.border}`,
        marginBottom: 24,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 12,
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 600, color: MESH.fg }}>
          Flow
        </span>
        <span
          className="font-mono"
          style={{ fontSize: 10, color: MESH.fgMute, letterSpacing: "0.02em" }}
        >
          connect → build → ship
        </span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr auto 1fr",
          alignItems: "stretch",
          gap: 10,
        }}
      >
        <FlowCard n="01" state={connectState} title="Connect" hint={staleCount > 0 ? `${staleCount} needs attention` : "all indexed"} href="/connect" />
        <FlowArrow />
        <FlowCard n="02" state={buildState} title="Build" hint={running > 0 ? `${running} in progress` : "paste a ticket"} href="/build" />
        <FlowArrow />
        <FlowCard n="03" state={shipState} title="Ship" hint={prs > 0 ? `${prs} awaiting review` : "no PRs yet"} href="/ship" />
      </div>
    </div>
  );
}

function FlowCard({
  n,
  state,
  title,
  hint,
  href,
}: {
  n: string;
  state: "ATTN" | "IDLE";
  title: string;
  hint: string;
  href: string;
}) {
  const attn = state === "ATTN";
  return (
    <Link
      href={href}
      style={{
        padding: 14,
        borderRadius: 8,
        background: attn ? "rgba(245,165,36,0.04)" : MESH.bg,
        border: `1px solid ${attn ? "rgba(245,165,36,0.3)" : MESH.border}`,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        textDecoration: "none",
        color: MESH.fg,
      }}
    >
      <div
        className="font-mono"
        style={{
          fontSize: 10,
          color: attn ? MESH.amber : MESH.fgMute,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
        }}
      >
        {n} · {state}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
      <div
        className="font-mono"
        style={{ fontSize: 11, color: MESH.fgDim }}
      >
        {hint}
      </div>
    </Link>
  );
}

function FlowArrow() {
  return (
    <span
      style={{
        alignSelf: "center",
        color: MESH.fgMute,
        fontSize: 11,
      }}
    >
      ›
    </span>
  );
}

function YourWork({ tickets }: { tickets: TicketEntry[] }) {
  const [tab, setTab] = useState<"running" | "review" | "drafted" | "all">(
    "running",
  );
  const running = tickets.filter(
    (t) => t.status === "in_process" || t.status === "drafted",
  );
  const review = tickets.filter((t) => t.status === "for_review");
  const drafted = tickets.filter((t) => t.status === "drafted");
  const shown =
    tab === "running"
      ? running
      : tab === "review"
        ? review
        : tab === "drafted"
          ? drafted
          : tickets;

  const TABS: { id: typeof tab; label: string; count: number }[] = [
    { id: "running", label: "Running", count: running.length },
    { id: "review", label: "For review", count: review.length },
    { id: "drafted", label: "Drafted", count: drafted.length },
    { id: "all", label: "All", count: tickets.length },
  ];

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <span style={{ fontSize: 16, fontWeight: 600, color: MESH.fg }}>
          Your work
        </span>
        <Link
          href="/build"
          className="font-mono"
          style={{
            fontSize: 11,
            color: MESH.fgDim,
            textDecoration: "none",
          }}
        >
          All work ({tickets.length})
        </Link>
      </div>
      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 12,
        }}
      >
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              style={{
                padding: "6px 12px",
                borderRadius: 999,
                background: active ? MESH.fg : "transparent",
                color: active ? MESH.bg : MESH.fgDim,
                border: `1px solid ${active ? MESH.fg : MESH.border}`,
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {t.label}{" "}
              <span
                style={{
                  color: active ? MESH.bg : MESH.fgMute,
                  marginLeft: 4,
                }}
              >
                ({t.count})
              </span>
            </button>
          );
        })}
      </div>
      <div
        style={{
          minHeight: 180,
          padding: 16,
          borderRadius: 10,
          background: MESH.bgElev,
          border: `1px solid ${MESH.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {shown.length === 0 ? (
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                background: MESH.bg,
                border: `1px solid ${MESH.border}`,
                margin: "0 auto 10px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: MESH.fgMute,
                fontSize: 16,
              }}
              aria-hidden
            >
              ≡
            </div>
            <div
              className="font-mono"
              style={{
                fontSize: 12,
                color: MESH.fgMute,
                lineHeight: 1.6,
              }}
            >
              {emptyCopy(tab)}
            </div>
          </div>
        ) : (
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              width: "100%",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {shown.slice(0, 8).map((t) => (
              <li key={t.id}>
                <Link
                  href={`/build?ticket=${encodeURIComponent(t.id)}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "8px 10px",
                    borderRadius: 6,
                    textDecoration: "none",
                    color: MESH.fg,
                    background: MESH.bg,
                    border: `1px solid ${MESH.border}`,
                  }}
                >
                  <span
                    className="font-mono"
                    style={{ fontSize: 10, color: MESH.fgMute, minWidth: 68 }}
                  >
                    {t.id}
                  </span>
                  <span style={{ fontSize: 12.5, flex: 1 }}>{t.title}</span>
                  <span
                    className="font-mono"
                    style={{ fontSize: 10, color: MESH.fgMute }}
                  >
                    {t.status}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function emptyCopy(tab: "running" | "review" | "drafted" | "all"): string {
  if (tab === "running") return "No tickets running right now.";
  if (tab === "review") return "Nothing for review yet.";
  if (tab === "drafted") return "No drafts yet.";
  return "No tickets yet — paste one above.";
}

function formatToday(): string {
  const d = new Date();
  const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
  const month = d.toLocaleDateString("en-US", { month: "short" });
  const day = d.getDate();
  return `${weekday} · ${month} ${day}`;
}
