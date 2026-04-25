"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AppShell,
  KanbanColumn,
  MESH,
  NewTicketModal,
  Pill,
  PrimaryButton,
  TicketCard,
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
    subtitle: "unclassified",
    tone: "inbox",
  },
  {
    status: "drafted",
    title: "Drafted",
    subtitle: "claude produced a plan",
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
    subtitle: "prs open, awaiting human",
    tone: "green",
  },
];

export default function ConverseBoardPage() {
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

  const loadTickets = useCallback(async () => {
    try {
      const res = await fetch("/api/converse/tickets", { cache: "no-store" });
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
      const res = await fetch("/api/converse/tickets", {
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
      const { ticket } = (await res.json()) as { ticket: { id: string } };
      setModalOpen(false);
      await loadTickets();
      if (p.handoff) {
        // Fire and drain the SSE stream in the background. The board polls the
        // ticket index to pick up status transitions.
        void streamDraft(ticket.id, loadTickets);
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
          gap: 16,
          padding: "18px 24px 16px",
          overflow: "hidden",
        }}
      >
        {COLS.map((c) => {
          const bucket = grouped[c.status];
          return (
            <KanbanColumn
              key={c.status}
              title={c.title}
              subtitle={c.subtitle}
              tone={c.tone}
              count={bucket.length}
              footer={
                c.status === "drafted" && bucket.length === 0 ? (
                  <div
                    className="font-mono"
                    style={{
                      padding: "10px 12px",
                      fontSize: 10,
                      color: MESH.fgMute,
                      background: MESH.bgElev,
                      border: `1px dashed ${MESH.border}`,
                      borderRadius: 6,
                      textAlign: "center",
                      lineHeight: 1.5,
                    }}
                  >
                    new tickets are auto-drafted by claude
                    <br />— cross-repo plan appears here in ~8s —
                  </div>
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
                  href={`/converse/${encodeURIComponent(t.id)}`}
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
    </AppShell>
  );
}

function EmptyBucket({ status }: { status: TicketStatus }) {
  const copy =
    status === "inbox"
      ? "press c to create a ticket"
      : status === "in_process"
        ? "tickets land here when you ship"
        : status === "for_review"
          ? "open prs will surface here"
          : "";
  if (!copy) return null;
  return (
    <div
      className="font-mono"
      style={{
        padding: "12px 10px",
        fontSize: 10,
        color: MESH.fgMute,
        textAlign: "center",
      }}
    >
      {copy}
    </div>
  );
}

async function streamDraft(
  ticketId: string,
  onUpdate: () => Promise<void>,
): Promise<void> {
  try {
    const res = await fetch(
      `/api/converse/tickets/${encodeURIComponent(ticketId)}/draft`,
      { method: "POST" },
    );
    if (!res.ok || !res.body) {
      void onUpdate();
      return;
    }
    const reader = res.body.getReader();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
  } catch {
    // swallow; polling handles final state
  } finally {
    void onUpdate();
  }
}
