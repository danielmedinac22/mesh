"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  AdjustPlanModal,
  AppShell,
  Dot,
  MESH,
  ModalLabel,
  Pill,
  PrimaryButton,
  SecondaryButton,
  type AdjustContext,
  type AdjustPayload,
} from "@/components/mesh";
import { NavIcon } from "@/components/mesh/icons";
import type { TicketRecord } from "@/lib/ticket-store";
import type { SavedPlan } from "@/lib/plan-store";
import {
  flattenPlanV2,
  isPlanV2,
  type AcceptanceCriterion,
  type Contract,
  type PlanV2,
  type UnifiedStep,
} from "@/lib/prompts/plan";

type DetailResponse = { ticket: TicketRecord; plan: SavedPlan | null };

type StepStatus =
  | "queued"
  | "drafting"
  | "drafted"
  | "running"
  | "committed"
  | "failed";

type LiveStep = {
  step: number;
  repo: string;
  file: string;
  action: "edit" | "create";
  status: StepStatus;
  sha?: string;
  attempts?: number;
  intercept?: { title: string; fix_hint: string } | null;
  // SDD/TDD trace metadata. Optional so legacy v1 plans still render.
  kind?: "test" | "impl";
  test_id?: string;
  impl_id?: string;
  ac_ids?: string[];
  test_ids?: string[];
  agent?: "frontend" | "backend" | "product" | "qa";
  test_kind?: "unit" | "integration" | "e2e" | "contract" | "manual";
};

function unifiedToLive(s: UnifiedStep): LiveStep {
  if (s.kind === "test") {
    return {
      step: s.step,
      repo: s.repo,
      file: s.file,
      action: s.action,
      status: "queued",
      kind: "test",
      test_id: s.test_id,
      ac_ids: s.ac_ids,
      agent: s.agent,
      test_kind: s.test_kind,
    };
  }
  return {
    step: s.step,
    repo: s.repo,
    file: s.file,
    action: s.action,
    status: "queued",
    kind: "impl",
    impl_id: s.impl_id,
    test_ids: s.test_ids,
    agent: s.agent,
  };
}

type ShipState = {
  running: boolean;
  steps: LiveStep[];
  thinkingByStep: Record<number, string>;
};

