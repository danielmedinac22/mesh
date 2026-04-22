"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

type PlanStep = {
  step: number;
  repo: string;
  file: string;
  action: "edit" | "create";
  rationale: string;
  invariants_respected: string[];
  memory_citations: string[];
  target_branch: string;
};

type SavedPlan = {
  id: string;
  created_at: string;
  ticket: string;
  classification: {
    type: string;
    repos_touched: string[];
    target_branch: string;
    confidence: number;
    summary: string;
    reasoning: string;
  };
  plan: {
    plan: PlanStep[];
    sequencing: string[];
    blast_radius: string;
  };
};

type ShipEvent =
  | {
      type: "session-start";
      session_id: string;
      plan_id: string;
      branch: string;
      repos: string[];
      steps: number;
    }
  | { type: "step-start"; step: number; repo: string; file: string; action: string }
  | { type: "thinking"; step: number; delta: string }
  | { type: "draft-ready"; step: number; attempt: number; lines: number }
  | {
      type: "skill-intercept";
      step: number;
      attempt: number;
      skill_id: string;
      title: string;
      message: string;
      fix_hint: string;
    }
  | { type: "skill-pass"; step: number; attempt: number }
  | { type: "commit"; step: number; repo: string; sha: string; message: string }
  | { type: "step-done"; step: number; attempts: number }
  | {
      type: "pr-opened";
      repo: string;
      url: string;
      simulated: boolean;
      pushed: boolean;
      number?: number;
      push_reason?: string;
    }
  | { type: "done"; session_id: string; duration_ms: number }
  | { type: "error"; message: string; step?: number };

type StepView = {
  step: number;
  repo: string;
  file: string;
  action: string;
  status: "pending" | "running" | "intercepted" | "committed" | "failed";
  attempts: number;
  thinking: string;
  interceptions: {
    skill_id: string;
    title: string;
    message: string;
    fix_hint: string;
    resolved: boolean;
  }[];
  commit_sha?: string;
  commit_message?: string;
  error?: string;
};

type PrView = {
  repo: string;
  url: string;
  simulated: boolean;
  pushed: boolean;
  number?: number;
  push_reason?: string;
};

