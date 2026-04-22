"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

type Status = "idle" | "ingesting" | "streaming" | "done" | "error";

type RepoState = {
  name: string;
  files?: number;
  tokens_est?: number;
  status: "idle" | "analyzing" | "ready";
};

type Evidence = { repo: string; path: string; line: number };

type InvariantView = {
  id: string;
  statement: string;
  evidence: Evidence[];
};

type MemoryView = {
  repos: {
    name: string;
    symbol_count: number;
    invariants: InvariantView[];
  }[];
  cross_repo_flows: {
    id: string;
    name: string;
    repos: string[];
  }[];
  invariants: InvariantView[];
  meta?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    duration_ms?: number;
  };
};

type ServerEvent =
  | { type: "ingest-start"; paths: string[] }
  | {
      type: "ingest-done";
      totalTokens: number;
      degraded: boolean;
      repos: { name: string; files: number; tokens_est: number }[];
    }
  | { type: "repo-ready"; name: string }
  | { type: "thinking"; delta: string }
  | { type: "text"; delta: string }
  | { type: "meta"; ttft_ms: number }
  | { type: "memory"; memory: MemoryView }
  | { type: "retry"; attempt: number; reason: string }
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

export default function ConnectPage() {
  const [pathsText, setPathsText] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [repos, setRepos] = useState<RepoState[]>([]);
  const [thinking, setThinking] = useState("");
  const [ttft, setTtft] = useState<number | null>(null);
  const [ingestTokens, setIngestTokens] = useState<number | null>(null);
  const [degraded, setDegraded] = useState(false);
  const [memory, setMemory] = useState<MemoryView | null>(null);
  const [retries, setRetries] = useState<{ attempt: number; reason: string }[]>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [cacheCreate, setCacheCreate] = useState<number | null>(null);
  const [cacheRead, setCacheRead] = useState<number | null>(null);
  const thinkingRef = useRef<HTMLPreElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (thinkingRef.current) {
      thinkingRef.current.scrollTop = thinkingRef.current.scrollHeight;
    }
  }, [thinking]);

  const invariantCount = useMemo(() => {
    if (!memory) return 0;
    return memory.invariants.length;
  }, [memory]);

  const parsedPaths = useMemo(
    () =>
      pathsText
        .split("\n")
        .map((p) => p.trim())
        .filter((p) => p.length > 0),
    [pathsText],
  );

  async function run() {
    if (status === "streaming" || status === "ingesting") {
      abortRef.current?.abort();
      return;
    }
    if (parsedPaths.length === 0) {
      setError("Enter at least one repo path (one per line).");
      return;
    }

    setStatus("ingesting");
    setRepos([]);
    setThinking("");
    setTtft(null);
    setIngestTokens(null);
    setDegraded(false);
    setMemory(null);
    setRetries([]);
    setError(null);
    setDuration(null);
    setCacheCreate(null);
    setCacheRead(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths: parsedPaths }),
        signal: controller.signal,
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
            const payload = line.slice(6);
            try {
              const ev = JSON.parse(payload) as ServerEvent;
              handleEvent(ev);
            } catch {
              // ignore malformed
            }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setStatus("idle");
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }

  function handleEvent(ev: ServerEvent) {
    switch (ev.type) {
      case "ingest-start":
        setRepos(
          ev.paths.map((p) => ({
            name: basename(p),
            status: "idle",
          })),
        );
        break;
      case "ingest-done":
        setIngestTokens(ev.totalTokens);
        setDegraded(ev.degraded);
        setRepos(
          ev.repos.map((r) => ({
            name: r.name,
            files: r.files,
            tokens_est: Math.round(r.tokens_est),
            status: "analyzing",
          })),
        );
        setStatus("streaming");
        break;
      case "repo-ready":
        setRepos((prev) =>
          prev.map((r) =>
            r.name === ev.name ? { ...r, status: "ready" } : r,
          ),
        );
        break;
      case "thinking":
        setThinking((t) => t + ev.delta);
        break;
      case "text":
        // The model is instructed to emit JSON only after </thinking>. We
        // don't display this in the UI — the parsed memory arrives via the
        // "memory" event once the JSON completes.
        break;
      case "meta":
        setTtft(ev.ttft_ms);
        break;
      case "memory":
        setMemory(ev.memory);
        break;
      case "retry":
        setRetries((r) => [...r, { attempt: ev.attempt, reason: ev.reason }]);
        break;
      case "done":
        setStatus("done");
        setDuration(ev.duration_ms);
        setCacheCreate(ev.cache_creation_input_tokens ?? null);
        setCacheRead(ev.cache_read_input_tokens ?? null);
        setRepos((prev) => prev.map((r) => ({ ...r, status: "ready" })));
        break;
      case "error":
        setStatus("error");
        setError(ev.message);
        break;
    }
  }

  const isRunning = status === "ingesting" || status === "streaming";

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
          <h1 className="text-xl font-mono">connect</h1>
          <span className="text-xs font-mono text-muted-foreground">
            cross-repo memory builder
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono text-muted-foreground">
          <span>
            status:{" "}
            <span
              className={
                isRunning
                  ? "text-accent"
                  : status === "done"
                    ? "text-foreground"
                    : status === "error"
                      ? "text-destructive"
                      : ""
              }
            >
              {status}
            </span>
          </span>
          {ttft !== null && <span>ttft: {ttft}ms</span>}
          {duration !== null && <span>total: {duration}ms</span>}
        </div>
      </header>

      <section className="px-6 py-4 border-b border-border flex gap-3 items-start">
        <textarea
          value={pathsText}
          onChange={(e) => setPathsText(e.target.value)}
          className="flex-1 min-h-[80px] max-h-[160px] bg-muted/50 text-foreground rounded-md border border-border p-3 font-mono text-xs focus:outline-none focus:border-accent"
          placeholder="One absolute repo path per line. e.g.&#10;/Users/you/code/flarebill-api&#10;/Users/you/code/flarebill-web"
          disabled={isRunning}
        />
        <button
          onClick={run}
          className="px-4 py-2 rounded-md border border-accent bg-accent text-accent-foreground font-mono text-sm hover:opacity-90 transition-opacity"
        >
          {isRunning ? "abort" : "connect repos"}
        </button>
      </section>

      {error && (
        <div className="mx-6 mt-4 rounded-md border border-destructive bg-destructive/10 text-destructive p-3 font-mono text-xs">
          {error}
        </div>
      )}

      <section className="flex-1 grid grid-cols-[220px_1fr_300px] gap-0 min-h-0">
        <aside className="border-r border-border p-4 flex flex-col gap-3 overflow-auto">
          <h2 className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
            Repos
          </h2>
          {repos.length === 0 ? (
            <p className="text-xs text-muted-foreground font-mono">
              add paths above
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {repos.map((r) => (
                <li
                  key={r.name}
                  className={`rounded-md border px-3 py-2 transition-colors ${
                    r.status === "ready"
                      ? "border-accent/50 bg-accent/5"
                      : r.status === "analyzing"
                        ? "border-accent/30 animate-pulse"
                        : "border-border"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm">{r.name}</span>
                    <span
                      className={`text-[10px] uppercase font-mono ${
                        r.status === "ready"
                          ? "text-accent"
                          : r.status === "analyzing"
                            ? "text-accent/70"
                            : "text-muted-foreground"
                      }`}
                    >
                      {r.status}
                    </span>
                  </div>
                  {r.files !== undefined && (
                    <p className="text-[10px] text-muted-foreground font-mono mt-1">
                      {r.files} files · ~{Math.round((r.tokens_est ?? 0) / 1000)}k tok
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          {ingestTokens !== null && (
            <div className="text-[10px] font-mono text-muted-foreground mt-2">
              ingest total: ~{Math.round(ingestTokens / 1000)}k tok
              {degraded && (
                <div className="text-accent mt-1">
                  degraded: priority exts only
                </div>
              )}
            </div>
          )}
        </aside>

        <div className="flex flex-col min-h-0">
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <h2 className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
              Thinking
            </h2>
            <span className="text-xs font-mono text-muted-foreground">
              {thinking.length.toLocaleString()} chars
            </span>
          </div>
          <pre
            ref={thinkingRef}
            className="flex-1 mx-4 mb-4 rounded-md border border-border bg-zinc-950 p-4 font-mono text-sm text-foreground/90 overflow-auto whitespace-pre-wrap break-words"
          >
            {thinking || (
              <span className="text-muted-foreground">
                {status === "idle"
                  ? "— awaiting repos —"
                  : status === "ingesting"
                    ? "— ingesting files —"
                    : "— waiting for first token —"}
              </span>
            )}
          </pre>
        </div>

        <aside className="border-l border-border p-4 flex flex-col gap-3 overflow-auto">
          <h2 className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
            Memory
          </h2>
          <div className="grid grid-cols-2 gap-2 text-xs font-mono">
            <Stat label="invariants" value={invariantCount} />
            <Stat
              label="flows"
              value={memory?.cross_repo_flows.length ?? 0}
            />
            <Stat label="repos" value={memory?.repos.length ?? 0} />
            <Stat
              label="cache hit"
              value={cacheRead ?? 0}
              format="tokens"
            />
          </div>
          {cacheCreate !== null && cacheCreate > 0 && (
            <p className="text-[10px] text-muted-foreground font-mono">
              cache created: {cacheCreate.toLocaleString()} tokens — subsequent
              Converse / Ship calls will read from cache.
            </p>
          )}

          {retries.length > 0 && (
            <div className="rounded-md border border-accent/40 bg-accent/5 p-2 text-[10px] font-mono">
              <div className="text-accent">
                {retries.length} retry{retries.length > 1 ? "ies" : ""}
              </div>
              {retries.map((r) => (
                <div key={r.attempt} className="text-muted-foreground">
                  #{r.attempt}: {r.reason.slice(0, 120)}
                </div>
              ))}
            </div>
          )}

          {memory && memory.invariants.length > 0 && (
            <div className="flex flex-col gap-2 mt-2">
              <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
                Invariants
              </h3>
              {memory.invariants.map((inv) => (
                <div
                  key={inv.id}
                  className="rounded-md border border-border p-2 flex flex-col gap-1"
                >
                  <span className="font-mono text-xs text-accent">
                    {inv.id}
                  </span>
                  <p className="text-xs">{inv.statement}</p>
                  <p className="text-[10px] font-mono text-muted-foreground">
                    {inv.evidence.length} evidence
                  </p>
                </div>
              ))}
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}

function Stat({
  label,
  value,
  format,
}: {
  label: string;
  value: number;
  format?: "tokens";
}) {
  const display =
    format === "tokens" && value > 1000
      ? `${Math.round(value / 1000)}k`
      : value.toLocaleString();
  return (
    <div className="rounded-md border border-border px-2 py-1.5">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="font-mono text-sm text-foreground">{display}</div>
    </div>
  );
}

function basename(p: string): string {
  const parts = p.replace(/\/$/, "").split("/");
  return parts[parts.length - 1] || p;
}