export default function TicketDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = decodeURIComponent(params.id);

  const [ticket, setTicket] = useState<TicketRecord | null>(null);
  const [plan, setPlan] = useState<SavedPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [view, setView] = useState<"rendered" | "raw">("rendered");
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [ship, setShip] = useState<ShipState>({
    running: false,
    steps: [],
    thinkingByStep: {},
  });

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/converse/tickets/${encodeURIComponent(id)}`,
        { cache: "no-store" },
      );
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as DetailResponse;
      setTicket(data.ticket);
      setPlan(data.plan);
      setLoading(false);
    } catch {
      // silent
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll while the ticket is mid-flight (drafting or shipping).
  useEffect(() => {
    if (!ticket) return;
    const mid =
      !!ticket.drafting ||
      ticket.status === "in_process" ||
      ship.running;
    if (!mid) return;
    const h = setInterval(() => void load(), 1200);
    return () => clearInterval(h);
  }, [ticket, ship.running, load]);

  const planV2 = useMemo<PlanV2 | null>(
    () => (plan && isPlanV2(plan.plan) ? (plan.plan as PlanV2) : null),
    [plan],
  );
  const isLegacy = !!plan && !planV2;

  const flatSteps = useMemo<UnifiedStep[]>(
    () => (planV2 ? flattenPlanV2(planV2) : []),
    [planV2],
  );

  const reposTouched = useMemo(() => {
    const s = new Set<string>();
    for (const st of flatSteps) s.add(st.repo);
    return Array.from(s);
  }, [flatSteps]);

  const invariantsUsed = useMemo(() => {
    const s = new Set<string>();
    for (const st of flatSteps)
      for (const inv of st.invariants_respected) s.add(inv);
    return Array.from(s).filter((x) => x !== "no-invariant-applies");
  }, [flatSteps]);

  const adrsCited = useMemo(() => {
    if (!plan) return [] as string[];
    const found = new Set<string>();
    const rx = /ADR-\d{3,}/g;
    const hay = `${plan.classification.reasoning} ${JSON.stringify(plan.plan)}`;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(hay)) !== null) found.add(m[0]);
    return Array.from(found);
  }, [plan]);

  const handoff = useCallback(async () => {
    if (!ticket) return;
    setHandoffBusy(true);
    try {
      const res = await fetch(
        `/api/converse/tickets/${encodeURIComponent(ticket.id)}/draft`,
        { method: "POST" },
      );
      if (res.body) {
        const reader = res.body.getReader();
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      }
    } finally {
      setHandoffBusy(false);
      await load();
    }
  }, [ticket, load]);

  const onAdjustSubmit = useCallback(
    async (p: AdjustPayload) => {
      if (!ticket) return;
      setAdjusting(true);
      try {
        const res = await fetch(
          `/api/converse/tickets/${encodeURIComponent(ticket.id)}/adjust`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(p),
          },
        );
        if (res.body) {
          const reader = res.body.getReader();
          // eslint-disable-next-line no-constant-condition
          while (true) {
            const { done } = await reader.read();
            if (done) break;
          }
        }
      } finally {
        setAdjusting(false);
        setAdjustOpen(false);
        await load();
      }
    },
    [ticket, load],
  );

  const onProceedShip = useCallback(async () => {
    if (!ticket || !ticket.plan_id || !plan) return;
    // Initialize live steps in "queued" state from the flattened v2 plan.
    const initial: LiveStep[] = flatSteps.map(unifiedToLive);
    setShip({ running: true, steps: initial, thinkingByStep: {} });

    try {
      // Pre-create branches per repo using classification.target_branch.
      await fetch("/api/branches/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_branch: plan.classification.target_branch,
          repos: reposTouched,
        }),
      }).catch(() => null);

      const res = await fetch("/api/ship", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan_id: ticket.plan_id,
          ticket_id: ticket.id,
        }),
      });
      if (!res.ok || !res.body) {
        setShip((s) => ({ ...s, running: false }));
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      const apply = (payload: string) => {
        try {
          const ev = JSON.parse(payload);
          applyShipEvent(ev, setShip);
        } catch {
          // ignore bad chunk
        }
      };
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx = buf.indexOf("\n\n");
        while (idx >= 0) {
          const frame = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 2);
          if (frame.startsWith("data:")) {
            apply(frame.slice(5).trim());
          }
          idx = buf.indexOf("\n\n");
        }
      }
    } finally {
      setShip((s) => ({ ...s, running: false }));
      await load();
    }
  }, [ticket, plan, flatSteps, reposTouched, load]);

  if (notFound) {
    return (
      <AppShell title="Ticket not found">
        <div
          style={{
            padding: 32,
            color: MESH.fgDim,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div>This ticket does not exist.</div>
          <div>
            <Link
              href="/converse"
              style={{ color: MESH.amber, textDecoration: "none" }}
            >
              ← back to tickets
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  if (loading || !ticket) {
    return (
      <AppShell title="Loading ticket…" subtitle={id}>
        <div style={{ padding: 32, color: MESH.fgDim }}>Loading…</div>
      </AppShell>
    );
  }

  const statusPill = renderStatusPill(ticket, ship.running);

  // Live steps while shipping; canonical saved steps otherwise.
  const steps =
    ship.steps.length > 0
      ? ship.steps
      : flatSteps.map<LiveStep>((s) => ({
          ...unifiedToLive(s),
          status: ticket.status === "for_review" ? "committed" : "drafted",
        }));

  return (
    <AppShell
      title="Build"
      subtitle={
        <span>
          <span className="font-mono">{ticket.id}</span>
          {plan && (
            <>
              {"  ·  "}
              <span className="font-mono">
                {plan.classification.target_branch}
              </span>
            </>
          )}
        </span>
      }
      topRight={
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <SecondaryButton onClick={() => router.push("/converse")}>
            ← back to tickets
          </SecondaryButton>
          {statusPill}
        </div>
      }
    >
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          gap: 0,
          overflow: "hidden",
        }}
      >
        {/* LEFT — plan.md */}
        <div
          style={{
            flex: "1 1 60%",
            minWidth: 0,
            borderRight: `1px solid ${MESH.border}`,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "10px 18px",
              borderBottom: `1px solid ${MESH.border}`,
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <NavIcon kind="file" color={MESH.fgDim} size={12} />
            <span
              className="font-mono"
              style={{ fontSize: 11, color: MESH.fgDim }}
            >
              plan.md
            </span>
            <span style={{ flex: 1 }} />
            <div
              style={{
                display: "flex",
                gap: 0,
                border: `1px solid ${MESH.border}`,
                borderRadius: 4,
                overflow: "hidden",
              }}
            >
              {(["rendered", "raw"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  style={{
                    padding: "4px 10px",
                    fontSize: 10,
                    color: view === v ? MESH.fg : MESH.fgMute,
                    background: view === v ? MESH.bgElev2 : "transparent",
                    border: "none",
                    cursor: "pointer",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                  }}
                  className="font-mono"
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              padding: "24px 32px 40px",
            }}
          >
            {plan ? (
              view === "rendered" ? (
                <PlanRendered
                  ticket={ticket}
                  plan={plan}
                  planV2={planV2}
                  isLegacy={isLegacy}
                  flatSteps={flatSteps}
                  reposTouched={reposTouched}
                  adrsCited={adrsCited}
                />
              ) : (
                <pre
                  className="font-mono"
                  style={{
                    fontSize: 11,
                    color: MESH.fgDim,
                    whiteSpace: "pre-wrap",
                    lineHeight: 1.6,
                  }}
                >
                  {JSON.stringify(plan, null, 2)}
                </pre>
              )
            ) : (
              <InboxView ticket={ticket} />
            )}
          </div>
        </div>

        {/* RIGHT — steps */}
        <div
          style={{
            flex: "1 1 40%",
            minWidth: 360,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "10px 18px",
              borderBottom: `1px solid ${MESH.border}`,
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 500, color: MESH.fg }}>
              Steps
            </span>
            {plan && (
              <Pill tone="amber">
                {flatSteps.length} · {reposTouched.length} repos
              </Pill>
            )}
            <span style={{ flex: 1 }} />
            {reposTouched.map((r) => (
              <RepoSummaryPill
                key={r}
                name={r}
                steps={steps.filter((s) => s.repo === r)}
              />
            ))}
          </div>
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              padding: "14px 16px 20px",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {!plan && (
              <div
                style={{
                  padding: "24px 18px",
                  color: MESH.fgDim,
                  fontSize: 12,
                  textAlign: "center",
                  border: `1px dashed ${MESH.border}`,
                  borderRadius: 6,
                }}
              >
                No plan yet.
              </div>
            )}
            {plan && isLegacy && (
              <div
                style={{
                  padding: "12px 14px",
                  color: MESH.fgDim,
                  fontSize: 11,
                  border: `1px solid ${MESH.border}`,
                  background: MESH.bgElev,
                  borderRadius: 6,
                  lineHeight: 1.55,
                }}
              >
                This plan was generated with the legacy v1 brain. Re-run{" "}
                <span className="font-mono" style={{ color: MESH.amber }}>
                  build
                </span>{" "}
                to regenerate it as a v2 SDD/TDD plan before shipping.
              </div>
            )}
            {plan &&
              flatSteps.map((p) => {
                const live = steps.find((s) => s.step === p.step);
                return (
                  <StepCard
                    key={p.step}
                    number={p.step}
                    repo={p.repo}
                    file={p.file}
                    action={p.action}
                    rationale={p.rationale}
                    invariantsRespected={p.invariants_respected}
                    memoryCitations={p.memory_citations}
                    unified={p}
                    live={live}
                  />
                );
              })}
          </div>

          {/* Footer actions */}
          <footer
            style={{
              padding: "12px 16px",
              borderTop: `1px solid ${MESH.border}`,
              background: MESH.bg,
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            {ticket.status === "inbox" && (
              <>
                <span
                  className="font-mono"
                  style={{ fontSize: 10, color: MESH.fgMute }}
                >
                  not yet drafted
                </span>
                <span style={{ flex: 1 }} />
                <PrimaryButton
                  onClick={handoff}
                  disabled={handoffBusy || !!ticket.drafting}
                >
                  {handoffBusy || ticket.drafting
                    ? "claude is thinking…"
                    : "build"}
                </PrimaryButton>
              </>
            )}
            {ticket.status === "drafted" && plan && (
              <>
                <SecondaryButton onClick={() => setAdjustOpen(true)}>
                  ask claude to adjust
                </SecondaryButton>
                {ticket.adjustments.length > 0 && (
                  <Pill tone="default">
                    v{ticket.adjustments.length + 1}
                  </Pill>
                )}
                <span style={{ flex: 1 }} />
                <PrimaryButton
                  onClick={onProceedShip}
                  disabled={ship.running || isLegacy}
                >
                  {ship.running
                    ? "shipping…"
                    : isLegacy
                      ? "regenerate · v2 plan required"
                      : `proceed · ship ${flatSteps.length} steps`}
                </PrimaryButton>
              </>
            )}
            {ticket.status === "in_process" && (
              <>
                <span
                  className="font-mono"
                  style={{ fontSize: 10, color: MESH.amber }}
                >
                  {ship.running
                    ? "shipping live…"
                    : `shipping · ${ticket.ship_session?.steps_done ?? 0}/${ticket.ship_session?.steps_total ?? 0}`}
                </span>
                <span style={{ flex: 1 }} />
                <SecondaryButton disabled>shipping…</SecondaryButton>
              </>
            )}
            {ticket.status === "for_review" && (
              <>
                <span
                  className="font-mono"
                  style={{ fontSize: 10, color: MESH.green }}
                >
                  {ticket.prs.length} PR{ticket.prs.length === 1 ? "" : "s"} open
                </span>
                <span style={{ flex: 1 }} />
                {ticket.prs.map((pr) => (
                  <a
                    key={pr.url}
                    href={pr.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ textDecoration: "none" }}
                  >
                    <SecondaryButton>
                      view {pr.repo}
                      {pr.number ? ` #${pr.number}` : ""}
                    </SecondaryButton>
                  </a>
                ))}
                <a href="/ship" style={{ textDecoration: "none" }}>
                  <PrimaryButton>validate in Ship →</PrimaryButton>
                </a>
              </>
            )}
          </footer>
        </div>
      </div>

      <AdjustPlanModal
        open={adjustOpen}
        onClose={() => setAdjustOpen(false)}
        onSubmit={onAdjustSubmit}
        busy={adjusting}
        ctx={
          plan
            ? ({
                ticket_id: ticket.id,
                target_branch: plan.classification.target_branch,
                repos: reposTouched,
                invariants: invariantsUsed,
                cited_adrs: adrsCited,
                step_count: flatSteps.length,
              } satisfies AdjustContext)
            : null
        }
      />
    </AppShell>
  );
}

