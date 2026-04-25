"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell, MESH, NavIcon, Pill } from "@/components/mesh";

type Scope = { scope: "personal" | "project"; label: string; root: string };

type SkillKind = "invariant" | "pattern" | "knowledge";

type Frontmatter = {
  name: string;
  description?: string;
  kind?: SkillKind;
  "allowed-tools"?: string | string[];
  paths?: string | string[];
  "disable-model-invocation"?: boolean;
  "user-invocable"?: boolean;
};

const KIND_TONES: Record<SkillKind, "red" | "amber" | "default"> = {
  invariant: "red",
  pattern: "amber",
  knowledge: "default",
};

const KIND_OPTIONS: { value: SkillKind | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "invariant", label: "Invariant" },
  { value: "pattern", label: "Pattern" },
  { value: "knowledge", label: "Knowledge" },
];

type SkillSummary = {
  id: string;
  scope: Scope["scope"];
  scopeLabel: string;
  name: string;
  description: string;
  filePath: string;
  frontmatter: Frontmatter;
};

type SkillDetail = SkillSummary & {
  body: string;
  raw: string;
};

export default function SkillsPage() {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [selected, setSelected] = useState<SkillDetail | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newScopeId, setNewScopeId] = useState<string>("");
  const [improving, setImproving] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [kindFilter, setKindFilter] = useState<SkillKind | "all">("all");
  const [newKind, setNewKind] = useState<SkillKind>("invariant");
  const [mode, setMode] = useState<"skills" | "agents">("skills");

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/skills", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        skills: SkillSummary[];
        scopes: Scope[];
      };
      setSkills(data.skills);
      setScopes(data.scopes);
      if (!newScopeId && data.scopes.length > 0) {
        const project = data.scopes.find((s) => s.scope === "project");
        setNewScopeId(scopeId(project ?? data.scopes[0]));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [newScopeId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/projects", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          projects?: Array<{
            id: string;
            onboarding?: { dismissed?: boolean; stepsSeen?: string[] };
          }>;
          currentProjectId?: string | null;
        };
        const project =
          data.projects?.find((p) => p.id === data.currentProjectId) ??
          data.projects?.[0];
        if (!project || cancelled) return;
        const seen = project.onboarding?.stepsSeen ?? [];
        if (seen.includes("skills")) return;
        await fetch(`/api/projects/${encodeURIComponent(project.id)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            onboarding: {
              dismissed: project.onboarding?.dismissed ?? false,
              stepsSeen: Array.from(new Set([...seen, "skills"])),
            },
          }),
        });
      } catch {
        // best-effort
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function select(id: string) {
    setError(null);
    setSelected(null);
    setDraft("");
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(id)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { skill: SkillDetail };
      setSelected(data.skill);
      setDraft(data.skill.raw);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function save() {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(selected.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw: draft }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      const skill = json.skill as SkillDetail;
      setSelected(skill);
      setDraft(skill.raw);
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
      const res = await fetch("/api/skills/improve", {
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

  function acceptSuggestion() {
    if (!suggestion) return;
    setDraft(suggestion);
    setSuggestion(null);
  }

  function discardSuggestion() {
    setSuggestion(null);
  }

  async function createNew() {
    if (!newName.trim() || !newScopeId) {
      setError("choose a scope and a name");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const [scope, label] = newScopeId.split("::");
      const res = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope,
          scopeLabel: label,
          name: newName,
          kind: newKind,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      const skill = json.skill as SkillDetail;
      setNewName("");
      await refresh();
      await select(skill.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  const grouped = useMemo(() => {
    const textMatched = filter
      ? skills.filter(
          (s) =>
            s.name.toLowerCase().includes(filter.toLowerCase()) ||
            s.description?.toLowerCase().includes(filter.toLowerCase()),
        )
      : skills;
    const filtered =
      kindFilter === "all"
        ? textMatched
        : textMatched.filter(
            (s) => (s.frontmatter.kind ?? "invariant") === kindFilter,
          );
    const m = new Map<string, SkillSummary[]>();
    for (const s of filtered) {
      const k = `${s.scope}:${s.scopeLabel}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(s);
    }
    return [...m.entries()].sort(([a], [b]) => {
      const order = (k: string) =>
        k.startsWith("personal:") ? 0 : k.startsWith("project:") ? 1 : 2;
      return order(a) - order(b);
    });
  }, [skills, filter, kindFilter]);

  const kindCounts = useMemo(() => {
    const counts: Record<SkillKind, number> = {
      invariant: 0,
      pattern: 0,
      knowledge: 0,
    };
    for (const s of skills) {
      const k = (s.frontmatter.kind ?? "invariant") as SkillKind;
      counts[k] += 1;
    }
    return counts;
  }, [skills]);

  const dirty = !!(selected && draft !== selected.raw);

  return (
    <AppShell
      title={mode === "skills" ? "Skills" : "Agents"}
      subtitle={
        mode === "skills"
          ? "Claude Code compatible · .claude/skills/"
          : "Master dispatch roster · .claude/agents/"
      }
      topRight={
        <>
          <ModeToggle mode={mode} setMode={setMode} />
          {mode === "skills" ? (
            <>
              <Pill tone="dim">{skills.length} skills</Pill>
              <Pill tone="dim">{scopes.length} scopes</Pill>
            </>
          ) : null}
        </>
      }
    >
      {error && (
        <div
          className="font-mono"
          style={{
            margin: "12px 24px 0",
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

      {mode === "agents" ? (
        <AgentsPanel />
      ) : (
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: "320px 1fr",
        }}
      >
        {/* Skill list */}
        <aside
          style={{
            borderRight: `1px solid ${MESH.border}`,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            background: MESH.bg,
          }}
        >
          {/* Filter bar */}
          <div
            style={{
              padding: "12px 14px 8px",
              borderBottom: `1px solid ${MESH.border}`,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <div style={{ position: "absolute", left: 10, pointerEvents: "none" }}>
                <NavIcon kind="search" color={MESH.fgMute} size={12} />
              </div>
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="filter skills"
                className="font-mono"
                style={{
                  flex: 1,
                  background: MESH.bgInput,
                  color: MESH.fg,
                  border: `1px solid ${MESH.border}`,
                  borderRadius: 5,
                  padding: "6px 10px 6px 28px",
                  fontSize: 11.5,
                  outline: "none",
                }}
              />
            </div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {KIND_OPTIONS.map((opt) => {
                const active = kindFilter === opt.value;
                const count =
                  opt.value === "all"
                    ? skills.length
                    : kindCounts[opt.value as SkillKind];
                return (
                  <button
                    key={opt.value}
                    onClick={() => setKindFilter(opt.value)}
                    className="font-mono"
                    style={{
                      padding: "3px 8px",
                      borderRadius: 4,
                      border: `1px solid ${active ? MESH.amber : MESH.border}`,
                      background: active ? "rgba(245,165,36,0.08)" : "transparent",
                      color: active ? MESH.amber : MESH.fgDim,
                      fontSize: 10.5,
                      cursor: "pointer",
                      letterSpacing: "0.02em",
                    }}
                  >
                    {opt.label}
                    <span style={{ marginLeft: 4, color: MESH.fgMute }}>{count}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* New skill */}
          <div
            style={{
              padding: 14,
              borderBottom: `1px solid ${MESH.border}`,
              display: "flex",
              flexDirection: "column",
              gap: 6,
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
              + new skill
            </span>
            <select
              value={newScopeId}
              onChange={(e) => setNewScopeId(e.target.value)}
              className="font-mono"
              style={{
                background: MESH.bgInput,
                color: MESH.fg,
                border: `1px solid ${MESH.border}`,
                borderRadius: 5,
                padding: "6px 8px",
                fontSize: 11.5,
                outline: "none",
              }}
            >
              {scopes.map((s) => (
                <option key={scopeId(s)} value={scopeId(s)}>
                  {scopeLabel(s)}
                </option>
              ))}
            </select>
            <select
              value={newKind}
              onChange={(e) => setNewKind(e.target.value as SkillKind)}
              className="font-mono"
              style={{
                background: MESH.bgInput,
                color: MESH.fg,
                border: `1px solid ${MESH.border}`,
                borderRadius: 5,
                padding: "6px 8px",
                fontSize: 11.5,
                outline: "none",
              }}
            >
              <option value="invariant">invariant — hard rule</option>
              <option value="pattern">pattern — preferred way</option>
              <option value="knowledge">knowledge — stable fact</option>
            </select>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="skill-name"
              className="font-mono"
              style={{
                background: MESH.bgInput,
                color: MESH.fg,
                border: `1px solid ${MESH.border}`,
                borderRadius: 5,
                padding: "6px 8px",
                fontSize: 11.5,
                outline: "none",
              }}
            />
            <button
              onClick={createNew}
              disabled={creating}
              className="font-mono"
              style={{
                padding: "6px 10px",
                borderRadius: 5,
                border: `1px solid ${MESH.amber}`,
                background: creating ? "transparent" : MESH.amber,
                color: creating ? MESH.amber : "#0B0B0C",
                fontSize: 11.5,
                fontWeight: 500,
                cursor: creating ? "default" : "pointer",
                opacity: creating ? 0.6 : 1,
              }}
            >
              {creating ? "creating…" : "create"}
            </button>
          </div>

          {/* List */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "8px 8px 16px",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {grouped.length === 0 ? (
              <p className="font-mono" style={{ fontSize: 11, color: MESH.fgMute, padding: 8 }}>
                no skills
              </p>
            ) : (
              grouped.map(([key, list]) => (
                <div key={key} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <div
                    className="font-mono"
                    style={{
                      fontSize: 10,
                      color: MESH.fgMute,
                      textTransform: "uppercase",
                      letterSpacing: "0.14em",
                      padding: "8px 10px 4px",
                    }}
                  >
                    {key.split(":")[0]}
                    <span style={{ color: MESH.fgMute, marginLeft: 6 }}>
                      · {key.split(":")[1]}
                    </span>
                  </div>
                  {list.map((s) => {
                    const isSelected = selected?.id === s.id;
                    return (
                      <button
                        key={s.id}
                        onClick={() => select(s.id)}
                        style={{
                          textAlign: "left",
                          background: isSelected ? "rgba(245,165,36,0.08)" : "transparent",
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
                            gap: 8,
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
                            {s.name}
                          </span>
                          <span
                            className="font-mono"
                            style={{
                              fontSize: 9,
                              color:
                                KIND_TONES[
                                  (s.frontmatter.kind ?? "invariant") as SkillKind
                                ] === "red"
                                  ? MESH.red
                                  : KIND_TONES[
                                        (s.frontmatter.kind ?? "invariant") as SkillKind
                                      ] === "amber"
                                    ? MESH.amber
                                    : MESH.fgMute,
                              letterSpacing: "0.12em",
                              textTransform: "uppercase",
                            }}
                          >
                            {s.frontmatter.kind ?? "invariant"}
                          </span>
                        </div>
                        {s.description && (
                          <p
                            style={{
                              fontSize: 10.5,
                              color: MESH.fgMute,
                              margin: 0,
                              overflow: "hidden",
                              display: "-webkit-box",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical",
                              lineHeight: 1.5,
                            }}
                          >
                            {s.description}
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </aside>

        {/* Editor */}
        <div style={{ minHeight: 0, display: "flex", flexDirection: "column" }}>
          {selected ? (
            <>
              {/* Breadcrumb / actions */}
              <div
                style={{
                  padding: "12px 20px",
                  borderBottom: `1px solid ${MESH.border}`,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  background: MESH.bg,
                }}
              >
                <span
                  className="font-mono"
                  style={{ fontSize: 13, color: MESH.fg, fontWeight: 500 }}
                >
                  {selected.name}
                </span>
                <Pill
                  tone={
                    KIND_TONES[(selected.frontmatter.kind ?? "invariant") as SkillKind]
                  }
                >
                  {selected.frontmatter.kind ?? "invariant"}
                </Pill>
                <Pill tone={selected.scope === "personal" ? "amber" : "default"}>
                  {selected.scope} · {selected.scopeLabel}
                </Pill>
                <span
                  className="font-mono"
                  style={{
                    fontSize: 10,
                    color: MESH.fgMute,
                    marginLeft: 8,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    flex: 1,
                  }}
                  title={selected.filePath}
                >
                  {selected.filePath}
                </span>
                <button
                  onClick={improve}
                  disabled={improving}
                  className="font-mono"
                  style={{
                    padding: "6px 12px",
                    borderRadius: 5,
                    border: `1px solid ${MESH.amber}`,
                    background: "transparent",
                    color: MESH.amber,
                    fontSize: 11.5,
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
                    padding: "6px 12px",
                    borderRadius: 5,
                    border: `1px solid ${dirty ? MESH.amber : MESH.border}`,
                    background: dirty ? MESH.amber : "transparent",
                    color: dirty ? "#0B0B0C" : MESH.fgMute,
                    fontSize: 11.5,
                    fontWeight: 500,
                    cursor: !dirty || saving ? "default" : "pointer",
                    opacity: !dirty ? 0.6 : 1,
                  }}
                >
                  {saving ? "saving…" : dirty ? "save" : "saved"}
                </button>
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
                  {/* current */}
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
                        padding: "10px 16px",
                        borderBottom: `1px solid ${MESH.border}`,
                        display: "flex",
                        justifyContent: "space-between",
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
                      <span className="font-mono" style={{ fontSize: 10, color: MESH.fgMute }}>
                        {draft.length.toLocaleString()} chars
                      </span>
                    </div>
                    <pre
                      className="font-mono"
                      style={{
                        flex: 1,
                        overflow: "auto",
                        margin: 0,
                        padding: 16,
                        fontSize: 12,
                        color: MESH.fgDim,
                        lineHeight: 1.8,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {draft}
                    </pre>
                  </div>
                  {/* suggestion */}
                  <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
                    <div
                      style={{
                        padding: "10px 16px",
                        borderBottom: `1px solid ${MESH.border}`,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <Pill tone="amber">AI suggestion</Pill>
                      <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                        <button
                          onClick={discardSuggestion}
                          className="font-mono"
                          style={{
                            padding: "4px 10px",
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
                          onClick={acceptSuggestion}
                          className="font-mono"
                          style={{
                            padding: "4px 10px",
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
                        padding: 16,
                        fontSize: 12,
                        color: MESH.fg,
                        lineHeight: 1.8,
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
                    padding: 20,
                    fontSize: 13,
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
              select a skill to edit
            </div>
          )}
        </div>
      </div>
      )}
    </AppShell>
  );
}

function scopeId(s: Scope): string {
  return `${s.scope}::${s.label}`;
}

function ModeToggle({
  mode,
  setMode,
}: {
  mode: "skills" | "agents";
  setMode: (m: "skills" | "agents") => void;
}) {
  const item = (label: string, value: "skills" | "agents") => {
    const active = mode === value;
    return (
      <button
        key={value}
        onClick={() => setMode(value)}
        className="font-mono"
        style={{
          padding: "5px 10px",
          border: `1px solid ${active ? MESH.amber : MESH.border}`,
          background: active ? "rgba(245,165,36,0.08)" : "transparent",
          color: active ? MESH.amber : MESH.fgDim,
          borderRadius: 5,
          fontSize: 11,
          cursor: "pointer",
          letterSpacing: "0.02em",
          textTransform: "lowercase",
        }}
      >
        {label}
      </button>
    );
  };
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {item("skills", "skills")}
      {item("agents", "agents")}
    </div>
  );
}

type AgentSummary = {
  id: "frontend" | "backend" | "product" | "qa";
  role: string;
  description: string;
  when_to_use: string;
  filePath: string;
  body: string;
};

function AgentsPanel() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [selectedId, setSelectedId] = useState<AgentSummary["id"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/agents", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { agents: AgentSummary[] };
        setAgents(data.agents);
        if (data.agents.length > 0) setSelectedId(data.agents[0].id);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const selected = agents.find((a) => a.id === selectedId) ?? null;

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "grid",
        gridTemplateColumns: "320px 1fr",
      }}
    >
      <aside
        style={{
          borderRight: `1px solid ${MESH.border}`,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          background: MESH.bg,
          padding: "14px 10px",
          gap: 6,
          overflowY: "auto",
        }}
      >
        {loading ? (
          <p className="font-mono" style={{ fontSize: 11, color: MESH.fgMute, padding: 8 }}>
            loading…
          </p>
        ) : error ? (
          <p className="font-mono" style={{ fontSize: 11, color: MESH.red, padding: 8 }}>
            {error}
          </p>
        ) : agents.length === 0 ? (
          <p className="font-mono" style={{ fontSize: 11, color: MESH.fgMute, padding: 8 }}>
            no agents defined
          </p>
        ) : (
          agents.map((a) => {
            const isSelected = selectedId === a.id;
            return (
              <button
                key={a.id}
                onClick={() => setSelectedId(a.id)}
                style={{
                  textAlign: "left",
                  background: isSelected ? "rgba(245,165,36,0.08)" : "transparent",
                  border: `1px solid ${isSelected ? "rgba(245,165,36,0.25)" : "transparent"}`,
                  borderLeft: `2px solid ${isSelected ? MESH.amber : "transparent"}`,
                  borderRadius: 5,
                  padding: "10px 12px",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <span
                  className="font-mono"
                  style={{
                    fontSize: 12.5,
                    color: isSelected ? MESH.amber : MESH.fg,
                    fontWeight: 500,
                  }}
                >
                  {a.id}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: MESH.fgDim,
                    lineHeight: 1.5,
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
                padding: "14px 22px",
                borderBottom: `1px solid ${MESH.border}`,
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <span
                className="font-mono"
                style={{ fontSize: 14, color: MESH.fg, fontWeight: 500 }}
              >
                {selected.id}
              </span>
              <Pill tone="amber">{selected.role}</Pill>
              <span
                className="font-mono"
                style={{
                  marginLeft: "auto",
                  fontSize: 10,
                  color: MESH.fgMute,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: 420,
                }}
                title={selected.filePath}
              >
                {selected.filePath}
              </span>
            </div>

            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "20px 24px 40px",
                display: "flex",
                flexDirection: "column",
                gap: 20,
              }}
            >
              <AgentSection label="Description">
                <p style={{ fontSize: 13, color: MESH.fg, lineHeight: 1.6, margin: 0 }}>
                  {selected.description}
                </p>
              </AgentSection>
              <AgentSection label="When to use">
                <p style={{ fontSize: 13, color: MESH.fgDim, lineHeight: 1.6, margin: 0 }}>
                  {selected.when_to_use}
                </p>
              </AgentSection>
              <AgentSection label="System prompt">
                <pre
                  className="font-mono"
                  style={{
                    fontSize: 11.5,
                    color: MESH.fgDim,
                    lineHeight: 1.65,
                    margin: 0,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    background: MESH.bgElev,
                    border: `1px solid ${MESH.border}`,
                    borderRadius: 6,
                    padding: 14,
                  }}
                >
                  {selected.body}
                </pre>
              </AgentSection>
              <p
                className="font-mono"
                style={{ fontSize: 10, color: MESH.fgMute, margin: 0 }}
              >
                Edit by modifying the file directly. UI editing for agents is
                not wired yet.
              </p>
            </div>
          </>
        ) : (
          <div
            className="font-mono"
            style={{
              padding: 40,
              color: MESH.fgMute,
              fontSize: 12,
            }}
          >
            select an agent to inspect
          </div>
        )}
      </div>
    </div>
  );
}

function AgentSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h3
        className="font-mono"
        style={{
          fontSize: 10,
          color: MESH.fgMute,
          textTransform: "uppercase",
          letterSpacing: "0.14em",
          margin: 0,
          marginBottom: 10,
        }}
      >
        {label}
      </h3>
      {children}
    </div>
  );
}

function scopeLabel(s: Scope): string {
  return `${s.scope} · ${s.label}`;
}
