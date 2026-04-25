"use client";

import { useCallback, useEffect, useState } from "react";
import { MESH, Pill } from "@/components/mesh";
import { AgentCreateModal } from "./agent-create-modal";

type AgentSummary = {
  id: string;
  role: string;
  description: string;
  when_to_use: string;
  filePath: string;
  body: string;
};

type AgentDetail = AgentSummary & { raw: string };

const BASE_AGENT_IDS = ["frontend", "backend", "product", "qa"] as const;
function isBaseAgent(id: string): boolean {
  return (BASE_AGENT_IDS as readonly string[]).includes(id);
}

export function AgentsSection() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [selected, setSelected] = useState<AgentDetail | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [improving, setImproving] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/agents", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { agents: AgentSummary[] };
      setAgents(data.agents);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function selectAgent(id: string) {
    setError(null);
    setSelected(null);
    setSuggestion(null);
    setDraft("");
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { agent: AgentDetail };
      setSelected(data.agent);
      setDraft(data.agent.raw);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function save() {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(selected.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw: draft }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      const a = json.agent;
      setSelected({
        id: a.id,
        role: a.frontmatter.role,
        description: a.frontmatter.description,
        when_to_use: a.frontmatter.when_to_use,
        filePath: a.filePath,
        body: a.body,
        raw: draft,
      });
      setSuggestion(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function improve() {
    if (!selected) return;
    setImproving(true);
    setSuggestion(null);
    setError(null);
    try {
      const res = await fetch("/api/agents/improve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selected.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      setSuggestion(json.suggestion as string);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImproving(false);
    }
  }

  async function remove() {
    if (!selected || isBaseAgent(selected.id)) return;
    if (!window.confirm(`Delete agent "${selected.id}"? This is irreversible.`))
      return;
    setError(null);
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(selected.id)}`, {
        method: "DELETE",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      setSelected(null);
      setDraft("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const dirty = !!(selected && draft !== selected.raw);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <Pill tone="dim">{agents.length} agents</Pill>
        <Pill tone="dim">.claude/agents/</Pill>
        <button
          onClick={() => setShowCreate(true)}
          className="font-mono"
          style={{
            marginLeft: "auto",
            padding: "6px 12px",
            borderRadius: 5,
            border: `1px solid ${MESH.amber}`,
            background: MESH.amber,
            color: "#0B0B0C",
            fontSize: 11.5,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          + new agent
        </button>
      </div>

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

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "280px 1fr",
          gap: 0,
          height: 540,
          minHeight: 540,
          border: `1px solid ${MESH.border}`,
          borderRadius: 8,
          overflow: "hidden",
          background: MESH.bg,
        }}
      >
        <aside
          style={{
            borderRight: `1px solid ${MESH.border}`,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            background: MESH.bg,
            padding: "10px 8px",
            gap: 4,
            overflowY: "auto",
          }}
        >
          {agents.length === 0 ? (
            <p
              className="font-mono"
              style={{ fontSize: 11, color: MESH.fgMute, padding: 8 }}
            >
              no agents defined
            </p>
          ) : (
            agents.map((a) => {
              const isSelected = selected?.id === a.id;
              const base = isBaseAgent(a.id);
              return (
                <button
                  key={a.id}
                  onClick={() => void selectAgent(a.id)}
                  style={{
                    textAlign: "left",
                    background: isSelected
                      ? "rgba(245,165,36,0.08)"
                      : "transparent",
                    border: `1px solid ${isSelected ? "rgba(245,165,36,0.25)" : "transparent"}`,
                    borderLeft: `2px solid ${isSelected ? MESH.amber : "transparent"}`,
                    borderRadius: 5,
                    padding: "8px 10px",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      justifyContent: "space-between",
                    }}
                  >
                    <span
                      className="font-mono"
                      style={{
                        fontSize: 12,
                        color: isSelected ? MESH.amber : MESH.fg,
                        fontWeight: 500,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {a.id}
                    </span>
                    {!base && (
                      <span
                        className="font-mono"
                        style={{
                          fontSize: 9,
                          color: MESH.amber,
                          letterSpacing: "0.12em",
                          textTransform: "uppercase",
                        }}
                      >
                        custom
                      </span>
                    )}
                  </div>
                  <span
                    style={{
                      fontSize: 10.5,
                      color: MESH.fgMute,
                      lineHeight: 1.5,
                      overflow: "hidden",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                    }}
                  >
                    {a.role}
                  </span>
                </button>
              );
            })
          )}
        </aside>

        <div style={{ minHeight: 0, display: "flex", flexDirection: "column" }}>
          {selected ? (
            <>
              <div
                style={{
                  padding: "10px 16px",
                  borderBottom: `1px solid ${MESH.border}`,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                  background: MESH.bg,
                }}
              >
                <span
                  className="font-mono"
                  style={{ fontSize: 13, color: MESH.fg, fontWeight: 500 }}
                >
                  {selected.id}
                </span>
                <Pill tone="amber">{selected.role}</Pill>
                {isBaseAgent(selected.id) ? (
                  <Pill tone="dim">base</Pill>
                ) : (
                  <Pill tone="default">custom</Pill>
                )}
                <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  {!isBaseAgent(selected.id) && (
                    <button
                      onClick={remove}
                      className="font-mono"
                      style={{
                        padding: "5px 10px",
                        borderRadius: 4,
                        border: `1px solid ${MESH.red}`,
                        background: "transparent",
                        color: MESH.red,
                        fontSize: 11,
                        cursor: "pointer",
                      }}
                    >
                      delete
                    </button>
                  )}
                  <button
                    onClick={improve}
                    disabled={improving}
                    className="font-mono"
                    style={{
                      padding: "5px 10px",
                      borderRadius: 4,
                      border: `1px solid ${MESH.amber}`,
                      background: "transparent",
                      color: MESH.amber,
                      fontSize: 11,
                      fontWeight: 500,
                      cursor: improving ? "default" : "pointer",
                      opacity: improving ? 0.6 : 1,
                    }}
                  >
                    {improving ? "improving…" : "improve with AI"}
                  </button>
                  <button
                    onClick={save}
                    disabled={!dirty || saving}
                    className="font-mono"
                    style={{
                      padding: "5px 10px",
                      borderRadius: 4,
                      border: `1px solid ${dirty ? MESH.amber : MESH.border}`,
                      background: dirty ? MESH.amber : "transparent",
                      color: dirty ? "#0B0B0C" : MESH.fgMute,
                      fontSize: 11,
                      fontWeight: 500,
                      cursor: !dirty || saving ? "default" : "pointer",
                      opacity: !dirty ? 0.6 : 1,
                    }}
                  >
                    {saving ? "saving…" : dirty ? "save" : "saved"}
                  </button>
                </div>
              </div>

              {suggestion ? (
                <div
                  style={{
                    flex: 1,
                    minHeight: 0,
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      minHeight: 0,
                      borderRight: `1px solid ${MESH.border}`,
                      background: MESH.bgElev,
                    }}
                  >
                    <div
                      style={{
                        padding: "8px 14px",
                        borderBottom: `1px solid ${MESH.border}`,
                      }}
                    >
                      <span
                        className="font-mono"
                        style={{
                          fontSize: 10,
                          color: MESH.fgMute,
                          textTransform: "uppercase",
                          letterSpacing: "0.14em",
                        }}
                      >
                        current
                      </span>
                    </div>
                    <pre
                      className="font-mono"
                      style={{
                        flex: 1,
                        overflow: "auto",
                        margin: 0,
                        padding: 14,
                        fontSize: 11.5,
                        color: MESH.fgDim,
                        lineHeight: 1.7,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {draft}
                    </pre>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
                    <div
                      style={{
                        padding: "8px 14px",
                        borderBottom: `1px solid ${MESH.border}`,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <Pill tone="amber">AI suggestion</Pill>
                      <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                        <button
                          onClick={() => setSuggestion(null)}
                          className="font-mono"
                          style={{
                            padding: "3px 8px",
                            borderRadius: 4,
                            border: `1px solid ${MESH.border}`,
                            background: "transparent",
                            color: MESH.fgDim,
                            fontSize: 10.5,
                            cursor: "pointer",
                          }}
                        >
                          reject
                        </button>
                        <button
                          onClick={() => {
                            if (suggestion) {
                              setDraft(suggestion);
                              setSuggestion(null);
                            }
                          }}
                          className="font-mono"
                          style={{
                            padding: "3px 8px",
                            borderRadius: 4,
                            border: `1px solid ${MESH.amber}`,
                            background: MESH.amber,
                            color: "#0B0B0C",
                            fontSize: 10.5,
                            fontWeight: 500,
                            cursor: "pointer",
                          }}
                        >
                          accept
                        </button>
                      </div>
                    </div>
                    <pre
                      className="font-mono"
                      style={{
                        flex: 1,
                        overflow: "auto",
                        margin: 0,
                        padding: 14,
                        fontSize: 11.5,
                        color: MESH.fg,
                        lineHeight: 1.7,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        background: MESH.bg,
                      }}
                    >
                      {suggestion}
                    </pre>
                  </div>
                </div>
              ) : (
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className="font-mono"
                  style={{
                    flex: 1,
                    background: MESH.bg,
                    color: MESH.fg,
                    padding: 16,
                    fontSize: 12.5,
                    lineHeight: 1.7,
                    border: "none",
                    outline: "none",
                    resize: "none",
                    whiteSpace: "pre",
                  }}
                  spellCheck={false}
                />
              )}
            </>
          ) : (
            <div
              className="font-mono"
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: MESH.fgMute,
                fontSize: 12,
              }}
            >
              select an agent to edit
            </div>
          )}
        </div>
      </div>

      {showCreate && (
        <AgentCreateModal
          onClose={() => setShowCreate(false)}
          onCreated={async (agentId) => {
            setShowCreate(false);
            await refresh();
            await selectAgent(agentId);
          }}
        />
      )}
    </div>
  );
}
