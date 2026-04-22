"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

type RepoStatus = {
  repoName: string;
  repoPath: string;
  currentBranch: string;
  branches: string[];
  changedFiles: number;
  clean: boolean;
  ahead: number;
  behind: number;
  error?: string;
};

type Classification = {
  type: "code_change" | "config" | "faq" | "issue_comment";
  repos_touched: string[];
  target_branch: string;
  confidence: number;
  summary: string;
  reasoning: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  engine_mode?: string;
};

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

type Plan = {
  plan: PlanStep[];
  sequencing: string[];
  blast_radius: string;
};

type PlanEvent =
  | { type: "thinking"; delta: string }
  | { type: "meta"; ttft_ms: number }
  | { type: "plan"; plan: Plan }
  | {
      type: "done";
      duration_ms: number;
      engine_mode: string;
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    }
  | { type: "error"; message: string };

type Stage = "idle" | "classifying" | "classified" | "planning" | "planned" | "proceeding" | "done";

const DEMO_TICKET =
  "For enterprise customers, the first payment should have a 20% discount, but only if they came from a referral. Make sure this does not affect renewals.";

export default function ConversePage() {
  const [ticket, setTicket] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [classification, setClassification] = useState<Classification | null>(null);
  const [thinking, setThinking] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [repos, setRepos] = useState<RepoStatus[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ttft, setTtft] = useState<number | null>(null);
  const [planDuration, setPlanDuration] = useState<number | null>(null);
  const [engineMode, setEngineMode] = useState<string | null>(null);
  const thinkingRef = useRef<HTMLPreElement>(null);

  const loadBranches = useCallback(async () => {
    try {
      const res = await fetch("/api/branches", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { repos: RepoStatus[] };
      setRepos(data.repos);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    loadBranches();
  }, [loadBranches]);

  useEffect(() => {
    if (thinkingRef.current) {
      thinkingRef.current.scrollTop = thinkingRef.current.scrollHeight;
    }
  }, [thinking]);

  const invariantsInPlan = useMemo(() => {
    if (!plan) return new Set<string>();
    const ids = new Set<string>();
    for (const s of plan.plan) for (const id of s.invariants_respected) ids.add(id);
    return ids;
  }, [plan]);

  async function classify() {
    if (!ticket.trim()) {
      setError("Write a ticket first.");
      return;
    }
    setStage("classifying");
    setError(null);
    setClassification(null);
    setPlan(null);
    setThinking("");
    setPlanDuration(null);
    setTtft(null);
    try {
      const res = await fetch("/api/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      setClassification(json as Classification);
      setEngineMode((json as Classification).engine_mode ?? null);
      setStage("classified");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage("idle");
    }
  }

  async function approveAndPlan() {
    if (!classification) return;
    setStage("planning");
    setThinking("");
    setPlan(null);
    setError(null);
    setTtft(null);

    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticket,
          repos_touched: classification.repos_touched,
          target_branch: classification.target_branch,
          classifier_reasoning: classification.reasoning,
        }),
      });
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${text || "no body"}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buffer.indexOf("\n\n")) !== -1) {
          const raw = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          for (const line of raw.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            try {
              const ev = JSON.parse(line.slice(6)) as PlanEvent;
              if (ev.type === "thinking") setThinking((t) => t + ev.delta);
              else if (ev.type === "meta") setTtft(ev.ttft_ms);
              else if (ev.type === "plan") setPlan(ev.plan);
              else if (ev.type === "done") {
                setPlanDuration(ev.duration_ms);
                setEngineMode(ev.engine_mode);
                setStage("planned");
              } else if (ev.type === "error") {
                setError(ev.message);
                setStage("classified");
              }
            } catch {
              // ignore malformed
            }
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage("classified");
    }
  }

  async function proceed() {
    if (!classification || !plan) return;
    setStage("proceeding");
    setError(null);
    try {
      const res = await fetch("/api/branches/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branch: classification.target_branch,
          repos: classification.repos_touched,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);

      // Persist plan so /ship can load it.
      await fetch("/api/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticket,
          classification: {
            type: classification.type,
            repos_touched: classification.repos_touched,
            target_branch: classification.target_branch,
            confidence: classification.confidence,
            summary: classification.summary,
            reasoning: classification.reasoning,
          },
          plan,
        }),
      }).catch(() => {
        // best-effort; Ship can still run from the most recent successful save.
      });

      await loadBranches();
      setStage("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage("planned");
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
          <h1 className="text-xl font-mono">converse</h1>
          <span className="text-xs font-mono text-muted-foreground">
            ticket in, plan out
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono text-muted-foreground">
          <span>
            stage: <span className="text-accent">{stage}</span>
          </span>
          {ttft !== null && <span>ttft: {ttft}ms</span>}
          {planDuration !== null && <span>plan: {planDuration}ms</span>}
          {engineMode && <span>via {engineMode}</span>}
        </div>
      </header>

      {error && (
        <div className="mx-6 mt-4 rounded-md border border-destructive bg-destructive/10 text-destructive p-3 font-mono text-xs">
          {error}
        </div>
      )}

      <section className="flex-1 grid grid-cols-[240px_1fr_320px] gap-0 min-h-0">
        <aside className="border-r border-border p-4 flex flex-col gap-3 overflow-auto">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
              Repos
            </h2>
            <button
              onClick={loadBranches}
              className="text-[10px] font-mono text-muted-foreground hover:text-accent"
            >
              refresh
            </button>
          </div>
          {repos.length === 0 ? (
            <p className="text-xs text-muted-foreground font-mono">
              no connected repos — run /connect
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {repos.map((r) => {
                const isTarget = classification?.repos_touched.includes(r.repoName);
                const onTargetBranch =
                  classification && r.currentBranch === classification.target_branch;
                return (
                  <li
                    key={r.repoName}
                    className={`rounded-md border px-3 py-2 transition-colors ${
                      isTarget
                        ? "border-accent/60 bg-accent/5"
                        : "border-border"
                    }`}
                  >
                    <div className="font-mono text-sm flex items-center justify-between gap-2">
                      <span className="truncate">{r.repoName}</span>
                      {isTarget && (
                        <span className="text-[9px] uppercase text-accent">
                          target
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <span
                        className={`text-[10px] font-mono truncate ${
                          onTargetBranch ? "text-accent" : "text-muted-foreground"
                        }`}
                        title={r.currentBranch}
                      >
                        {r.currentBranch}
                      </span>
                      <span
                        className={`text-[9px] uppercase font-mono ${
                          r.clean ? "text-muted-foreground" : "text-accent"
                        }`}
                      >
                        {r.clean
                          ? "clean"
                          : `${r.changedFiles} changes`}
                      </span>
                    </div>
                    <p className="text-[9px] font-mono text-muted-foreground mt-1">
                      {r.branches.length} branches
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <div className="flex flex-col min-h-0">
          <div className="p-4 border-b border-border flex gap-3 items-start">
            <textarea
              value={ticket}
              onChange={(e) => setTicket(e.target.value)}
              className="flex-1 min-h-[84px] max-h-[160px] bg-muted/50 text-foreground rounded-md border border-border p-3 font-mono text-xs focus:outline-none focus:border-accent"
              placeholder="Paste a ticket from Slack, or write what you want to change..."
              disabled={stage === "classifying" || stage === "planning" || stage === "proceeding"}
            />
            <div className="flex flex-col gap-2 w-[120px]">
              <button
                onClick={classify}
                disabled={stage === "classifying" || stage === "planning"}
                className="px-3 py-2 rounded-md border border-accent bg-accent text-accent-foreground font-mono text-xs hover:opacity-90 disabled:opacity-50"
              >
                {stage === "classifying" ? "classifying" : "classify"}
              </button>
              <button
                onClick={() => setTicket(DEMO_TICKET)}
                className="px-3 py-2 rounded-md border border-border text-[10px] font-mono text-muted-foreground hover:border-accent hover:text-accent"
              >
                use demo ticket
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between px-4 pt-3 pb-2">
            <h2 className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
              Thinking
            </h2>
            <span className="text-xs font-mono text-muted-foreground">
              {thinking.length.toLocaleString()} chars
            </span>
          </div>
          <pre
            ref={thinkingRef}
            className="flex-1 mx-4 mb-4 rounded-md border border-border bg-zinc-950 p-4 font-mono text-sm text-foreground/90 overflow-auto whitespace-pre-wrap break-words min-h-0"
          >
            {thinking || (
              <span className="text-muted-foreground">
                {stage === "idle" && "— paste a ticket, then classify —"}
                {stage === "classifying" && "— classifying —"}
                {stage === "classified" && classification
                  ? classifierSummary(classification)
                  : null}
                {stage === "planning" && "— waiting for first token —"}
                {stage === "proceeding" && "— creating branches —"}
                {stage === "done" && "— branches created. plan ready for Ship (Day 3). —"}
              </span>
            )}
          </pre>
        </div>

        <aside className="border-l border-border p-4 flex flex-col gap-3 overflow-auto min-h-0">
          {classification && (
            <div className="rounded-md border border-accent/40 bg-accent/5 p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-mono text-accent">
                  classification
                </span>
                <span className="text-[10px] font-mono text-muted-foreground">
                  {Math.round(classification.confidence * 100)}%
                </span>
              </div>
              <p className="text-xs">{classification.summary}</p>
              <div className="flex flex-wrap gap-1.5">
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-accent/50 text-accent">
                  {classification.type}
                </span>
                {classification.repos_touched.map((r) => (
                  <span
                    key={r}
                    className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-border text-muted-foreground"
                  >
                    {r}
                  </span>
                ))}
              </div>
              <p className="text-[10px] font-mono text-muted-foreground break-all">
                branch: {classification.target_branch}
              </p>
              {stage === "classified" && (
                <button
                  onClick={approveAndPlan}
                  className="mt-1 px-3 py-2 rounded-md border border-accent bg-accent text-accent-foreground font-mono text-xs hover:opacity-90"
                >
                  approve → plan
                </button>
              )}
            </div>
          )}

          {plan && (
            <div className="flex flex-col gap-2">
              <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
                Plan · {plan.plan.length} steps
              </h3>
              <ol className="flex flex-col gap-2">
                {plan.plan.map((s) => (
                  <li
                    key={s.step}
                    className="rounded-md border border-border p-2 flex flex-col gap-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs">
                        <span className="text-muted-foreground">#{s.step}</span>{" "}
                        <span className="text-accent">{s.repo}</span>
                      </span>
                      <span className="text-[9px] uppercase text-muted-foreground font-mono">
                        {s.action}
                      </span>
                    </div>
                    <p className="text-[11px] font-mono break-all">{s.file}</p>
                    <p className="text-xs text-foreground/80">{s.rationale}</p>
                    {s.invariants_respected.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {s.invariants_respected.map((id) => (
                          <span
                            key={id}
                            className="text-[9px] font-mono px-1 py-0.5 rounded bg-accent/10 text-accent"
                          >
                            {id}
                          </span>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ol>

              {invariantsInPlan.size > 0 && (
                <div className="mt-2 rounded-md border border-border p-2">
                  <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono mb-1">
                    Invariants respected
                  </h4>
                  <ul className="flex flex-col gap-0.5">
                    {[...invariantsInPlan].map((id) => (
                      <li
                        key={id}
                        className="text-[11px] font-mono text-foreground/80 flex items-center gap-2"
                      >
                        <span className="text-accent">[x]</span> {id}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {plan.blast_radius && (
                <div className="rounded-md border border-border p-2">
                  <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono mb-1">
                    Blast radius
                  </h4>
                  <p className="text-[11px] text-foreground/80">
                    {plan.blast_radius}
                  </p>
                </div>
              )}

              {stage === "planned" && (
                <button
                  onClick={proceed}
                  className="mt-1 px-3 py-2 rounded-md border border-accent bg-accent text-accent-foreground font-mono text-xs hover:opacity-90"
                >
                  proceed → create branches
                </button>
              )}
              {stage === "proceeding" && (
                <div className="text-xs font-mono text-accent">
                  creating branches...
                </div>
              )}
              {stage === "done" && (
                <div className="rounded-md border border-accent/50 bg-accent/10 p-2 text-[11px] font-mono text-accent">
                  branches created on {classification?.repos_touched.length} repos. Ship (Day 3) will execute.
                </div>
              )}
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}

function classifierSummary(c: Classification): string {
  return `[classified] ${c.type} · ${Math.round(
    c.confidence * 100,
  )}% confidence
repos: ${c.repos_touched.join(", ")}
branch: ${c.target_branch}

reasoning:
${c.reasoning}

approve to begin planning.`;
}
