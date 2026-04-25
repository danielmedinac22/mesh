"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell, MESH, Pill } from "@/components/mesh";
import { Dot } from "@/components/mesh/pill";
import {
  PROJECT_COLOR_MAP,
  type ProjectColor,
} from "@/components/mesh/project-switcher";

type ProjectRecord = {
  id: string;
  name: string;
  label?: string;
  color: ProjectColor;
  description?: string;
  repos: string[];
  createdAt: string;
  updatedAt: string;
};

type ProjectsResponse = {
  projects: ProjectRecord[];
  currentProjectId: string | null;
};

const COLORS: ProjectColor[] = ["amber", "violet", "blue", "green", "red", "slate"];

export default function ProjectsManagePage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [label, setLabel] = useState("");
  const [color, setColor] = useState<ProjectColor>("amber");
  const [description, setDescription] = useState("");
  const [createBusy, setCreateBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/projects", { cache: "no-store" });
      const json = (await res.json()) as ProjectsResponse;
      setProjects(json.projects ?? []);
      setCurrentProjectId(json.currentProjectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const current = useMemo(
    () => projects.find((p) => p.id === currentProjectId) ?? null,
    [projects, currentProjectId],
  );
  const others = useMemo(
    () => projects.filter((p) => p.id !== currentProjectId),
    [projects, currentProjectId],
  );

  const select = useCallback(
    async (id: string) => {
      if (id === currentProjectId) return;
      setBusyId(id);
      try {
        await fetch(`/api/projects/${encodeURIComponent(id)}/select`, {
          method: "POST",
        });
        await load();
        router.refresh();
      } finally {
        setBusyId(null);
      }
    },
    [currentProjectId, load, router],
  );

  const submitCreate = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setCreateBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          label: label.trim() || undefined,
          color,
          description: description.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data?.error === "string" ? data.error : "create failed");
        return;
      }
      setName("");
      setLabel("");
      setDescription("");
      setColor("amber");
      setCreating(false);
      await load();
      router.refresh();
    } finally {
      setCreateBusy(false);
    }
  }, [name, label, color, description, load, router]);

  return (
    <AppShell
      title="Projects"
      subtitle="Manage every project in your workspace"
    >
      <div
        style={{
          maxWidth: 960,
          width: "100%",
          margin: "0 auto",
          padding: "24px 24px 64px",
          display: "flex",
          flexDirection: "column",
          gap: 28,
        }}
      >
        {error && (
          <div
            className="font-mono"
            style={{
              fontSize: 12,
              padding: 10,
              borderRadius: 6,
              border: `1px solid rgba(229,72,77,0.3)`,
              background: "rgba(229,72,77,0.06)",
              color: MESH.red,
            }}
          >
            {error}
          </div>
        )}

        {/* Current project — highlighted card */}
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <SectionHeader
            title="Current project"
            kicker={current ? "active across the workspace" : "no project selected"}
          />
          {loading && (
            <div
              className="font-mono"
              style={{ fontSize: 12, color: MESH.fgMute, padding: 12 }}
            >
              Loading…
            </div>
          )}
          {!loading && !current && (
            <div
              style={{
                padding: 24,
                borderRadius: 10,
                border: `1px dashed ${MESH.border}`,
                background: MESH.bg,
                color: MESH.fgDim,
                fontSize: 13,
                lineHeight: 1.55,
                textAlign: "center",
              }}
            >
              You don&apos;t have a project yet. Create one below to enable Connect,
              Build and Ship.
            </div>
          )}
          {current && <CurrentProjectCard project={current} />}
        </section>

        {/* Other projects + create */}
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <SectionHeader
              title={others.length > 0 ? "Other projects" : "Add a project"}
              kicker={
                others.length > 0
                  ? `${others.length} ${others.length === 1 ? "project" : "projects"}`
                  : "create your next workspace"
              }
            />
            <span style={{ flex: 1 }} />
            {!creating && (
              <button
                type="button"
                onClick={() => setCreating(true)}
                style={{
                  padding: "7px 14px",
                  borderRadius: 6,
                  background: MESH.amber,
                  border: `1px solid ${MESH.amber}`,
                  color: "#0B0B0C",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                + New project
              </button>
            )}
          </div>

          {creating && (
            <div
              style={{
                padding: 16,
                borderRadius: 10,
                border: `1px solid ${MESH.borderHi}`,
                background: MESH.bgElev,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Project name (e.g. flare-bill)"
                style={inputStyle}
              />
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Label (optional, e.g. SaaS billing)"
                style={inputStyle}
              />
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Short description for context (optional)"
                rows={2}
                style={{ ...inputStyle, fontFamily: "inherit", resize: "vertical", lineHeight: 1.5 }}
              />
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span
                  className="font-mono"
                  style={{
                    fontSize: 10,
                    color: MESH.fgMute,
                    textTransform: "uppercase",
                    letterSpacing: "0.14em",
                    marginRight: 6,
                  }}
                >
                  Color
                </span>
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    aria-label={`color ${c}`}
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 999,
                      background: PROJECT_COLOR_MAP[c],
                      border:
                        color === c
                          ? `2px solid ${MESH.fg}`
                          : `2px solid transparent`,
                      cursor: "pointer",
                      padding: 0,
                    }}
                  />
                ))}
                <span style={{ flex: 1 }} />
                <button
                  type="button"
                  onClick={() => {
                    setCreating(false);
                    setError(null);
                  }}
                  disabled={createBusy}
                  style={{
                    padding: "6px 12px",
                    fontSize: 12,
                    background: "transparent",
                    border: `1px solid ${MESH.border}`,
                    borderRadius: 5,
                    color: MESH.fgDim,
                    cursor: createBusy ? "not-allowed" : "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submitCreate}
                  disabled={createBusy || !name.trim()}
                  style={{
                    padding: "6px 14px",
                    fontSize: 12,
                    fontWeight: 600,
                    background: MESH.amber,
                    border: `1px solid ${MESH.amber}`,
                    borderRadius: 5,
                    color: "#0B0B0C",
                    cursor: createBusy || !name.trim() ? "not-allowed" : "pointer",
                    opacity: createBusy || !name.trim() ? 0.5 : 1,
                  }}
                >
                  {createBusy ? "Creating…" : "Create project"}
                </button>
              </div>
            </div>
          )}

          {!loading && others.length > 0 && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                gap: 10,
              }}
            >
              {others.map((p) => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  busy={busyId === p.id}
                  onSelect={() => select(p.id)}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function CurrentProjectCard({ project }: { project: ProjectRecord }) {
  return (
    <div
      style={{
        padding: 18,
        borderRadius: 10,
        border: `1px solid rgba(245,165,36,0.4)`,
        background: "rgba(245,165,36,0.04)",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Dot color={PROJECT_COLOR_MAP[project.color]} size={10} />
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
          <div
            className="mesh-display"
            style={{
              fontSize: 32,
              letterSpacing: "-0.02em",
              color: MESH.fg,
              lineHeight: 1,
            }}
          >
            {project.name}
          </div>
          {project.label && (
            <div className="mesh-hud" style={{ color: MESH.fgMute }}>
              {project.label}
            </div>
          )}
        </div>
        <Pill tone="amber">current</Pill>
      </div>
      {project.description && (
        <p
          style={{
            margin: 0,
            fontSize: 13,
            color: MESH.fgDim,
            lineHeight: 1.55,
          }}
        >
          {project.description}
        </p>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link href={`/projects/${encodeURIComponent(project.id)}`} style={primaryLink}>
          Open project →
        </Link>
        <Link href="/connect" style={secondaryLink}>
          Connect repos
        </Link>
        <Link href="/build" style={secondaryLink}>
          Build
        </Link>
        <Link href="/ship" style={secondaryLink}>
          Ship
        </Link>
      </div>
      <div
        className="font-mono"
        style={{ fontSize: 10.5, color: MESH.fgMute }}
      >
        {project.repos.length} {project.repos.length === 1 ? "repo" : "repos"}
        {" · "}
        updated {timeAgo(project.updatedAt)}
      </div>
    </div>
  );
}

function ProjectCard({
  project,
  busy,
  onSelect,
}: {
  project: ProjectRecord;
  busy: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      style={{
        padding: 14,
        borderRadius: 10,
        border: `1px solid ${MESH.border}`,
        background: MESH.bgElev,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        opacity: busy ? 0.55 : 1,
        transition: "opacity 120ms",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Dot color={PROJECT_COLOR_MAP[project.color]} size={7} />
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              color: MESH.fg,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {project.name}
          </div>
          {project.label && (
            <div
              className="font-mono"
              style={{
                fontSize: 10.5,
                color: MESH.fgMute,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {project.label}
            </div>
          )}
        </div>
        <span
          className="font-mono"
          style={{ fontSize: 10.5, color: MESH.fgMute }}
        >
          {project.repos.length}
        </span>
      </div>
      {project.description && (
        <p
          style={{
            margin: 0,
            fontSize: 12,
            color: MESH.fgDim,
            lineHeight: 1.5,
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          }}
        >
          {project.description}
        </p>
      )}
      <div style={{ display: "flex", gap: 6 }}>
        <Link
          href={`/projects/${encodeURIComponent(project.id)}`}
          style={smallLinkStyle}
        >
          Open
        </Link>
        <button
          type="button"
          disabled={busy}
          onClick={onSelect}
          style={{
            ...smallButtonStyle,
            color: busy ? MESH.fgMute : MESH.amber,
            borderColor: busy ? MESH.border : "rgba(245,165,36,0.4)",
          }}
        >
          {busy ? "Switching…" : "Set current"}
        </button>
      </div>
    </div>
  );
}

function SectionHeader({
  title,
  kicker,
}: {
  title: string;
  kicker?: string;
}) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 10,
        flexWrap: "wrap",
      }}
    >
      <h2
        className="mesh-display"
        style={{
          margin: 0,
          fontSize: 28,
          letterSpacing: "-0.02em",
          color: MESH.fg,
          lineHeight: 1,
        }}
      >
        {title}
      </h2>
      {kicker && (
        <span className="mesh-hud" style={{ color: MESH.fgMute }}>
          {kicker}
        </span>
      )}
    </header>
  );
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

const primaryLink: React.CSSProperties = {
  padding: "7px 14px",
  borderRadius: 6,
  background: MESH.amber,
  color: "#0B0B0C",
  fontSize: 12,
  fontWeight: 600,
  textDecoration: "none",
};

const secondaryLink: React.CSSProperties = {
  padding: "7px 12px",
  borderRadius: 6,
  background: "transparent",
  border: `1px solid ${MESH.border}`,
  color: MESH.fgDim,
  fontSize: 12,
  textDecoration: "none",
};

const smallLinkStyle: React.CSSProperties = {
  padding: "5px 10px",
  borderRadius: 5,
  background: "transparent",
  border: `1px solid ${MESH.border}`,
  color: MESH.fgDim,
  fontSize: 11.5,
  textDecoration: "none",
};

const smallButtonStyle: React.CSSProperties = {
  padding: "5px 10px",
  borderRadius: 5,
  background: "transparent",
  border: `1px solid ${MESH.border}`,
  fontSize: 11.5,
  cursor: "pointer",
};
