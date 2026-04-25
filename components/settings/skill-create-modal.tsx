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

type Scope = { scope: "personal" | "project"; label: string };

type Phase = "intent" | "streaming" | "draft" | "saving";

export function SkillCreateModal({
  scopes,
  onClose,
  onCreated,
}: {
  scopes: Scope[];
  onClose: () => void;
  onCreated: (skillId: string) => void | Promise<void>;
}) {
  const [phase, setPhase] = useState<Phase>("intent");
  const [scopeId, setScopeId] = useState<string>(() => {
    const project = scopes.find((s) => s.scope === "project");
    const pick = project ?? scopes[0];
    return pick ? `${pick.scope}::${pick.label}` : "";
  });
  const [intent, setIntent] = useState("");
  const [thinking, setThinking] = useState<ThinkingLine[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  async function generate() {
    if (!scopeId) {
      setError("choose a scope");
      return;
    }
    if (intent.trim().length < 8) {
      setError("describe the rule, pattern, or fact (at least a sentence)");
      return;
    }
    setError(null);
    setPhase("streaming");
    setThinking([]);
    setDraft("");

    const [scope, label] = scopeId.split("::");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/skills/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: intent.trim(), scope, scopeLabel: label }),
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
    const [scope, label] = scopeId.split("::");
    try {
      const res = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope,
          scopeLabel: label,
          raw: draft,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      const skillId = json.skill?.id as string | undefined;
      if (!skillId) throw new Error("missing skill id in response");
      await onCreated(skillId);
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
      title="New skill"
      meta={phase === "streaming" ? "drafting…" : phase === "draft" ? "review" : ""}
      width={780}
      footer={
        <>
          <SecondaryButton onClick={onClose} disabled={isBusy}>
            cancel
          </SecondaryButton>
          {phase === "intent" && (
            <PrimaryButton
              onClick={generate}
              disabled={!scopeId || intent.trim().length < 8}
            >
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
                save skill
              </PrimaryButton>
            </>
          )}
          {phase === "saving" && (
            <PrimaryButton disabled>saving…</PrimaryButton>
          )}
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
            <ModalLabel>scope</ModalLabel>
            <select
              value={scopeId}
              onChange={(e) => setScopeId(e.target.value)}
              className="font-mono"
              style={{
                width: "100%",
                background: MESH.bgInput,
                color: MESH.fg,
                border: `1px solid ${MESH.border}`,
                borderRadius: 5,
                padding: "8px 10px",
                fontSize: 12,
                outline: "none",
              }}
            >
              {scopes.map((s) => (
                <option
                  key={`${s.scope}::${s.label}`}
                  value={`${s.scope}::${s.label}`}
                >
                  {s.scope} · {s.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <ModalLabel>describe the rule, pattern, or fact</ModalLabel>
            <textarea
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              rows={6}
              placeholder={
                "e.g. when a migration in the api repo adds a column to a table that the analytics repo reads, ensure analytics also gets a backfill in the same PR"
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
              Claude reads the project memory and existing skills, picks the
              right kind (invariant / pattern / knowledge) for you, and grounds
              the paths in real files.
            </p>
          </div>
        </>
      )}

      {phase === "streaming" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ height: 220, border: `1px solid ${MESH.border}`, borderRadius: 6, overflow: "hidden" }}>
            <ThinkingPanel
              lines={thinking.length > 0 ? thinking : [{ text: "thinking…", kind: "mute" }]}
              active
              header="Drafting SKILL.md"
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