export default function ShipPage() {
  const [plans, setPlans] = useState<SavedPlan[]>([]);
  const [planId, setPlanId] = useState<string>("");
  const [steps, setSteps] = useState<StepView[]>([]);
  const [prs, setPrs] = useState<PrView[]>([]);
  const [running, setRunning] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forceSim, setForceSim] = useState(false);
  const [demoLoosen, setDemoLoosen] = useState(true);
  const [focusedStep, setFocusedStep] = useState<number | null>(null);
  const thinkingRef = useRef<HTMLPreElement>(null);

  const loadPlans = useCallback(async () => {
    try {
      const res = await fetch("/api/plans", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { plans: SavedPlan[] };
      setPlans(data.plans);
      if (!planId && data.plans[0]) setPlanId(data.plans[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [planId]);

  useEffect(() => {
    loadPlans();
  }, [loadPlans]);

  const activePlan = useMemo(
    () => plans.find((p) => p.id === planId) ?? null,
    [plans, planId],
  );

  useEffect(() => {
    if (thinkingRef.current) {
      thinkingRef.current.scrollTop = thinkingRef.current.scrollHeight;
    }
  }, [steps, focusedStep]);

  const focusedStepData = useMemo(() => {
    if (focusedStep === null) return null;
    return steps.find((s) => s.step === focusedStep) ?? null;
  }, [steps, focusedStep]);

  async function run() {
    if (!activePlan) return;
    setRunning(true);
    setError(null);
    setDuration(null);
    setPrs([]);
    setSteps(
      activePlan.plan.plan.map((s) => ({
        step: s.step,
        repo: s.repo,
        file: s.file,
        action: s.action,
        status: "pending" as const,
        attempts: 0,
        thinking: "",
        interceptions: [],
      })),
    );
    setFocusedStep(activePlan.plan.plan[0]?.step ?? null);

    try {
      const res = await fetch("/api/ship", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan_id: activePlan.id,
          force_simulated_prs: forceSim,
          demo_loosen_first_attempt: demoLoosen,
        }),
      });
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${text || "no body"}`);
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
          const raw = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          for (const line of raw.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            try {
              const ev = JSON.parse(line.slice(6)) as ShipEvent;
              handle(ev);
            } catch {
              // ignore malformed
            }
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  function handle(ev: ShipEvent) {
    setSteps((prev) => {
      if (ev.type === "step-start") {
        setFocusedStep(ev.step);
        return prev.map((s) =>
          s.step === ev.step ? { ...s, status: "running" } : s,
        );
      }
      if (ev.type === "thinking") {
        return prev.map((s) =>
          s.step === ev.step ? { ...s, thinking: s.thinking + ev.delta } : s,
        );
      }
      if (ev.type === "skill-intercept") {
        return prev.map((s) =>
          s.step === ev.step
            ? {
                ...s,
                status: "intercepted",
                interceptions: [
                  ...s.interceptions,
                  {
                    skill_id: ev.skill_id,
                    title: ev.title,
                    message: ev.message,
                    fix_hint: ev.fix_hint,
                    resolved: false,
                  },
                ],
              }
            : s,
        );
      }
      if (ev.type === "skill-pass") {
        return prev.map((s) =>
          s.step === ev.step
            ? {
                ...s,
                interceptions: s.interceptions.map((i) => ({
                  ...i,
                  resolved: true,
                })),
              }
            : s,
        );
      }
      if (ev.type === "commit") {
        return prev.map((s) =>
          s.step === ev.step
            ? {
                ...s,
                status: "committed",
                commit_sha: ev.sha,
                commit_message: ev.message,
              }
            : s,
        );
      }
      if (ev.type === "step-done") {
        return prev.map((s) =>
          s.step === ev.step ? { ...s, attempts: ev.attempts } : s,
        );
      }
      if (ev.type === "error" && ev.step) {
        return prev.map((s) =>
          s.step === ev.step ? { ...s, status: "failed", error: ev.message } : s,
        );
      }
      return prev;
    });

    if (ev.type === "pr-opened") {
      setPrs((p) => [
        ...p,
        {
          repo: ev.repo,
          url: ev.url,
          simulated: ev.simulated,
          pushed: ev.pushed,
          number: ev.number,
          push_reason: ev.push_reason,
        },
      ]);
    } else if (ev.type === "done") {
      setDuration(ev.duration_ms);
    } else if (ev.type === "error" && !ev.step) {
      setError(ev.message);
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="flex items-baseline justify-between gap-4 border-b border-border px-6 py-4">
        <div className="flex items-baseline gap-3">
          <Link
            href="/"
            className="text-xs font-mono text-muted-foreground hover:text-accent"
          >
            mesh
          </Link>
          <span className="text-muted-foreground">/</span>
          <h1 className="text-xl font-mono">ship</h1>
          <span className="text-xs font-mono text-muted-foreground">
            plan → commits → PRs
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono text-muted-foreground">
          {duration !== null && <span>duration: {duration}ms</span>}
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={demoLoosen}
              onChange={(e) => setDemoLoosen(e.target.checked)}
            />
            loosen 1st attempt
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={forceSim}
              onChange={(e) => setForceSim(e.target.checked)}
            />
            simulated PRs
          </label>
        </div>
      </header>

      {error && (
        <div className="mx-6 mt-4 rounded-md border border-destructive bg-destructive/10 text-destructive p-3 font-mono text-xs">
          {error}
        </div>
      )}

      <section className="px-6 py-3 border-b border-border flex gap-3 items-center">
        <select
          value={planId}
          onChange={(e) => setPlanId(e.target.value)}
          disabled={running}
          className="flex-1 bg-muted/50 rounded-md border border-border p-2 font-mono text-xs"
        >
          {plans.length === 0 ? (
            <option value="">no plans — approve one in /converse</option>
          ) : (
            plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.classification.target_branch} · {p.classification.summary.slice(0, 60)}
              </option>
            ))
          )}
        </select>
        <button
          onClick={run}
          disabled={running || !activePlan}
          className="px-4 py-2 rounded-md border border-accent bg-accent text-accent-foreground font-mono text-xs hover:opacity-90 disabled:opacity-50"
        >
          {running ? "shipping" : "ship this plan"}
        </button>
        <button
          onClick={loadPlans}
          className="px-3 py-2 rounded-md border border-border text-[10px] font-mono text-muted-foreground hover:border-accent hover:text-accent"
        >
          refresh plans
        </button>
      </section>

      <section className="flex-1 grid grid-cols-[260px_1fr_300px] gap-0 min-h-0">
        <aside className="border-r border-border p-4 flex flex-col gap-3 overflow-auto">
          <h2 className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
            Steps
          </h2>
          {steps.length === 0 ? (
            <p className="text-xs text-muted-foreground font-mono">
              click ship to begin
            </p>
          ) : (
            <ol className="flex flex-col gap-2">
              {steps.map((s) => (
                <li key={s.step}>
                  <button
                    onClick={() => setFocusedStep(s.step)}
                    className={`w-full text-left rounded-md border px-2 py-1.5 transition-colors ${
                      focusedStep === s.step
                        ? "border-accent bg-accent/10"
                        : s.status === "intercepted"
                          ? "border-accent/70 bg-accent/5"
                          : s.status === "committed"
                            ? "border-foreground/40"
                            : s.status === "failed"
                              ? "border-destructive"
                              : "border-border"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs truncate">
                        <span className="text-muted-foreground">#{s.step}</span>{" "}
                        <span className="text-accent">{s.repo}</span>
                      </span>
                      <span
                        className={`text-[9px] uppercase font-mono ${
                          s.status === "committed"
                            ? "text-foreground/60"
                            : s.status === "intercepted"
                              ? "text-accent"
                              : s.status === "failed"
                                ? "text-destructive"
                                : s.status === "running"
                                  ? "text-accent"
                                  : "text-muted-foreground"
                        }`}
                      >
                        {s.status}
                      </span>
                    </div>
                    <p className="text-[10px] font-mono text-muted-foreground truncate">
                      {s.file}
                    </p>
                    {s.interceptions.length > 0 && (
                      <p className="text-[9px] font-mono text-accent mt-1">
                        {s.interceptions.length} skill fire
                        {s.interceptions.length > 1 ? "s" : ""}
                        {s.interceptions.every((i) => i.resolved)
                          ? " (resolved)"
                          : ""}
                      </p>
                    )}
                  </button>
                </li>
              ))}
            </ol>
          )}
        </aside>

        <div className="flex flex-col min-h-0">
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <h2 className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
              Thinking
              {focusedStepData && (
                <span className="ml-2 text-[10px] normal-case tracking-normal text-muted-foreground">
                  step {focusedStepData.step} · {focusedStepData.repo}:
                  {focusedStepData.file}
                </span>
              )}
            </h2>
            <span className="text-xs font-mono text-muted-foreground">
              {focusedStepData?.thinking.length.toLocaleString() ?? 0} chars
            </span>
          </div>
          <pre
            ref={thinkingRef}
            className="flex-1 mx-4 mb-4 rounded-md border border-border bg-zinc-950 p-4 font-mono text-sm text-foreground/90 overflow-auto whitespace-pre-wrap break-words min-h-0"
          >
            {focusedStepData?.thinking || (
              <span className="text-muted-foreground">
                {running
                  ? "— waiting for first token —"
                  : "— pick a step to watch its reasoning —"}
              </span>
            )}
          </pre>

          {focusedStepData?.interceptions.map((i, idx) => (
            <div
              key={`${focusedStepData.step}-${idx}`}
              className={`mx-4 mb-3 rounded-md border p-3 ${
                i.resolved
                  ? "border-foreground/30 bg-muted/30"
                  : "border-accent bg-accent/10"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-mono text-accent">
                  skill fired · {i.skill_id}
                </span>
                <span className="text-[10px] uppercase font-mono text-muted-foreground">
                  {i.resolved ? "resolved" : "active"}
                </span>
              </div>
              <p className="text-xs mt-1">{i.message}</p>
              <p className="text-[11px] text-muted-foreground mt-1">
                fix: {i.fix_hint}
              </p>
            </div>
          ))}
        </div>

        <aside className="border-l border-border p-4 flex flex-col gap-3 overflow-auto">
          <h2 className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
            Pull Requests
          </h2>
          {prs.length === 0 ? (
            <p className="text-xs text-muted-foreground font-mono">
              PRs open after all steps commit
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {prs.map((pr) => (
                <li
                  key={pr.url}
                  className="rounded-md border border-border p-3 flex flex-col gap-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs text-accent">
                      {pr.repo}
                    </span>
                    <span
                      className={`text-[9px] uppercase font-mono ${
                        pr.simulated
                          ? "text-muted-foreground"
                          : "text-foreground"
                      }`}
                    >
                      {pr.simulated ? "simulated" : "live"}
                      {pr.number !== undefined && ` · #${pr.number}`}
                    </span>
                  </div>
                  <a
                    href={pr.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] font-mono break-all hover:text-accent"
                  >
                    {pr.url}
                  </a>
                  <p className="text-[10px] text-muted-foreground">
                    {pr.pushed ? "pushed to remote" : "local commits only"}
                    {pr.push_reason ? ` · ${pr.push_reason}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}

          <h2 className="text-xs font-mono uppercase tracking-wider text-muted-foreground mt-4">
            Build status
          </h2>
          <ul className="flex flex-col gap-1">
            {(activePlan?.classification.repos_touched ?? []).map((r) => {
              const hasCommit = steps.some(
                (s) => s.repo === r && s.status === "committed",
              );
              return (
                <li
                  key={r}
                  className="rounded-md border border-border px-2 py-1 flex items-center justify-between"
                >
                  <span className="text-xs font-mono">{r}</span>
                  <span
                    className={`text-[9px] uppercase font-mono ${
                      hasCommit ? "text-foreground/80" : "text-muted-foreground"
                    }`}
                  >
                    {hasCommit ? "built" : "idle"}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="text-[10px] font-mono text-muted-foreground">
            preview reserved for flarebill-web — see ROADMAP Day 3 scope-cut.
          </p>
        </aside>
      </section>
    </main>
  );
}
