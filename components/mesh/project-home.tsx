"use client";

import Link from "next/link";
import { MESH } from "./tokens";
import { Pill, Dot } from "./pill";
import { ThinkingPanelRaw } from "./thinking-panel";
import { PROJECT_COLOR_MAP, type ProjectColor } from "./project-switcher";
import { ProjectGraph, type RepoRelationship } from "./project-graph";

export type ProjectHomeProject = {
  id: string;
  name: string;
  label?: string;
  color: ProjectColor;
  description?: string;
  repos: string[];
};

export type ProjectHomeRepo = {
  name: string;
  defaultBranch: string;
  tokensEst?: number;
};

export type ProjectHomeRepoBrief = {
  name: string;
  purpose: string;
  cross_repo_role: string;
};

export type ProjectHomeBrief = {
  description: string;
  relationships: RepoRelationship[];
  generated_at?: string;
};

export type ProjectHomeMemory = {
  repos: { name: string; brief?: ProjectHomeRepoBrief; invariants: unknown[] }[];
  invariants: unknown[];
  cross_repo_flows: unknown[];
  project_brief?: ProjectHomeBrief;
} | null;

export type ProjectHomeProps = {
  project: ProjectHomeProject;
  repos: ProjectHomeRepo[];
  memory: ProjectHomeMemory;
  briefStatus: "idle" | "streaming" | "done" | "error";
  briefThinking: string;
  briefError: string | null;
  onGenerateBrief: () => void;
  onAddRepos: () => void;
  addReposLabel?: string;
};

