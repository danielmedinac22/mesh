"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Scope = { scope: "personal" | "project" | "repo"; label: string; root: string };

type Frontmatter = {
  name: string;
  description?: string;
  "allowed-tools"?: string | string[];
  paths?: string | string[];
  "disable-model-invocation"?: boolean;
  "user-invocable"?: boolean;
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
        setNewScopeId(
          scopeId(project ?? data.scopes[0]),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [newScopeId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function select(id: string) {
    setError(null);
    setSelected(null);
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
      const res = await fetch(
        `/api/skills/${encodeURIComponent(selected.id)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ raw: draft }),
        },
      );
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
      if (!res.ok)
        throw new Error(json?.error ?? `HTTP ${res.status}`);
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
        body: JSON.stringify({ scope, scopeLabel: label, name: newName }),
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
    const m = new Map<string, SkillSummary[]>();
    for (const s of skills) {
      const k = `${s.scope}:${s.scopeLabel}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(s);
    }
    return [...m.entries()].sort(([a], [b]) => {
      // personal → project → repo
      const order = (k: string) =>
        k.startsWith("personal:") ? 0 : k.startsWith("project:") ? 1 : 2;
      return order(a) - order(b);
    });
  }, [skills]);

  const dirty = selected && draft !== selected.raw;

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
          <h1 className="text-xl font-mono">skills</h1>
          <span className="text-xs font-mono text-muted-foreground">
            Claude Code compatible · .claude/skills/
          </span>
        </div>
        <div className="text-xs font-mono text-muted-foreground">
          {skills.length} skills · {scopes.length} scopes
        </div>
      </header>

      {error && (
        <div className="mx-6 mt-4 rounded-md border border-destructive bg-destructive/10 text-destructive p-3 font-mono text-xs">
          {error}
        </div>
      )}

      <section className="flex-1 grid grid-cols-[280px_1fr] gap-0 min-h-0">
        <aside className="border-r border-border p-4 overflow-auto flex flex-col gap-4">
          <div className="flex flex-col gap-2 rounded-md border border-border p-3">
            <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
              new skill
            </h3>
            <select
              value={newScopeId}
              onChange={(e) => setNewScopeId(e.target.value)}
              className="bg-muted/50 text-foreground rounded-md border border-border p-1.5 font-mono text-xs focus:outline-none focus:border-accent"
            >
              {scopes.map((s) => (
                <option key={scopeId(s)} value={scopeId(s)}>
                  {scopeLabel(s)}
                </option>
              ))}
            </select>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="skill-name"
              className="bg-muted/50 text-foreground rounded-md border border-border p-1.5 font-mono text-xs focus:outline-none focus:border-accent"
            />
            <button
              onClick={createNew}
              disabled={creating}
              className="px-2 py-1.5 rounded-md border border-accent bg-accent text-accent-foreground font-mono text-xs hover:opacity-90 disabled:opacity-50"
            >
              {creating ? "creating" : "create"}
            </button>
          </div>

          {grouped.length === 0 ? (
            <p className="text-xs text-muted-foreground font-mono">
              no skills yet
            </p>
          ) : (
            grouped.map(([key, list]) => (
              <div key={key} className="flex flex-col gap-1">
                <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
                  {key.split(":")[0]}{" "}
                  <span className="text-foreground/60">
                    · {key.split(":")[1]}
                  </span>
                </h3>
                <ul className="flex flex-col gap-1">
                  {list.map((s) => (
                    <li key={s.id}>
                      <button
                        onClick={() => select(s.id)}
                        className={`w-full text-left rounded-md border px-2 py-1.5 transition-colors ${
                          selected?.id === s.id
                            ? "border-accent bg-accent/10"
                            : "border-border hover:border-accent/50"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs truncate">
                            {s.name}
                          </span>
                          <span
                            className={`text-[9px] uppercase font-mono ${
                              s.scope === "personal"
                                ? "text-accent"
                                : s.scope === "project"
                                  ? "text-foreground/80"
                                  : "text-muted-foreground"
                            }`}
                          >
                            {s.scope}
                          </span>
                        </div>
                        {s.description && (
                          <p className="text-[10px] text-muted-foreground line-clamp-2 mt-0.5">
                            {s.description}
                          </p>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </aside>

        <div className="flex flex-col min-h-0">
          {selected ? (
            <>
              <div className="flex items-baseline justify-between gap-4 px-5 py-3 border-b border-border">
                <div className="flex items-baseline gap-3 min-w-0">
                  <span className="font-mono text-sm truncate">
                    {selected.name}
                  </span>
                  <span
                    className={`text-[10px] uppercase font-mono ${
                      selected.scope === "personal"
                        ? "text-accent"
                        : selected.scope === "project"
                          ? "text-foreground/80"
                          : "text-muted-foreground"
                    }`}
                  >
                    {selected.scope} · {selected.scopeLabel}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-muted-foreground truncate max-w-[320px]">
                    {selected.filePath}
                  </span>
                  <button
                    onClick={improve}
                    disabled={improving}
                    className="px-3 py-1.5 rounded-md border border-accent text-accent font-mono text-xs hover:bg-accent/10 disabled:opacity-50"
                  >
                    {improving ? "improving" : "improve with AI"}
                  </button>
                  <button
                    onClick={save}
                    disabled={!dirty || saving}
                    className="px-3 py-1.5 rounded-md border border-accent bg-accent text-accent-foreground font-mono text-xs hover:opacity-90 disabled:opacity-40"
                  >
                    {saving ? "saving" : dirty ? "save" : "saved"}
                  </button>
                </div>
              </div>
              {suggestion ? (
                <div className="flex-1 grid grid-cols-2 gap-0 min-h-0">
                  <div className="flex flex-col border-r border-border min-h-0">
                    <div className="px-4 py-2 border-b border-border flex items-center justify-between">
                      <span className="text-[10px] uppercase font-mono text-muted-foreground">
                        current
                      </span>
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {draft.length.toLocaleString()} chars
                      </span>
                    </div>
                    <pre className="flex-1 bg-zinc-950 text-foreground/80 font-mono text-xs p-5 overflow-auto whitespace-pre-wrap break-words">
                      {draft}
                    </pre>
                  </div>
                  <div className="flex flex-col min-h-0">
                    <div className="px-4 py-2 border-b border-border flex items-center justify-between gap-2">
                      <span className="text-[10px] uppercase font-mono text-accent">
                        suggestion
                      </span>
                      <div className="flex gap-2">
                        <button
                          onClick={discardSuggestion}
                          className="px-2 py-1 rounded border border-border text-[10px] font-mono text-muted-foreground hover:border-destructive hover:text-destructive"
                        >
                          discard
                        </button>
                        <button
                          onClick={acceptSuggestion}
                          className="px-2 py-1 rounded border border-accent bg-accent text-accent-foreground text-[10px] font-mono hover:opacity-90"
                        >
                          accept
                        </button>
                      </div>
                    </div>
                    <pre className="flex-1 bg-zinc-950 text-foreground font-mono text-xs p-5 overflow-auto whitespace-pre-wrap break-words">
                      {suggestion}
                    </pre>
                  </div>
                </div>
              ) : (
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className="flex-1 bg-zinc-950 text-foreground font-mono text-sm p-5 resize-none focus:outline-none whitespace-pre"
                  spellCheck={false}
                />
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-xs font-mono text-muted-foreground">
              select a skill to edit
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function scopeId(s: Scope): string {
  return `${s.scope}::${s.label}`;
}

function scopeLabel(s: Scope): string {
  return `${s.scope} · ${s.label}`;
}