function renderStatusPill(ticket: TicketRecord, shipping: boolean) {
  if (ticket.drafting) {
    const phase = ticket.drafting.phase;
    const label =
      phase === "classifying"
        ? "classifying"
        : phase === "planning"
          ? "multi-agent planning"
          : "synthesizing plan";
    return (
      <Pill tone="amber">
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            background: "currentColor",
            animation: "mesh-pulse 1.2s ease-in-out infinite",
            display: "inline-block",
          }}
        />
        drafting · {label}
      </Pill>
    );
  }
  if (ticket.status === "in_process" || shipping) {
    const done = ticket.ship_session?.steps_done ?? 0;
    const total = ticket.ship_session?.steps_total ?? 0;
    return (
      <Pill tone="amber">
        shipping · {done}/{total}
      </Pill>
    );
  }
  if (ticket.status === "for_review") {
    return (
      <Pill tone="green">
        for review · {ticket.prs.length} PR{ticket.prs.length === 1 ? "" : "s"}
      </Pill>
    );
  }
  if (ticket.status === "drafted") {
    return <Pill tone="amber">drafted</Pill>;
  }
  return <Pill tone="default">inbox</Pill>;
}

function InboxView({ ticket }: { ticket: TicketRecord }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        style={{
          fontSize: 22,
          lineHeight: "28px",
          fontWeight: 500,
          color: MESH.fg,
          letterSpacing: "-0.01em",
        }}
      >
        {ticket.title}
      </div>
      {ticket.description && (
        <div
          style={{
            fontSize: 13,
            lineHeight: 1.65,
            color: MESH.fgDim,
            whiteSpace: "pre-wrap",
          }}
        >
          {ticket.description}
        </div>
      )}
      <div
        style={{
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
        }}
      >
        {ticket.labels.map((l) => (
          <Pill key={l} tone="dim">
            {l}
          </Pill>
        ))}
        <Pill tone="default">priority: {ticket.priority}</Pill>
        <Pill tone="default">source: {ticket.source_hint}</Pill>
      </div>
      <div
        style={{
          marginTop: 8,
          padding: "14px 16px",
          border: `1px dashed ${MESH.border}`,
          borderRadius: 6,
          fontSize: 12,
          color: MESH.fgDim,
          lineHeight: 1.6,
        }}
      >
        This ticket is in <b style={{ color: MESH.fg }}>Inbox</b>. Hand it off to
        Claude to classify, dispatch the multi-agent team, and draft a cross-repo
        plan.
      </div>
    </div>
  );
}

