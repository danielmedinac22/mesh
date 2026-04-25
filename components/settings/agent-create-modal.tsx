"use client";

import { useEffect, useRef, useState } from "react";
import {
  MESH,
  ModalShell,
  ModalLabel,
  Pill,
  PrimaryButton,
  SecondaryButton,
  ThinkingPanel,
  type ThinkingLine,
} from "@/components/mesh";

type Phase = "intent" | "streaming" | "draft" | "saving";

export function AgentCreateModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (agentId: string) => void | Promise<void>;
}) {
  const [phase, setPhase] = useState<Phase>("intent");
  const [intent, setIntent] = useState("");
  const [thinking, setThinking] = useState<ThinkingLine[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  async function generate() {
    if (intent.trim().length < 8) {
      setError("describe what kind of agent you want (at least a sentence)");
      return;
    }
    setError(null);
    setPhase("streaming");
    setThinking([]);
    setDraft("");

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/agents/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: intent.trim() }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.error ?? `HTTP ${res.status}`);
      }
      if (!res.body) throw new Error("no response body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let thinkingBuf = "";
      let textBuf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buf.indexOf("\n\n")) !== -1) {
          const block = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          for (const line of block.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            try {
              const ev = JSON.parse(line.slice(6)) as
                | { type: "thinking"; delta: string }
                | { type: "text"; delta: string }
                | { type: "meta"; ttft_ms: number }
                | { type: "done"; raw: string }
                | { type: "error"; message: string };
              if (ev.type === "thinking") {
                thinkingBuf += ev.delta;
                setThinking(splitLines(thinkingBuf));
              } else if (ev.type === "text") {
                textBuf += ev.delta;
                setDraft(textBuf);
              } else if (ev.type === "done") {
                setDraft(ev.raw);
                setPhase("draft");
              } else if (ev.type === "error") {
                throw new Error(ev.message);
              }
            } catch (parseErr) {
              if (parseErr instanceof Error) throw parseErr;
            }
          }
        }
      }
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      setError(err instanceof Error ? err.message : String(err));
      setPhase("intent");
    }
  }

  async function save() {
    if (!draft.trim()) return;
    setPhase("saving");
    setError(null);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw: draft }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      const agentId = json.agent?.id as string | undefined;
      if (!agentId) throw new Error("missing agent id in response");
      await onCreated(agentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("draft");
    }
  }

  const isBusy = phase === "streaming" || phase === "saving";

  return (
    <ModalShell
      open
      onClose={isBusy ? () => undefined : onClose}
      title="New agent"
      meta={phase === "streaming" ? "drafting…" : phase === "draft" ? "review" : ""}
      width={780}
      footer={
        <>
          <SecondaryButton onClick={onClose} disabled={isBusy}>
            cancel
          </SecondaryButton>
          {phase === "intent" && (
            <PrimaryButton onClick={generate} disabled={intent.trim().length < 8}>
              draft with Claude
            </PrimaryButton>
          )}
          {phase === "streaming" && (
            <SecondaryButton
              onClick={() => {
                abortRef.current?.abort();
                setPhase("intent");
              }}
            >
              stop
            </SecondaryButton>
          )}
          {phase === "draft" && (
            <>
              <SecondaryButton onClick={() => setPhase("intent")}>
                redraft
              </SecondaryButton>
              <PrimaryButton onClick={save} disabled={!draft.trim()}>
                save agent
              </PrimaryButton>
            </>
          )}
          {phase === "saving" && <PrimaryButton disabled>saving…</PrimaryButton>}
        </>
      }
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

      {phase === "intent" && (
        <>
          <div>
            <ModalLabel>describe the agent</ModalLabel>
            <textarea
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              rows={6}
              placeholder={
                "e.g. an agent that audits SQL queries for cost regressions, runs on api PRs that touch /repositories or /services"
              }
              className="font-mono"
              style={{
                width: "100%",
                background: MESH.bgInput,
                color: MESH.fg,
                border: `1px solid ${MESH.border}`,
                borderRadius: 5,
                padding: "10px 12px",
                fontSize: 12,
                lineHeight: 1.6,
                outline: "none",
                resize: "vertical",
                minHeight: 110,
              }}
            />
            <p
              style={{
                fontSize: 11,
                color: MESH.fgMute,
                margin: "8px 0 0",
                lineHeight: 1.5,
              }}
            >
              Claude reads the project memory, the existing agents (so it stays
              out of their lanes), and the existing skills (so the agent
              references rather than restates them). Custom agents are visible
              in Settings; the build dispatch still uses the four base agents.
            </p>
          </div>
        </>
      )}

      {phase === "streaming" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div
            style={{
              height: 220,
              border: `1px solid ${MESH.border}`,
              borderRadius: 6,
              overflow: "hidden",
            }}
          >
            <ThinkingPanel
              lines={
                thinking.length > 0
                  ? thinking
                  : [{ text: "thinking…", kind: "mute" }]
              }
              active
              header="Drafting agent .md"
              sub="Opus 4.7 · grounding in project memory"
            />
          </div>
          {draft && (
            <div>
              <ModalLabel>draft so far</ModalLabel>
              <pre
                className="font-mono"
                style={{
                  margin: 0,
                  padding: 12,
                  fontSize: 11,
                  color: MESH.fgDim,
                  lineHeight: 1.6,
                  background: MESH.bg,
                  border: `1px solid ${MESH.border}`,
                  borderRadius: 6,
                  maxHeight: 200,
                  overflow: "auto",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {draft}
              </pre>
            </div>
          )}
        </div>
      )}

      {(phase === "draft" || phase === "saving") && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <Pill tone="amber">draft</Pill>
            <span
              className="font-mono"
              style={{ fontSize: 10, color: MESH.fgMute }}
            >
              edit before saving — frontmatter + body
            </span>
          </div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            className="font-mono"
            style={{
              width: "100%",
              minHeight: 320,
              background: MESH.bg,
              color: MESH.fg,
              border: `1px solid ${MESH.border}`,
              borderRadius: 6,
              padding: 12,
              fontSize: 12,
              lineHeight: 1.65,
              outline: "none",
              resize: "vertical",
              whiteSpace: "pre",
            }}
          />
        </div>
      )}
    </ModalShell>
  );
}

function splitLines(text: string): ThinkingLine[] {
  return text
    .split("\n")
    .filter((l) => l.length > 0)
    .map((text) => ({ text }));
}
