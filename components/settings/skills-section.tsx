"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MESH, NavIcon, Pill } from "@/components/mesh";
import { SkillCreateModal } from "./skill-create-modal";

type Scope = { scope: "personal" | "project"; label: string; root: string };
type SkillKind = "invariant" | "pattern" | "knowledge";

type Frontmatter = {
  name: string;
  description?: string;
  kind?: SkillKind;
  paths?: string | string[];
};

type SkillSummary = {
  id: string;
  scope: Scope["scope"];
  scopeLabel: string;
  name: string;
  description: string;
  filePath: string;
  frontmatter: Frontmatter;
};

type SkillDetail = SkillSummary & { body: string; raw: string };

const KIND_TONES: Record<SkillKind, "red" | "amber" | "default"> = {
  invariant: "red",
  pattern: "amber",
  knowledge: "default",
};

export function SkillsSection() {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [selected, setSelected] = useState<SkillDetail | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [improving, setImproving] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function selectSkill(id: string) {
    setError(null);
    setSelected(null);
    setSuggestion(null);
    setDraft("");
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
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

  const grouped = useMemo(() => {
    const filtered = filter
      ? skills.filter(
          (s) =>
            s.name.toLowerCase().includes(filter.toLowerCase()) ||
            s.description?.toLowerCase().includes(filter.toLowerCase()),
        )
      : skills;
    const m = new Map<string, SkillSummary[]>();
    for (const s of filtered) {
      const k = `${s.scope}:${s.scopeLabel}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(s);
    }
    return [...m.entries()].sort(([a], [b]) => {
      const order = (k: string) => (k.startsWith("personal:") ? 0 : 1);
      return order(a) - order(b);
    });
  }, [skills, filter]);

  const dirty = !!(selected && draft !== selected.raw);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <Pill tone="dim">{skills.length} skills</Pill>
        <Pill tone="dim">{scopes.length} scopes</Pill>
        <button
          onClick={() => setShowCreate(true)}
          className="font-mono"
          disabled={scopes.length === 0}
          style={{
            marginLeft: "auto",
            padding: "6px 12px",
            borderRadius: 5,
            border: `1px solid ${MESH.amber}`,
            background: MESH.amber,
            color: "#0B0B0C",
            fontSize: 11.5,
            fontWeight: 500,
            cursor: scopes.length === 0 ? "default" : "pointer",
            opacity: scopes.length === 0 ? 0.5 : 1,
          }}
        >
          + new skill
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
        {/* List */}
        <aside
          style={{
            borderRight: `1px solid ${MESH.border}`,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            background: MESH.bg,
          }}
        >
          <div
            style={{
              padding: "10px 12px",
              borderBottom: `1px solid ${MESH.border}`,
              position: "relative",
            }}
          >
            <div style={{ position: "absolute", left: 22, top: 18, pointerEvents: "none" }}>
              <NavIcon kind="search" color={MESH.fgMute} size={12} />
            </div>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="filter skills"
              className="font-mono"
              style={{
                width: "100%",
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
              <p
                className="font-mono"
                style={{ fontSize: 11, color: MESH.fgMute, padding: 8 }}
              >
                {skills.length === 0
                  ? scopes.length === 0
                    ? "no scopes — connect a project first"
                    : "no skills yet"
                  : "no matches"}
              </p>
            ) : (
              grouped.map(([key, list]) => (
                <div
                  key={key}
                  style={{ display: "flex", flexDirection: "column", gap: 2 }}
                >
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
                        onClick={() => void selectSkill(s.id)}
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
        <div
          style={{
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {selected ? (
            <>
              <div
                style={{
                  padding: "10px 16px",
                  borderBottom: `1px solid ${MESH.border}`,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  background: MESH.bg,
                  flexWrap: "wrap",
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
                    KIND_TONES[
                      (selected.frontmatter.kind ?? "invariant") as SkillKind
                    ]
                  }
                >
                  {selected.frontmatter.kind ?? "invariant"}
                </Pill>
                <Pill tone={selected.scope === "personal" ? "amber" : "default"}>
                  {selected.scope} · {selected.scopeLabel}
                </Pill>
                <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
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
              select a skill to edit
            </div>
          )}
        </div>
      </div>

      {showCreate && (
        <SkillCreateModal
          scopes={scopes}
          onClose={() => setShowCreate(false)}
          onCreated={async (skillId) => {
            setShowCreate(false);
            await refresh();
            await selectSkill(skillId);
          }}
        />
      )}
    </div>
  );
}