function PlanRendered({
  ticket,
  plan,
  planV2,
  isLegacy,
  flatSteps,
  reposTouched,
  adrsCited,
}: {
  ticket: TicketRecord;
  plan: SavedPlan;
  planV2: PlanV2 | null;
  isLegacy: boolean;
  flatSteps: UnifiedStep[];
  reposTouched: string[];
  adrsCited: string[];
}) {
  const invariantGroups = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const s of flatSteps) {
      for (const inv of s.invariants_respected) {
        if (inv === "no-invariant-applies") continue;
        if (!map.has(inv)) map.set(inv, new Set());
        map.get(inv)!.add(s.repo);
      }
    }
    return Array.from(map.entries()).map(([inv, repos]) => ({
      id: inv,
      repos: Array.from(repos),
    }));
  }, [flatSteps]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div
        className="font-mono"
        style={{
          fontSize: 10,
          letterSpacing: "0.14em",
          color: MESH.fgMute,
          textTransform: "uppercase",
        }}
      >
        {ticket.id} · plan
      </div>
      <div
        style={{
          fontSize: 24,
          lineHeight: "30px",
          fontWeight: 500,
          color: MESH.fg,
          letterSpacing: "-0.01em",
        }}
      >
        {plan.classification.summary || ticket.title}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          rowGap: 4,
          columnGap: 14,
          padding: "10px 14px",
          background: MESH.bgElev,
          border: `1px solid ${MESH.border}`,
          borderRadius: 5,
          fontSize: 11,
          lineHeight: 1.5,
        }}
        className="font-mono"
      >
        <span style={{ color: MESH.fgMute }}>BRANCH</span>
        <span style={{ color: MESH.fg }}>
          {plan.classification.target_branch}
        </span>
        <span style={{ color: MESH.fgMute }}>AUTHOR</span>
        <span style={{ color: MESH.fg }}>{ticket.author}</span>
        <span style={{ color: MESH.fgMute }}>OPENED</span>
        <span style={{ color: MESH.fgDim }}>
          {relDate(ticket.created_at)}
        </span>
      </div>

      <Section title="Context">
        <p
          style={{
            fontSize: 13,
            color: MESH.fgDim,
            lineHeight: 1.7,
            whiteSpace: "pre-wrap",
          }}
        >
          {ticket.description || ticket.title}
        </p>
        {ticket.description && (
          <blockquote
            style={{
              marginTop: 12,
              paddingLeft: 14,
              borderLeft: `2px solid ${MESH.amber}`,
              fontSize: 12,
              color: MESH.fgDim,
              fontStyle: "italic",
              lineHeight: 1.6,
            }}
          >
            {`“${truncateFirstLine(ticket.description, 220)}”`}
            <div
              className="font-mono"
              style={{ marginTop: 6, color: MESH.fgMute, fontStyle: "normal", fontSize: 10 }}
            >
              — {ticket.author} · {ticket.source_hint}
            </div>
          </blockquote>
        )}
      </Section>

      <Section title="Scope">
        <ul style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {reposTouched.map((r) => {
            const repoSteps = flatSteps.filter((s) => s.repo === r);
            const tagline = scopeTagline(repoSteps);
            return (
              <li
                key={r}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 10,
                  fontSize: 12,
                  color: MESH.fgDim,
                  lineHeight: 1.6,
                }}
              >
                <Dot color={MESH.fgMute} size={5} />
                <span className="font-mono" style={{ color: MESH.fg }}>
                  {r}
                </span>
                <span>{tagline}</span>
              </li>
            );
          })}
        </ul>
      </Section>

      {invariantGroups.length > 0 && (
        <Section title="Invariants">
          <ul style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {invariantGroups.map((g) => (
              <li
                key={g.id}
                style={{
                  padding: "8px 12px",
                  background: "rgba(48,164,108,0.04)",
                  border: `1px solid ${MESH.greenDim}`,
                  borderRadius: 5,
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                }}
              >
                <NavIcon kind="check" color={MESH.green} size={12} />
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <span
                    className="font-mono"
                    style={{ fontSize: 11, color: MESH.green }}
                  >
                    {g.id}
                  </span>
                  <span
                    className="font-mono"
                    style={{ fontSize: 10, color: MESH.fgMute }}
                  >
                    enforced across {g.repos.join(", ")}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {adrsCited.length > 0 && (
        <Section title="Decisions cited">
          <ul style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {adrsCited.map((a) => (
              <li
                key={a}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  fontSize: 12,
                  color: MESH.fgDim,
                }}
              >
                <Pill tone="amber">{a}</Pill>
                <span style={{ color: MESH.fgDim }}>
                  {describeADR(a, plan.classification.reasoning)}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {planV2 && (
        <>
          <SpecSection spec={planV2.spec} />
          <TestsSection plan={planV2} />
          <ImplementationSection plan={planV2} />
          <TraceabilitySection plan={planV2} />
        </>
      )}

      {isLegacy && (
        <Section title="Legacy plan">
          <div
            style={{
              padding: "10px 14px",
              border: `1px solid ${MESH.border}`,
              background: MESH.bgElev,
              borderRadius: 5,
              fontSize: 12,
              color: MESH.fgDim,
              lineHeight: 1.6,
            }}
          >
            This plan was generated with the legacy v1 brain (no spec, no
            tests). Re-run <span className="font-mono">build</span> to
            regenerate it as a v2 SDD/TDD plan.
          </div>
        </Section>
      )}

      {plan.plan.blast_radius && (
        <Section title="Blast radius">
          <p
            style={{
              fontSize: 12,
              color: MESH.fgDim,
              lineHeight: 1.7,
              padding: "10px 14px",
              background: MESH.bgElev,
              border: `1px solid ${MESH.border}`,
              borderRadius: 5,
            }}
          >
            {plan.plan.blast_radius}
          </p>
        </Section>
      )}

      {ticket.adjustments.length > 0 && (
        <Section title="Adjustments">
          <ul style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {ticket.adjustments.map((a, i) => (
              <li
                key={i}
                style={{
                  padding: "8px 12px",
                  background: MESH.bgElev,
                  border: `1px solid ${MESH.border}`,
                  borderRadius: 5,
                  fontSize: 11,
                  color: MESH.fgDim,
                  lineHeight: 1.5,
                  display: "flex",
                  flexDirection: "column",
                  gap: 3,
                }}
              >
                <span
                  className="font-mono"
                  style={{ color: MESH.fgMute, fontSize: 10 }}
                >
                  v{i + 1} · {relDate(a.at)}
                </span>
                <span>{a.instruction}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function SpecSection({ spec }: { spec: PlanV2["spec"] }) {
  const hasContent =
    spec.user_stories.length > 0 ||
    spec.acceptance_criteria.length > 0 ||
    spec.contracts.length > 0 ||
    spec.non_goals.length > 0;
  if (!hasContent && !spec.summary) return null;
  return (
    <Section title="Spec">
      {spec.summary && (
        <p style={{ fontSize: 13, color: MESH.fgDim, lineHeight: 1.7 }}>
          {spec.summary}
        </p>
      )}
      {spec.user_stories.length > 0 && (
        <ul
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            paddingLeft: 14,
          }}
        >
          {spec.user_stories.map((s, i) => (
            <li
              key={i}
              style={{
                fontSize: 12,
                color: MESH.fgDim,
                lineHeight: 1.6,
                listStyle: "disc",
              }}
            >
              {s}
            </li>
          ))}
        </ul>
      )}
      {spec.acceptance_criteria.length > 0 && (
        <ul style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {spec.acceptance_criteria.map((ac: AcceptanceCriterion) => (
            <li
              key={ac.id}
              style={{
                padding: "8px 12px",
                background: MESH.bg,
                border: `1px solid ${MESH.border}`,
                borderRadius: 5,
                fontSize: 12,
                color: MESH.fgDim,
                lineHeight: 1.55,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <Pill tone="amber">
                <span className="font-mono" style={{ fontSize: 10 }}>
                  {ac.id}
                </span>
              </Pill>
              <div>
                <span style={{ color: MESH.fgMute }} className="font-mono">
                  GIVEN
                </span>{" "}
                {ac.given}
                <br />
                <span style={{ color: MESH.fgMute }} className="font-mono">
                  WHEN
                </span>{" "}
                {ac.when}
                <br />
                <span style={{ color: MESH.fgMute }} className="font-mono">
                  THEN
                </span>{" "}
                {ac.then}
              </div>
            </li>
          ))}
        </ul>
      )}
      {spec.contracts.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span
            className="font-mono"
            style={{ fontSize: 10, color: MESH.fgMute, letterSpacing: "0.1em" }}
          >
            CONTRACTS
          </span>
          {spec.contracts.map((c: Contract) => (
            <div
              key={c.id}
              style={{
                padding: "6px 10px",
                background: MESH.bg,
                border: `1px solid ${MESH.border}`,
                borderRadius: 4,
                fontSize: 11,
                color: MESH.fgDim,
                lineHeight: 1.55,
              }}
            >
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <Pill tone="default">
                  <span className="font-mono" style={{ fontSize: 10 }}>
                    {c.id}
                  </span>
                </Pill>
                <Pill tone="dim">{c.kind}</Pill>
              </div>
              <div style={{ marginTop: 4 }}>{c.description}</div>
              {c.shape && (
                <pre
                  className="font-mono"
                  style={{
                    marginTop: 6,
                    padding: "6px 8px",
                    background: MESH.bgElev,
                    border: `1px solid ${MESH.border}`,
                    borderRadius: 4,
                    fontSize: 10,
                    whiteSpace: "pre-wrap",
                    color: MESH.fgDim,
                  }}
                >
                  {c.shape}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
      {spec.non_goals.length > 0 && (
        <div>
          <span
            className="font-mono"
            style={{
              fontSize: 10,
              color: MESH.fgMute,
              letterSpacing: "0.1em",
            }}
          >
            NON-GOALS
          </span>
          <ul
            style={{
              marginTop: 4,
              paddingLeft: 14,
              display: "flex",
              flexDirection: "column",
              gap: 3,
            }}
          >
            {spec.non_goals.map((n, i) => (
              <li
                key={i}
                style={{
                  fontSize: 11,
                  color: MESH.fgDim,
                  listStyle: "disc",
                  lineHeight: 1.5,
                }}
              >
                {n}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

function TestsSection({ plan }: { plan: PlanV2 }) {
  if (plan.tests.length === 0) return null;
  return (
    <Section title={`Tests (${plan.tests.length})`}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {plan.tests.map((t) => (
          <div
            key={t.test_id}
            style={{
              padding: "8px 12px",
              background: MESH.bg,
              border: `1px solid ${MESH.border}`,
              borderRadius: 5,
              fontSize: 11,
              color: MESH.fgDim,
              lineHeight: 1.55,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <Pill tone="amber">
                <span className="font-mono" style={{ fontSize: 10 }}>
                  {t.test_id}
                </span>
              </Pill>
              <Pill tone="dim">{t.test_kind}</Pill>
              <span
                className="font-mono"
                style={{ fontSize: 10, color: MESH.fgMute }}
              >
                {t.repo}:{t.file}
              </span>
              <span style={{ flex: 1 }} />
              <span
                className="font-mono"
                style={{
                  fontSize: 9,
                  color:
                    t.expected_initial_state === "fails"
                      ? MESH.amber
                      : MESH.fgMute,
                }}
              >
                {t.expected_initial_state}
              </span>
            </div>
            <div>{t.rationale}</div>
            {t.ac_ids.length > 0 && (
              <div
                style={{
                  display: "flex",
                  gap: 4,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <span
                  className="font-mono"
                  style={{
                    fontSize: 9,
                    color: MESH.fgMute,
                    letterSpacing: "0.14em",
                  }}
                >
                  VERIFIES
                </span>
                {t.ac_ids.map((id) => (
                  <Pill key={id} tone="green">
                    <span className="font-mono" style={{ fontSize: 10 }}>
                      {id}
                    </span>
                  </Pill>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}

function ImplementationSection({ plan }: { plan: PlanV2 }) {
  if (plan.implementation.length === 0) return null;
  return (
    <Section title={`Implementation (${plan.implementation.length})`}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {plan.implementation.map((i) => (
          <div
            key={i.impl_id}
            style={{
              padding: "8px 12px",
              background: MESH.bg,
              border: `1px solid ${MESH.border}`,
              borderRadius: 5,
              fontSize: 11,
              color: MESH.fgDim,
              lineHeight: 1.55,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <Pill tone="green">
                <span className="font-mono" style={{ fontSize: 10 }}>
                  {i.impl_id}
                </span>
              </Pill>
              <Pill tone="dim">{i.agent}</Pill>
              <span
                className="font-mono"
                style={{ fontSize: 10, color: MESH.fgMute }}
              >
                {i.repo}:{i.file}
              </span>
              <span style={{ flex: 1 }} />
              <span
                className="font-mono"
                style={{ fontSize: 9, color: MESH.fgMute }}
              >
                {i.action}
              </span>
            </div>
            <div>{i.rationale}</div>
            {i.test_ids.length > 0 && (
              <div
                style={{
                  display: "flex",
                  gap: 4,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <span
                  className="font-mono"
                  style={{
                    fontSize: 9,
                    color: MESH.fgMute,
                    letterSpacing: "0.14em",
                  }}
                >
                  TURNS GREEN
                </span>
                {i.test_ids.map((id) => (
                  <Pill key={id} tone="amber">
                    <span className="font-mono" style={{ fontSize: 10 }}>
                      {id}
                    </span>
                  </Pill>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}

function TraceabilitySection({ plan }: { plan: PlanV2 }) {
  const acRows = plan.spec.acceptance_criteria.map((ac) => {
    const tests = plan.traceability.ac_to_tests[ac.id] ?? [];
    const impls = Array.from(
      new Set(
        tests.flatMap((t) => plan.traceability.test_to_impl[t] ?? []),
      ),
    );
    return { ac, tests, impls };
  });
  if (acRows.length === 0) return null;
  return (
    <Section title="Traceability">
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {acRows.map(({ ac, tests, impls }) => {
          const broken = tests.length === 0;
          return (
            <div
              key={ac.id}
              style={{
                padding: "6px 10px",
                background: broken ? "rgba(229,72,77,0.06)" : MESH.bg,
                border: `1px solid ${broken ? MESH.redDim : MESH.border}`,
                borderRadius: 4,
                fontSize: 11,
                color: MESH.fgDim,
                display: "flex",
                gap: 8,
                alignItems: "center",
                flexWrap: "wrap",
              }}
              className="font-mono"
            >
              <Pill tone={broken ? "red" : "amber"}>{ac.id}</Pill>
              <span style={{ color: MESH.fgMute }}>→</span>
              {tests.length === 0 ? (
                <span style={{ color: MESH.red }}>(no tests)</span>
              ) : (
                tests.map((t) => (
                  <Pill key={t} tone="dim">
                    {t}
                  </Pill>
                ))
              )}
              {impls.length > 0 && (
                <>
                  <span style={{ color: MESH.fgMute }}>→</span>
                  {impls.map((i) => (
                    <Pill key={i} tone="green">
                      {i}
                    </Pill>
                  ))}
                </>
              )}
            </div>
          );
        })}
      </div>
    </Section>
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
    <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div
        className="font-mono"
        style={{
          fontSize: 10,
          letterSpacing: "0.14em",
          color: MESH.fgMute,
          textTransform: "uppercase",
        }}
      >
        ## {title}
      </div>
      {children}
    </section>
  );
}

function RepoSummaryPill({
  name,
  steps,
}: {
  name: string;
  steps: LiveStep[];
}) {
  const s = steps.length;
  const f = new Set(steps.map((x) => x.file)).size;
  return (
    <Pill tone="default">
      <Dot color={MESH.amber} size={5} />
      <span className="font-mono">
        {name}
        <span style={{ color: MESH.fgMute }}>
          {"  "}· {s}s · {f}f
        </span>
      </span>
    </Pill>
  );
}

function StepCard({
  number,
  repo,
  file,
  action,
  rationale,
  invariantsRespected,
  memoryCitations,
  unified,
  live,
}: {
  number: number;
  repo: string;
  file: string;
  action: "edit" | "create";
  rationale: string;
  invariantsRespected: string[];
  memoryCitations: string[];
  unified?: UnifiedStep;
  live?: LiveStep;
}) {
  const status = live?.status ?? "drafted";
  const { label, tone } = stepBadge(status);
  const adrs = invariantsRespected.filter((i) => /ADR-\d{3,}/.test(i));
  const invs = invariantsRespected.filter((i) => !/ADR-\d{3,}/.test(i));
  const citations = [...adrs, ...invs];

  const traceLabel = unified
    ? unified.kind === "test"
      ? unified.test_id
      : unified.impl_id
    : null;
  const traceTone: "amber" | "green" =
    unified?.kind === "test" ? "amber" : "green";
  const traceLinks =
    unified?.kind === "test"
      ? unified.ac_ids
      : unified?.kind === "impl"
        ? unified.test_ids
        : [];

  return (
    <div
      style={{
        padding: "12px 14px",
        background: MESH.bgElev,
        border: `1px solid ${status === "drafting" || status === "running" ? MESH.amber : MESH.border}`,
        borderRadius: 6,
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
          className="font-mono"
          style={{ fontSize: 10, color: MESH.fgMute }}
        >
          {String(number).padStart(2, "0")}
        </span>
        {traceLabel && (
          <Pill tone={traceTone}>
            <span className="font-mono" style={{ fontSize: 10 }}>
              {traceLabel}
            </span>
          </Pill>
        )}
        {unified?.kind === "test" && unified.test_kind && (
          <Pill tone="dim">{unified.test_kind}</Pill>
        )}
        {unified?.agent && unified.kind === "impl" && (
          <Pill tone="dim">{unified.agent}</Pill>
        )}
        <span
          style={{
            fontSize: 12,
            color: MESH.fg,
            fontWeight: 500,
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {truncateFirstLine(rationale, 60)}
        </span>
        <Pill tone={tone}>{label}</Pill>
      </div>
      {traceLinks && traceLinks.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap",
          }}
        >
          <span
            className="font-mono"
            style={{
              fontSize: 9,
              color: MESH.fgMute,
              textTransform: "uppercase",
              letterSpacing: "0.14em",
            }}
          >
            {unified?.kind === "test" ? "verifies" : "turns green"}
          </span>
          {traceLinks.map((id) => (
            <Pill
              key={id}
              tone={unified?.kind === "test" ? "green" : "amber"}
            >
              <span className="font-mono" style={{ fontSize: 10 }}>
                {id}
              </span>
            </Pill>
          ))}
        </div>
      )}
      <div
        style={{
          fontSize: 11,
          color: MESH.fgDim,
          lineHeight: 1.55,
        }}
      >
        {rationale}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 10px",
          background: MESH.bg,
          border: `1px solid ${MESH.border}`,
          borderRadius: 4,
          minWidth: 0,
        }}
      >
        <NavIcon kind="branch" color={MESH.fgDim} size={10} />
        <span
          className="font-mono"
          style={{ fontSize: 10, color: MESH.fgDim, whiteSpace: "nowrap" }}
        >
          {repo}
        </span>
        <span
          className="font-mono"
          style={{
            fontSize: 10,
            color: MESH.fgMute,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
            flex: 1,
          }}
        >
          {file}
        </span>
        <span
          className="font-mono"
          style={{ fontSize: 9, color: MESH.fgMute }}
        >
          {action}
        </span>
      </div>
      {(citations.length > 0 || memoryCitations.length > 0) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap",
          }}
        >
          <span
            className="font-mono"
            style={{
              fontSize: 9,
              color: MESH.fgMute,
              textTransform: "uppercase",
              letterSpacing: "0.14em",
            }}
          >
            cites
          </span>
          {adrs.map((a) => (
            <Pill key={`a-${a}`} tone="amber">
              {a}
            </Pill>
          ))}
          {invs.slice(0, 2).map((i) => (
            <Pill key={`i-${i}`} tone="green">
              {i}
            </Pill>
          ))}
        </div>
      )}
      {live?.intercept && (
        <div
          style={{
            padding: "8px 10px",
            background: "rgba(229,72,77,0.06)",
            border: `1px solid ${MESH.redDim}`,
            borderRadius: 4,
            fontSize: 10,
            color: MESH.red,
            lineHeight: 1.5,
          }}
          className="font-mono"
        >
          skill intercept · {live.intercept.title}
          <br />
          <span style={{ color: MESH.fgDim }}>{live.intercept.fix_hint}</span>
        </div>
      )}
      {live?.sha && (
        <div
          className="font-mono"
          style={{ fontSize: 10, color: MESH.green }}
        >
          ✓ committed · {live.sha.slice(0, 7)}
        </div>
      )}
    </div>
  );
}

function stepBadge(status: StepStatus): { label: string; tone: "amber" | "green" | "red" | "dim" | "default" } {
  switch (status) {
    case "drafting":
      return { label: "drafting", tone: "amber" };
    case "running":
      return { label: "running", tone: "amber" };
    case "committed":
      return { label: "committed", tone: "green" };
    case "failed":
      return { label: "failed", tone: "red" };
    case "drafted":
      return { label: "drafted", tone: "green" };
    case "queued":
    default:
      return { label: "queued", tone: "dim" };
  }
}

function applyShipEvent(
  ev: { type: string } & Record<string, unknown>,
  set: (fn: (s: ShipState) => ShipState) => void,
): void {
  switch (ev.type) {
    case "step-start":
      set((s) => ({
        ...s,
        steps: s.steps.map((st) =>
          st.step === ev.step ? { ...st, status: "running" } : st,
        ),
      }));
      break;
    case "thinking":
      set((s) => {
        const cur = s.thinkingByStep[ev.step as number] ?? "";
        return {
          ...s,
          thinkingByStep: {
            ...s.thinkingByStep,
            [ev.step as number]: cur + (ev.delta as string),
          },
        };
      });
      break;
    case "skill-intercept":
      set((s) => ({
        ...s,
        steps: s.steps.map((st) =>
          st.step === ev.step
            ? {
                ...st,
                intercept: {
                  title: ev.title as string,
                  fix_hint: ev.fix_hint as string,
                },
              }
            : st,
        ),
      }));
      break;
    case "skill-pass":
      set((s) => ({
        ...s,
        steps: s.steps.map((st) =>
          st.step === ev.step ? { ...st, intercept: null } : st,
        ),
      }));
      break;
    case "commit":
      set((s) => ({
        ...s,
        steps: s.steps.map((st) =>
          st.step === ev.step
            ? { ...st, status: "committed", sha: ev.sha as string }
            : st,
        ),
      }));
      break;
    case "step-done":
      set((s) => ({
        ...s,
        steps: s.steps.map((st) =>
          st.step === ev.step && st.status !== "committed"
            ? { ...st, status: "committed", attempts: ev.attempts as number }
            : st,
        ),
      }));
      break;
    case "pr-opened":
    case "done":
      // no-op; detail page polls for PR state
      break;
    case "error":
      if (typeof ev.step === "number") {
        set((s) => ({
          ...s,
          steps: s.steps.map((st) =>
            st.step === ev.step ? { ...st, status: "failed" } : st,
          ),
        }));
      }
      break;
  }
}

function relDate(iso: string): string {
  const delta = Date.now() - new Date(iso).getTime();
  const m = Math.floor(delta / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function truncateFirstLine(s: string, max: number): string {
  const firstLine = (s.split("\n")[0] ?? "").trim();
  if (firstLine.length <= max) return firstLine;
  return firstLine.slice(0, max - 1) + "…";
}

function scopeTagline(steps: { action: string; file: string }[]): string {
  const edits = steps.filter((s) => s.action === "edit").length;
  const creates = steps.filter((s) => s.action === "create").length;
  const parts: string[] = [];
  if (edits > 0) parts.push(`${edits} edit${edits > 1 ? "s" : ""}`);
  if (creates > 0) parts.push(`${creates} create${creates > 1 ? "s" : ""}`);
  return parts.join(" · ");
}

function describeADR(adr: string, reasoning: string): string {
  const idx = reasoning.indexOf(adr);
  if (idx < 0) return "";
  const after = reasoning.slice(idx + adr.length, idx + adr.length + 160);
  return after.replace(/^[:\s—-]*/, "").split(/[.\n]/)[0] ?? "";
}