export function ProjectHome({
  project,
  repos,
  memory,
  briefStatus,
  briefThinking,
  briefError,
  onGenerateBrief,
  onAddRepos,
  addReposLabel = "Add repos →",
}: ProjectHomeProps) {
  const brief = memory?.project_brief;
  const relationships = brief?.relationships ?? [];
  const invariants =
    (memory?.invariants?.length ?? 0) +
    (memory?.repos?.reduce((n, r) => n + (r.invariants?.length ?? 0), 0) ?? 0);
  const flows = memory?.cross_repo_flows?.length ?? 0;
  const briefsByRepo = new Map<string, ProjectHomeRepoBrief>();
  for (const r of memory?.repos ?? []) {
    if (r.brief) briefsByRepo.set(r.name, r.brief);
  }
  const projectColor = PROJECT_COLOR_MAP[project.color];
  const streaming = briefStatus === "streaming";

  return (
    <div
      style={{
        flex: 1,
        overflow: "auto",
        padding: "20px 32px 48px",
        display: "flex",
        flexDirection: "column",
        gap: 24,
      }}
    >
      {/* Topbar */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <div>
          <div
            className="font-mono"
            style={{
              fontSize: 10,
              color: MESH.fgMute,
              textTransform: "uppercase",
              letterSpacing: "0.14em",
              marginBottom: 6,
            }}
          >
            Project
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Dot color={projectColor} size={10} />
            <h1
              style={{
                margin: 0,
                fontSize: 26,
                fontWeight: 600,
                letterSpacing: "-0.02em",
                color: MESH.fg,
              }}
            >
              {project.name}
            </h1>
            {project.label && <Pill tone="dim">{project.label}</Pill>}
          </div>
          <div
            className="font-mono"
            style={{
              fontSize: 11,
              color: MESH.fgMute,
              marginTop: 6,
              letterSpacing: "0.02em",
            }}
          >
            {repos.length} repos · {invariants} invariants · {flows} cross-repo flows
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            type="button"
            onClick={onGenerateBrief}
            disabled={streaming || repos.length === 0}
            style={{
              padding: "7px 12px",
              background: "transparent",
              border: `1px solid ${MESH.border}`,
              borderRadius: 6,
              color: streaming ? MESH.fgMute : MESH.fgDim,
              fontSize: 12,
              cursor: streaming
                ? "wait"
                : repos.length === 0
                  ? "not-allowed"
                  : "pointer",
              opacity: repos.length === 0 ? 0.5 : 1,
            }}
          >
            {streaming
              ? "Regenerating…"
              : brief
                ? "Regenerate brief"
                : "Generate brief"}
          </button>
          <button
            type="button"
            onClick={onAddRepos}
            style={{
              padding: "7px 14px",
              background: MESH.amber,
              border: `1px solid ${MESH.amber}`,
              borderRadius: 6,
              color: "#0B0B0C",
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {addReposLabel}
          </button>
          <Pill tone="amber">Opus 4.7 · 1M</Pill>
        </div>
      </div>

      {/* Hero: description */}
      {brief?.description ? (
        <div
          style={{
            padding: 22,
            borderRadius: 10,
            background: MESH.bgElev,
            border: `1px solid ${MESH.border}`,
          }}
        >
          <div
            className="font-mono"
            style={{
              fontSize: 10,
              color: MESH.fgMute,
              textTransform: "uppercase",
              letterSpacing: "0.14em",
              marginBottom: 10,
            }}
          >
            Brief
          </div>
          <p
            style={{
              margin: 0,
              fontSize: 14,
              lineHeight: 1.65,
              color: MESH.fg,
              maxWidth: 820,
            }}
          >
            {brief.description}
          </p>
          {brief.generated_at && (
            <div
              className="font-mono"
              style={{
                fontSize: 10,
                color: MESH.fgMute,
                marginTop: 10,
                letterSpacing: "0.02em",
              }}
            >
              generated {timeAgo(brief.generated_at)}
            </div>
          )}
        </div>
      ) : (
        <div
          style={{
            padding: 22,
            borderRadius: 10,
            background: MESH.bgElev,
            border: `1px dashed ${MESH.border}`,
          }}
        >
          {streaming ? (
            <ThinkingPanelRaw
              text={briefThinking}
              active
              placeholder="Claude is writing the project brief…"
            />
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 16,
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: MESH.fg,
                    marginBottom: 4,
                  }}
                >
                  No brief yet
                </div>
                <div
                  className="font-mono"
                  style={{ fontSize: 12, color: MESH.fgDim }}
                >
                  {repos.length === 0
                    ? "Add at least one repo first."
                    : "Claude will describe how these repos relate."}
                </div>
              </div>
              {repos.length > 0 && (
                <button
                  type="button"
                  onClick={onGenerateBrief}
                  style={{
                    padding: "8px 14px",
                    background: MESH.amber,
                    color: "#0B0B0C",
                    border: `1px solid ${MESH.amber}`,
                    borderRadius: 6,
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Generate brief →
                </button>
              )}
            </div>
          )}
          {briefError && (
            <div
              className="font-mono"
              style={{ fontSize: 11, color: MESH.red, marginTop: 10 }}
            >
              {briefError}
            </div>
          )}
        </div>
      )}

      {/* Main two-col */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 20,
          alignItems: "stretch",
        }}
      >
        {/* Repos list */}
        <div
          style={{
            padding: 18,
            borderRadius: 10,
            background: MESH.bgElev,
            border: `1px solid ${MESH.border}`,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
            }}
          >
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: MESH.fg,
              }}
            >
              Repos
            </div>
            <span
              className="font-mono"
              style={{ fontSize: 10, color: MESH.fgMute }}
            >
              {repos.length}
            </span>
          </div>
          {repos.length === 0 ? (
            <div
              style={{
                padding: "30px 0",
                textAlign: "center",
              }}
            >
              <div
                className="font-mono"
                style={{
                  fontSize: 12,
                  color: MESH.fgMute,
                  marginBottom: 12,
                }}
              >
                No repos connected yet.
              </div>
              <button
                type="button"
                onClick={onAddRepos}
                style={{
                  padding: "8px 14px",
                  background: MESH.amber,
                  color: "#0B0B0C",
                  border: `1px solid ${MESH.amber}`,
                  borderRadius: 6,
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Add your first repo →
              </button>
            </div>
          ) : (
            <ul
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {repos.map((r) => {
                const rb = briefsByRepo.get(r.name);
                return (
                  <li key={r.name}>
                    <Link
                      href={`/repos/${encodeURIComponent(r.name)}`}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 3,
                        padding: "10px 12px",
                        borderRadius: 6,
                        background: MESH.bg,
                        border: `1px solid ${MESH.border}`,
                        textDecoration: "none",
                        color: MESH.fg,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <Dot color={projectColor} size={6} />
                        <span
                          className="font-mono"
                          style={{
                            fontSize: 12,
                            color: MESH.fg,
                          }}
                        >
                          {r.name}
                        </span>
                        <span
                          className="font-mono"
                          style={{
                            fontSize: 10,
                            color: MESH.fgMute,
                            marginLeft: "auto",
                          }}
                        >
                          {r.tokensEst
                            ? `${Math.round(r.tokensEst / 1000)}k`
                            : r.defaultBranch}
                        </span>
                      </div>
                      {rb && (
                        <div
                          className="font-mono"
                          style={{
                            fontSize: 11,
                            color: MESH.fgDim,
                            lineHeight: 1.5,
                            paddingLeft: 14,
                          }}
                        >
                          {rb.cross_repo_role || rb.purpose}
                        </div>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          {repos.length > 0 && (
            <div
              style={{
                paddingTop: 8,
                marginTop: 4,
                borderTop: `1px solid ${MESH.border}`,
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <Link
                href="/repos"
                className="font-mono"
                style={{
                  fontSize: 11,
                  color: MESH.fgDim,
                  textDecoration: "none",
                  letterSpacing: "0.02em",
                }}
              >
                Manage all repos →
              </Link>
              <span
                className="font-mono"
                style={{
                  fontSize: 10.5,
                  color: MESH.fgMute,
                  marginLeft: "auto",
                }}
              >
                env vars · branches · remove
              </span>
            </div>
          )}
        </div>

        {/* Graph */}
        <div
          style={{
            padding: 18,
            borderRadius: 10,
            background:
              "radial-gradient(60% 60% at 50% 40%, rgba(245,165,36,0.05) 0%, rgba(11,11,12,0) 70%), #0C0C0E",
            border: `1px solid ${MESH.border}`,
            position: "relative",
            minHeight: 360,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              marginBottom: 6,
            }}
          >
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: MESH.fg,
              }}
            >
              Relationships
            </div>
            <span
              className="font-mono"
              style={{ fontSize: 10, color: MESH.fgMute }}
            >
              {relationships.length}
            </span>
          </div>
          <div style={{ flex: 1, display: "flex" }}>
            {repos.length === 0 ? (
              <div
                className="font-mono"
                style={{
                  margin: "auto",
                  fontSize: 11,
                  color: MESH.fgMute,
                }}
              >
                graph will appear here
              </div>
            ) : relationships.length === 0 ? (
              <div style={{ margin: "auto", textAlign: "center" }}>
                <div
                  className="font-mono"
                  style={{
                    fontSize: 11,
                    color: MESH.fgMute,
                    marginBottom: 8,
                  }}
                >
                  {streaming ? "building graph…" : "no relationships yet"}
                </div>
              </div>
            ) : (
              <ProjectGraph
                repos={repos.map((r) => r.name)}
                relationships={relationships}
                height={340}
              />
            )}
          </div>
        </div>
      </div>

      {/* Relationships list */}
      {relationships.length > 0 && (
        <div
          style={{
            padding: 18,
            borderRadius: 10,
            background: MESH.bgElev,
            border: `1px solid ${MESH.border}`,
          }}
        >
          <div
            className="font-mono"
            style={{
              fontSize: 10,
              color: MESH.fgMute,
              textTransform: "uppercase",
              letterSpacing: "0.14em",
              marginBottom: 10,
            }}
          >
            How the repos connect
          </div>
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            {relationships.map((r, i) => (
              <li
                key={i}
                className="font-mono"
                style={{
                  fontSize: 12,
                  color: MESH.fgDim,
                  padding: "6px 0",
                  borderBottom:
                    i === relationships.length - 1
                      ? undefined
                      : `1px solid ${MESH.border}`,
                }}
              >
                <span style={{ color: MESH.fg }}>{r.from}</span>
                <span style={{ color: MESH.fgMute, margin: "0 6px" }}>
                  {r.kind} →
                </span>
                <span style={{ color: MESH.fg }}>{r.to}</span>
                {r.note && (
                  <span style={{ color: MESH.fgMute, marginLeft: 8 }}>
                    · {r.note}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function timeAgo(iso: string): string {
  try {
    const then = new Date(iso).getTime();
    const delta = Date.now() - then;
    const mins = Math.round(delta / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.round(hrs / 24);
    return `${days}d ago`;
  } catch {
    return iso;
  }
}
