"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type EngineMode = "raw" | "agent";

export default function SettingsPage() {
  const [mode, setMode] = useState<EngineMode>("raw");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [claudeCodeDetected, setClaudeCodeDetected] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/config", { cache: "no-store" });
        const json = (await res.json()) as {
          config?: { engineMode: EngineMode };
          claudeCodeDetected?: boolean;
        };
        if (json.config?.engineMode) setMode(json.config.engineMode);
        if (json.claudeCodeDetected) setClaudeCodeDetected(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  async function save(next: EngineMode) {
    setMode(next);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engineMode: next }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground p-6 flex flex-col gap-6 max-w-2xl mx-auto">
      <header className="flex items-baseline justify-between border-b border-border pb-4">
        <div className="flex items-baseline gap-3">
          <Link
            href="/"
            className="text-xs font-mono text-muted-foreground hover:text-accent"
          >
            mesh
          </Link>
          <span className="text-muted-foreground">/</span>
          <h1 className="text-xl font-mono">settings</h1>
        </div>
        <span className="text-xs font-mono text-muted-foreground">
          {loaded ? (saving ? "saving..." : savedAt ? "saved" : "ready") : "loading..."}
        </span>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
          Engine
        </h2>
        <p className="text-sm text-muted-foreground">
          Mesh runs prompts through one of two execution backends. The raw
          Anthropic SDK is the default — lower latency and direct access to
          prompt caching. The Claude Agent SDK adds skills and sessions, at a
          small overhead cost per call.
        </p>

        <div className="flex flex-col gap-2">
          <EngineOption
            value="raw"
            selected={mode === "raw"}
            title="Raw API key (recommended)"
            subtitle="Uses ANTHROPIC_API_KEY directly via @anthropic-ai/sdk."
            onSelect={() => save("raw")}
            disabled={!loaded || saving}
          />
          <EngineOption
            value="agent"
            selected={mode === "agent"}
            title="Claude Code"
            subtitle="Routes through @anthropic-ai/claude-agent-sdk (enables skills)."
            onSelect={() => save("agent")}
            disabled={!loaded || saving}
            hint={
              claudeCodeDetected
                ? "Claude Code detected — toggle available"
                : undefined
            }
          />
        </div>

        {error && (
          <div className="rounded-md border border-destructive bg-destructive/10 text-destructive p-3 font-mono text-xs">
            {error}
          </div>
        )}
      </section>
    </main>
  );
}

function EngineOption({
  selected,
  title,
  subtitle,
  onSelect,
  disabled,
  hint,
}: {
  value: EngineMode;
  selected: boolean;
  title: string;
  subtitle: string;
  onSelect: () => void;
  disabled: boolean;
  hint?: string;
}) {
  return (
    <button
      onClick={onSelect}
      disabled={disabled}
      className={`text-left rounded-md border px-4 py-3 transition-colors ${
        selected
          ? "border-accent bg-accent/10"
          : "border-border hover:border-accent/60"
      } disabled:opacity-50`}
    >
      <div className="flex items-center justify-between">
        <span
          className={`font-mono text-sm ${selected ? "text-accent" : "text-foreground"}`}
        >
          {title}
        </span>
        {hint && (
          <span className="text-xs font-mono text-accent/80 bg-accent/10 px-2 py-0.5 rounded">
            {hint}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
    </button>
  );
}
