"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AppShell,
  CinemaThinking,
  KanbanColumn,
  Kbd,
  MESH,
  NewTicketModal,
  Pill,
  PrimaryButton,
  TicketCard,
  useDraftCinema,
  type NewTicketPayload,
  type KanbanColumnTone,
} from "@/components/mesh";
import type {
  TicketIndexEntry,
  TicketStatus,
} from "@/lib/ticket-store";

type TopbarStats = {
  repos: number;
  projectName: string | null;
  invariants: number;
  crossRepoFlows: number;
};

const COLS: Array<{
  status: TicketStatus;
  title: string;
  subtitle: string;
  tone: KanbanColumnTone;
}> = [
  {
    status: "inbox",
    title: "Inbox",
    subtitle: "unclassified · awaiting claude",
    tone: "inbox",
  },
  {
    status: "drafted",
    title: "Drafted",
    subtitle: "cross-repo plan ready",
    tone: "amber",
  },
  {
    status: "in_process",
    title: "In process",
    subtitle: "shipping across repos",
    tone: "amber",
  },
  {
    status: "for_review",
    title: "For review",
    subtitle: "prs open · awaiting human",
    tone: "green",
  },
];

export default function BuildBoardPage() {
  const [tickets, setTickets] = useState<TicketIndexEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<TopbarStats>({
    repos: 0,
    projectName: null,
    invariants: 0,
    crossRepoFlows: 0,
  });
  const [modalOpen, setModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const cinema = useDraftCinema();

  const loadTickets = useCallback(async () => {
    try {
      const res = await fetch("/api/build/tickets", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { tickets: TicketIndexEntry[] };
      setTickets(data.tickets ?? []);
    } catch {
      // silent
    }
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const [memRes, reposRes, projectsRes] = await Promise.all([
        fetch("/api/memory", { cache: "no-store" }),
        fetch("/api/repos", { cache: "no-store" }),
        fetch("/api/projects", { cache: "no-store" }),
      ]);
      let invariants = 0;
      let crossRepoFlows = 0;
      let projectName: string | null = null;
      if (memRes.ok) {
        const mem = await memRes.json().catch(() => null);
        const memory = mem?.memory;
        if (memory) {
          invariants =
            (memory.invariants?.length ?? 0) ||
            (memory.repos ?? []).reduce(
              (n: number, r: { invariants?: unknown[] }) =>
                n + (r.invariants?.length ?? 0),
              0,
            );
          crossRepoFlows = memory.cross_repo_flows?.length ?? 0;
        }
      }
      let repos = 0;
      if (reposRes.ok) {
        const rd = await reposRes.json().catch(() => null);
        if (rd?.repos) repos = rd.repos.length;
      }
      if (projectsRes.ok) {
        const pd = await projectsRes.json().catch(() => null);
        const list = (pd?.projects ?? []) as {
          id: string;
          name: string;
          label?: string;
        }[];
        const current = list.find((p) => p.id === pd?.currentProjectId) ?? list[0];
        if (current) {
          projectName = current.label
            ? `${current.name} · ${current.label}`
            : current.name;
        }
      }
      setStats({ repos, projectName, invariants, crossRepoFlows });
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    (async () => {
      await Promise.all([loadTickets(), loadStats()]);
      setLoading(false);
    })();
  }, [loadTickets, loadStats]);

  // Poll for ticket updates while any ticket is mid-flight (drafting or shipping).
  useEffect(() => {
    const hasMidFlight = tickets.some(
      (t) => !!t.drafting_phase || t.status === "in_process",
    );
    if (!hasMidFlight) return;
    const h = setInterval(() => {
      void loadTickets();
    }, 1500);
    return () => clearInterval(h);
  }, [tickets, loadTickets]);

  const grouped = useMemo(() => {
    const buckets: Record<TicketStatus, TicketIndexEntry[]> = {
      inbox: [],
      drafted: [],
      in_process: [],
      for_review: [],
    };
    for (const t of tickets) buckets[t.status].push(t);
    return buckets;
  }, [tickets]);

  const draftedToday = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return tickets.filter(
      (t) =>
        (t.status === "drafted" ||
          t.status === "in_process" ||
          t.status === "for_review") &&
        t.updated_at.startsWith(today),
    ).length;
  }, [tickets]);

  // Auto-open new-ticket modal when arriving with ?new=1 (e.g. from onboarding card)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("new") === "1") {
      setModalOpen(true);
      params.delete("new");
      const qs = params.toString();
      const next = window.location.pathname + (qs ? `?${qs}` : "");
      window.history.replaceState(null, "", next);
    }
  }, []);

  // Keyboard: 'c' opens new ticket
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (modalOpen) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "c" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setModalOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalOpen]);

  const onSubmit = async (p: NewTicketPayload) => {
    setCreating(true);
    try {
      const res = await fetch("/api/build/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: p.title,
          description: p.description,
          priority: p.priority,
          labels: p.labels,
          source_hint: p.source_hint,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { ticket } = (await res.json()) as {
        ticket: { id: string; title: string };
      };
      setModalOpen(false);
      await loadTickets();
      if (p.handoff) {
        cinema.start(ticket.id, ticket.title ?? p.title);
        // Background poll keeps the kanban in sync while cinema runs.
      }
    } catch (err) {
      alert(
        `Could not create ticket: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    } finally {
      setCreating(false);
    }
  };

  const totalActive = tickets.length;

  // Auto-refresh once cinema completes so the kanban shows the new "drafted" ticket
  useEffect(() => {
    if (cinema.doneAt) {
      void loadTickets();
    }
  }, [cinema.doneAt, loadTickets]);

  const cinemaSubtitle = cinema.ticketTitle
    ? cinema.ticketTitle
    : cinema.ticketId
      ? cinema.ticketId
      : undefined;

  return (
    <AppShell
      title="Tickets"
      subtitle={
        loading
          ? "loading tickets…"
          : `${totalActive} active · ${stats.repos} repos · synced with mesh memory`
      }
      topRight={
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          {stats.projectName && (
            <Pill tone="amber">
              {stats.repos} repos · {stats.projectName}
            </Pill>
          )}
          {stats.invariants > 0 && (
            <Pill tone="default">{stats.invariants} invariants</Pill>
          )}
          {stats.crossRepoFlows > 0 && (
            <Pill tone="default">
              {stats.crossRepoFlows} cross-repo flows
            </Pill>
          )}
          {draftedToday > 0 && (
            <Pill tone="default">{draftedToday} drafted today</Pill>
          )}
          <PrimaryButton onClick={() => setModalOpen(true)} kbd="c">
            + new ticket
          </PrimaryButton>
        </div>
      }
    >
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          gap: 18,
          padding: "20px 28px 18px",
          overflow: "hidden",
        }}
      >
        {COLS.map((c, i) => {
          const bucket = grouped[c.status];
          return (
            <KanbanColumn
              key={c.status}
              title={c.title}
              subtitle={c.subtitle}
              tone={c.tone}
              count={bucket.length}
              index={i}
              footer={
                c.status === "drafted" && bucket.length === 0 && !cinema.active ? (
                  <DraftHint />
                ) : null
              }
            >
              {bucket.length === 0 && c.status !== "drafted" && (
                <EmptyBucket status={c.status} />
              )}
              {bucket.map((t) => (
                <TicketCard
                  key={t.id}
                  ticket={t}
                  href={`/build/${encodeURIComponent(t.id)}`}
                />
              ))}
            </KanbanColumn>
          );
        })}
      </div>

      <NewTicketModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={onSubmit}
        busy={creating}
      />

      <CinemaThinking
        mode={cinema.mode}
        text={cinema.text}
        active={cinema.active}
        tokens={cinema.tokens}
        phase={cinema.phase}
        phases={cinema.phases}
        dispatchSummary={cinema.dispatchSummary}
        title={cinemaSubtitle ? "Drafting cross-repo plan" : "Extended thinking"}
        subtitle={cinemaSubtitle}
        meta={
          cinema.error ? (
            <Pill tone="red">error</Pill>
          ) : (
            <Pill tone={cinema.active ? "amber" : "green"}>
              {cinema.active
                ? cinema.phase?.label ?? "thinking"
                : cinema.doneAt
                  ? "plan ready"
                  : "ready"}
            </Pill>
          )
        }
        footer={
          cinema.doneAt && cinema.ticketId ? (
            <a
              href={`/build/${encodeURIComponent(cinema.ticketId)}`}
              className="mesh-mono"
              style={{
                padding: "6px 12px",
                background: MESH.amber,
                color: "#1A1208",
                border: `1px solid ${MESH.amber}`,
                borderRadius: 6,
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.14em",
                textDecoration: "none",
                fontWeight: 600,
              }}
            >
              open plan ↗
            </a>
          ) : (
            <span
              className="mesh-mono"
              style={{ fontSize: 11, color: MESH.fgMute }}
            >
              <Kbd size="xs">esc</Kbd> to dock
            </span>
          )
        }
        onDismiss={() => cinema.setMode("docked")}
        onExpand={() => cinema.setMode("cinema")}
      />

      {cinema.mode === "docked" && cinema.ticketId && (
        <DockedChip
          ticketTitle={cinema.ticketTitle ?? cinema.ticketId}
          phase={cinema.phase?.label ?? "thinking"}
          tokens={cinema.tokens}
          active={cinema.active}
          onExpand={() => cinema.setMode("cinema")}
          onClose={() => cinema.dismiss()}
        />
      )}
    </AppShell>
  );
}

function DraftHint() {
  return (
    <div
      style={{
        padding: "12px 14px",
        background: MESH.bgElev,
        border: `1px dashed ${MESH.border}`,
        borderRadius: 6,
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div
        style={{
          fontSize: 13,
          color: MESH.fgDim,
          lineHeight: 1.4,
          fontWeight: 500,
        }}
      >
        Claude drafts here
      </div>
      <div
        className="mesh-mono"
        style={{
          fontSize: 9,
          color: MESH.fgMute,
          textTransform: "uppercase",
          letterSpacing: "0.14em",
          lineHeight: 1.6,
        }}
      >
        cross-repo plan · ~8 seconds
      </div>
    </div>
  );
}

function EmptyBucket({ status }: { status: TicketStatus }) {
  const copy =
    status === "inbox"
      ? "Inbox is calm."
      : status === "in_process"
        ? "Tickets land here when you ship."
        : status === "for_review"
          ? "Open PRs surface here."
          : "";
  if (!copy) return null;
  return (
    <div
      style={{
        padding: "20px 12px",
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div
        style={{
          fontSize: 13,
          color: MESH.fgDim,
          lineHeight: 1.5,
          fontWeight: 400,
        }}
      >
        {copy}
      </div>
      {status === "inbox" && (
        <div
          className="mesh-mono"
          style={{
            fontSize: 10,
            color: MESH.fgMute,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            textTransform: "uppercase",
            letterSpacing: "0.14em",
          }}
        >
          press <Kbd size="xs" tone="amber">c</Kbd> to draft
        </div>
      )}
    </div>
  );
}

function DockedChip({
  ticketTitle,
  phase,
  tokens,
  active,
  onExpand,
  onClose,
}: {
  ticketTitle: string;
  phase: string;
  tokens: number;
  active: boolean;
  onExpand: () => void;
  onClose: () => void;
}) {
  const tokensLabel =
    tokens >= 4000
      ? `${(Math.ceil(tokens / 4) / 1000).toFixed(1)}K`
      : `${Math.ceil(tokens / 4)}`;
  return (
    <div
      role="status"
      style={{
        position: "fixed",
        bottom: 22,
        right: 22,
        zIndex: 70,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        background: MESH.bgElev,
        border: `1px solid ${MESH.borderHi}`,
        borderRadius: 8,
        boxShadow: "0 12px 36px rgba(0,0,0,0.55), 0 0 0 1px rgba(245,165,36,0.18)",
        animation: "mesh-rise var(--motion-base) var(--ease) both",
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          background: active ? MESH.amber : MESH.green,
          boxShadow: active ? `0 0 12px ${MESH.amber}` : "none",
          animation: active ? "mesh-pulse 1.6s ease-in-out infinite" : undefined,
        }}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 2, maxWidth: 260 }}>
        <span
          className="mesh-mono"
          style={{
            fontSize: 11,
            color: MESH.fg,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: 260,
          }}
        >
          {ticketTitle}
        </span>
        <span
          className="mesh-hud"
          style={{ color: MESH.fgMute }}
        >
          {phase} · ~{tokensLabel} tokens
        </span>
      </div>
      <button
        type="button"
        onClick={onExpand}
        className="mesh-mono"
        style={{
          background: "transparent",
          color: MESH.amber,
          border: `1px solid ${MESH.borderHi}`,
          borderRadius: 4,
          padding: "4px 8px",
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.14em",
          cursor: "pointer",
        }}
      >
        expand
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label="Dismiss"
        style={{
          background: "transparent",
          color: MESH.fgMute,
          border: 0,
          fontSize: 14,
          cursor: "pointer",
          padding: "0 4px",
        }}
      >
        ×
      </button>
    </div>
  );
}
