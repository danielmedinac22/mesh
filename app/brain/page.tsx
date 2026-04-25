"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell, MESH, Pill } from "@/components/mesh";

type BrainEntryKind = "note" | "meeting" | "ticket" | "link";

type BrainEntry = {
  id: string;
  kind: BrainEntryKind;
  body: string;
  title?: string;
  source?: string;
  ref?: string;
  url?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

type BrainResponse = {
  entries: BrainEntry[];
  updatedAt: string;
};

const KINDS: { id: BrainEntryKind | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "note", label: "Notes" },
  { id: "meeting", label: "Meetings" },
  { id: "ticket", label: "Tickets" },
  { id: "link", label: "Links" },
];

export default function BrainPage() {
  const [entries, setEntries] = useState<BrainEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<BrainEntryKind | "all">("all");

  const [body, setBody] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/brain", { cache: "no-store" });
      const json = (await res.json()) as BrainResponse;
      setEntries(json.entries ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (filter === "all") return entries;
    return entries.filter((e) => e.kind === filter);
  }, [entries, filter]);

  const submit = useCallback(async () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      const tags = tagsInput
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await fetch("/api/brain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "note",
          body: trimmed,
          title: title.trim() || undefined,
          tags,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      setBody("");
      setTagsInput("");
      setTitle("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [body, tagsInput, title, load]);

  const remove = useCallback(
    async (id: string) => {
      try {
        await fetch(`/api/brain?id=${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [load],
  );

  return (
    <AppShell
      title="Brain"
      subtitle="Cross-project context that gets injected into every ticket plan"
    >
      <div
        style={{
          maxWidth: 880,
          width: "100%",
          margin: "0 auto",
          padding: "24px 24px 48px",
          display: "flex",
          flexDirection: "column",
          gap: 24,
        }}
      >
        {/* Compose */}
        <section
          className="mesh-bracket-wrap"
          style={{
            border: `1px solid ${MESH.border}`,
            background: MESH.bgElev,
            padding: 18,
            display: "flex",
            flexDirection: "column",
            gap: 12,
            position: "relative",
          }}
        >
          <span className="mesh-bracket-bl" />
          <span className="mesh-bracket-br" />
          <div style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 4 }}>
            <span
              aria-hidden
              style={{ width: 4, height: 14, background: MESH.amber, borderRadius: 1 }}
            />
            <span className="mesh-hud" style={{ color: MESH.fgDim }}>
              NEW NOTE
            </span>
          </div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Optional title (e.g. 'Auth migration decision')"
            style={inputStyle}
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What context should Mesh remember across every ticket?"
            rows={4}
            style={{
              ...inputStyle,
              fontFamily: "inherit",
              resize: "vertical",
              lineHeight: 1.5,
            }}
          />
          <input
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="tags, comma-separated (e.g. auth, billing, ops)"
            style={inputStyle}
          />
          {error && (
            <div
              className="font-mono"
              style={{
                fontSize: 11,
                color: MESH.red,
                padding: "6px 8px",
                background: "rgba(229,72,77,0.08)",
                borderRadius: 4,
              }}
            >
              {error}
            </div>
          )}
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button
              type="button"
              disabled={saving || !body.trim()}
              onClick={submit}
              style={{
                padding: "8px 14px",
                borderRadius: 6,
                background: MESH.amber,
                border: `1px solid ${MESH.amber}`,
                color: "#0B0B0C",
                fontSize: 12,
                fontWeight: 600,
                cursor: saving || !body.trim() ? "not-allowed" : "pointer",
                opacity: saving || !body.trim() ? 0.5 : 1,
              }}
            >
              {saving ? "Saving…" : "Save note"}
            </button>
            <span
              className="font-mono"
              style={{ fontSize: 10.5, color: MESH.fgMute }}
            >
              Stored at .mesh/user/brain.json — injected into every ticket prompt as cached system context.
            </span>
          </div>
        </section>

        {/* Filters */}
        <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {KINDS.map((k) => {
                const active = filter === k.id;
                return (
                  <button
                    key={k.id}
                    type="button"
                    onClick={() => setFilter(k.id)}
                    style={{
                      padding: "5px 10px",
                      borderRadius: 999,
                      background: active ? "rgba(245,165,36,0.1)" : "transparent",
                      border: `1px solid ${active ? "rgba(245,165,36,0.4)" : MESH.border}`,
                      color: active ? MESH.amber : MESH.fgDim,
                      fontSize: 11.5,
                      cursor: "pointer",
                      fontWeight: active ? 500 : 400,
                    }}
                  >
                    {k.label}
                  </button>
                );
              })}
            </div>
            <span
              className="font-mono"
              style={{ fontSize: 10.5, color: MESH.fgMute }}
            >
              {entries.length} {entries.length === 1 ? "entry" : "entries"}
            </span>
          </div>

          {/* List */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {loading && (
              <div
                className="font-mono"
                style={{ fontSize: 12, color: MESH.fgMute, padding: 16 }}
              >
                Loading brain…
              </div>
            )}
            {!loading && filtered.length === 0 && (
              <div
                style={{
                  padding: 24,
                  borderRadius: 8,
                  border: `1px dashed ${MESH.border}`,
                  background: MESH.bg,
                  color: MESH.fgMute,
                  fontSize: 13,
                  textAlign: "center",
                  lineHeight: 1.6,
                }}
              >
                {entries.length === 0
                  ? "Your brain is empty. Add notes about decisions, recurring patterns, or context Mesh should remember."
                  : `No ${filter} entries yet.`}
              </div>
            )}
            {filtered.map((e) => (
              <BrainEntryCard key={e.id} entry={e} onRemove={() => remove(e.id)} />
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function BrainEntryCard({
  entry,
  onRemove,
}: {
  entry: BrainEntry;
  onRemove: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <article
      style={{
        padding: "14px 16px",
        borderRadius: 8,
        border: `1px solid ${MESH.border}`,
        background: MESH.bgElev,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Pill tone={kindTone(entry.kind)}>{entry.kind}</Pill>
        {entry.source && (
          <span
            className="font-mono"
            style={{ fontSize: 10.5, color: MESH.fgMute }}
          >
            via {entry.source}
          </span>
        )}
        {entry.title && (
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: MESH.fg,
              letterSpacing: "-0.01em",
            }}
          >
            {entry.title}
          </span>
        )}
        <span
          className="font-mono"
          style={{
            marginLeft: "auto",
            fontSize: 10.5,
            color: MESH.fgMute,
          }}
        >
          {timeAgo(entry.createdAt)}
        </span>
        <button
          type="button"
          onClick={() => {
            if (confirming) onRemove();
            else {
              setConfirming(true);
              setTimeout(() => setConfirming(false), 2500);
            }
          }}
          className="font-mono"
          style={{
            background: "transparent",
            border: "none",
            color: confirming ? MESH.red : MESH.fgMute,
            fontSize: confirming ? 10 : 14,
            cursor: "pointer",
            padding: "0 4px",
          }}
        >
          {confirming ? "ok?" : "×"}
        </button>
      </div>
      {entry.body && (
        <p
          style={{
            margin: 0,
            color: MESH.fgDim,
            fontSize: 13,
            lineHeight: 1.55,
            whiteSpace: "pre-wrap",
          }}
        >
          {entry.body}
        </p>
      )}
      {entry.url && (
        <a
          href={entry.url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono"
          style={{ fontSize: 11, color: MESH.amber }}
        >
          {entry.url}
        </a>
      )}
      {entry.tags.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {entry.tags.map((t) => (
            <span
              key={t}
              className="font-mono"
              style={{
                fontSize: 10.5,
                color: MESH.fgMute,
                padding: "2px 7px",
                background: MESH.bg,
                border: `1px solid ${MESH.border}`,
                borderRadius: 999,
              }}
            >
              {t}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

function kindTone(kind: BrainEntryKind): "amber" | "green" | "dim" {
  switch (kind) {
    case "meeting":
      return "amber";
    case "ticket":
      return "green";
    case "link":
      return "dim";
    default:
      return "amber";
  }
}

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (!t) return "";
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

const inputStyle: React.CSSProperties = {
  padding: "9px 11px",
  background: MESH.bgInput,
  border: `1px solid ${MESH.border}`,
  borderRadius: 6,
  color: MESH.fg,
  fontSize: 13,
  outline: "none",
};
