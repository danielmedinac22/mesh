"use client";

import { useEffect, useState } from "react";
import { AppShell, MESH, Pill } from "@/components/mesh";

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

  const statusLabel = !loaded ? "loading…" : saving ? "saving…" : savedAt ? "saved" : "ready";
  const statusTone: "amber" | "green" | "dim" = saving
    ? "amber"
    : savedAt
      ? "green"
      : "dim";

  return (
    <AppShell
      title="Settings"
      subtitle="engine, workspace, env"
      topRight={<Pill tone={statusTone}>{statusLabel}</Pill>}
    >
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "32px 32px 48px",
          maxWidth: 760,
          width: "100%",
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: 32,
        }}
      >
        {error && (
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
            {error}
          </div>
        )}

        <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <h2
              style={{
                fontSize: 18,
                fontWeight: 600,
                letterSpacing: "-0.02em",
                margin: 0,
                color: MESH.fg,
              }}
            >
              Engine
            </h2>
            <span
              className="font-mono"
              style={{
                fontSize: 11,
                color: MESH.fgMute,
                textTransform: "uppercase",
                letterSpacing: "0.14em",
              }}
            >
              execution backend
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
            Mesh runs prompts through one of two execution backends. The raw Anthropic SDK is the
            default — lower latency and direct access to prompt caching. The Claude Agent SDK adds
            skills and sessions, at a small overhead cost per call.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <OptionCard
              selected={mode === "raw"}
              title="Raw API key"
              caption="Uses ANTHROPIC_API_KEY directly via @anthropic-ai/sdk. Recommended for demo latency."
              onSelect={() => save("raw")}
              disabled={!loaded || saving}
              badge={<Pill tone="dim">default</Pill>}
            >
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Pill tone="dim">ANTHROPIC_API_KEY</Pill>
                <Pill tone="dim">@anthropic-ai/sdk</Pill>
                <Pill tone="amber">prompt caching</Pill>
              </div>
            </OptionCard>

            <OptionCard
              selected={mode === "agent"}
              title="Claude Code agent"
              caption="Routes through @anthropic-ai/claude-agent-sdk. Enables skills and sessions at slight overhead."
              onSelect={() => save("agent")}
              disabled={!loaded || saving}
              badge={
                claudeCodeDetected ? (
                  <Pill tone="green">detected</Pill>
                ) : (
                  <Pill tone="dim">not detected</Pill>
                )
              }
            >
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Pill tone="dim">@anthropic-ai/claude-agent-sdk</Pill>
                <Pill tone="amber">skills</Pill>
                <Pill tone="amber">sub-agents</Pill>
              </div>
            </OptionCard>
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function OptionCard({
  selected,
  title,
  caption,
  onSelect,
  disabled,
  children,
  badge,
}: {
  selected: boolean;
  title: string;
  caption: string;
  onSelect: () => void;
  disabled: boolean;
  children?: React.ReactNode;
  badge?: React.ReactNode;
}) {
  return (
    <button
      onClick={onSelect}
      disabled={disabled}
      style={{
        textAlign: "left",
        padding: "18px 20px",
        borderRadius: 8,
        border: `1px solid ${selected ? "rgba(245,165,36,0.35)" : MESH.border}`,
        background: selected ? "rgba(245,165,36,0.04)" : MESH.bgElev,
        boxShadow: selected ? "0 0 0 1px rgba(245,165,36,0.08)" : "none",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.6 : 1,
        transition: "border-color 150ms, background 150ms",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span
          aria-hidden
          style={{
            width: 20,
            height: 20,
            borderRadius: 999,
            border: `1.5px solid ${selected ? MESH.amber : MESH.borderHi}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            boxShadow: selected ? `0 0 6px ${MESH.amber}` : "none",
          }}
        >
          {selected && (
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                background: MESH.amber,
              }}
            />
          )}
        </span>
        <span
          style={{
            fontSize: 16,
            fontWeight: 600,
            letterSpacing: "-0.01em",
            color: MESH.fg,
          }}
        >
          {title}
        </span>
        {badge && <span style={{ marginLeft: "auto" }}>{badge}</span>}
      </div>
      <p
        style={{
          fontSize: 12.5,
          color: MESH.fgDim,
          lineHeight: 1.55,
          margin: 0,
          paddingLeft: 32,
        }}
      >
        {caption}
      </p>
      {children && <div style={{ paddingLeft: 32 }}>{children}</div>}
    </button>
  );
}
