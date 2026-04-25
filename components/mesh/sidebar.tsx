"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { MESH } from "./tokens";
import { MeshMark, NavIcon, type IconKind } from "./icons";
import { Dot } from "./pill";
import { emitReposChanged, useReposRefresh } from "./use-repos-refresh";
import {
  ProjectSwitcher,
  PROJECT_COLOR_MAP,
  type ProjectColor,
  type ProjectSummary,
} from "./project-switcher";

export const SIDEBAR_W = 260;

export type SidebarRepo = {
  name: string;
  branch: string;
  changes: string;
  engine?: string;
  tokensEst?: number;
};

const NAV: { id: IconKind; label: string; href: string }[] = [
  { id: "home", label: "Home", href: "/" },
  { id: "connect", label: "Connect", href: "/connect" },
  { id: "build", label: "Build", href: "/build" },
  { id: "ship", label: "Ship", href: "/ship" },
  { id: "settings", label: "Settings", href: "/settings" },
];

type BranchesResponse = {
  repos: {
    repoName: string;
    currentBranch: string;
    changedFiles: number;
    clean: boolean;
  }[];
};

type ReposResponse = {
  repos: {
    name: string;
    defaultBranch: string;
    tokensEst?: number;
    projectId?: string;
  }[];
  projectId: string | null;
};

type ProjectsResponse = {
  projects: {
    id: string;
    name: string;
    label?: string;
    color: ProjectColor;
    repos: string[];
  }[];
  currentProjectId: string | null;
};

function kFormat(n: number | undefined): string {
  if (!n || n <= 0) return "";
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "")}k`;
  return String(n);
}

export function Sidebar({
  repos,
}: {
  repos?: SidebarRepo[];
}) {
  const pathname = usePathname();
  const [fallback, setFallback] = useState<SidebarRepo[] | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);

  const shouldAutoFetch = repos === undefined;

  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/projects", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as ProjectsResponse;
      setProjects(
        (data.projects ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          label: p.label,
          color: p.color,
          repoCount: p.repos.length,
        })),
      );
      setCurrentProjectId(data.currentProjectId);
    } catch {
      // silent
    }
  }, []);

  const loadFallback = useCallback(async () => {
    try {
      const [branchesRes, reposRes] = await Promise.all([
        fetch("/api/branches", { cache: "no-store" }),
        fetch("/api/repos", { cache: "no-store" }),
      ]);
      const branchesData: BranchesResponse = branchesRes.ok
        ? await branchesRes.json()
        : { repos: [] };
      const reposData: ReposResponse = reposRes.ok
        ? await reposRes.json()
        : { repos: [], projectId: null };

      const tokensByName = new Map<string, number | undefined>();
      for (const r of reposData.repos) tokensByName.set(r.name, r.tokensEst);
      const scopedNames = new Set(reposData.repos.map((r) => r.name));
      const filteredBranches = branchesData.repos.filter((r) =>
        scopedNames.has(r.repoName),
      );

      setFallback(
        filteredBranches.map((r) => ({
          name: r.repoName,
          branch: r.currentBranch,
          changes: r.clean ? "clean" : `${r.changedFiles} changes, 0 pushed`,
          tokensEst: tokensByName.get(r.repoName),
        })),
      );
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    void loadProjects();
    if (shouldAutoFetch) void loadFallback();
  }, [shouldAutoFetch, loadFallback, loadProjects]);

  useReposRefresh(
    useCallback(() => {
      void loadProjects();
      if (shouldAutoFetch) void loadFallback();
    }, [shouldAutoFetch, loadFallback, loadProjects]),
  );

  const list: SidebarRepo[] = repos ?? fallback ?? [];

  return (
    <aside
      style={{
        width: SIDEBAR_W,
        flexShrink: 0,
        background: MESH.bg,
        borderRight: `1px solid ${MESH.border}`,
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        color: MESH.fg,
        position: "sticky",
        top: 0,
      }}
    >
      {/* Brand */}
      <Link
        href="/"
        style={{
          padding: "20px 20px 16px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          textDecoration: "none",
          color: "inherit",
        }}
      >
        <MeshMark size={18} color={MESH.fg} />
        <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.02em" }}>Mesh</span>
        <span
          className="font-mono"
          style={{ marginLeft: "auto", fontSize: 10, color: MESH.fgMute, letterSpacing: "0.02em" }}
        >
          v0.4.2
        </span>
      </Link>

      {/* Project switcher */}
      <ProjectSwitcher
        projects={projects}
        currentId={currentProjectId}
        onChanged={() => {
          void loadProjects();
          if (shouldAutoFetch) void loadFallback();
          emitReposChanged();
        }}
      />
      {currentProjectId && (
        <div style={{ padding: "6px 18px 0" }}>
          <Link
            href={`/projects/${encodeURIComponent(currentProjectId)}`}
            className="font-mono"
            style={{
              fontSize: 10.5,
              color:
                pathname === `/projects/${currentProjectId}`
                  ? MESH.amber
                  : MESH.fgDim,
              textDecoration: "none",
              letterSpacing: "0.02em",
            }}
          >
            Open project →
          </Link>
        </div>
      )}

      {/* Repos in current project */}
      <div
        style={{
          padding: "16px 12px 4px",
          overflowY: "auto",
          flexShrink: 1,
          maxHeight: "calc(100vh - 440px)",
        }}
      >
        <div
          className="font-mono"
          style={{
            fontSize: 10,
            color: MESH.fgMute,
            textTransform: "uppercase",
            letterSpacing: "0.14em",
            marginBottom: 6,
            padding: "0 6px",
          }}
        >
          Repos {list.length ? `· ${list.length}` : ""}
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {list.length === 0 && (
            <div
              className="font-mono"
              style={{ fontSize: 11, color: MESH.fgMute, padding: "6px 8px" }}
            >
              {currentProjectId ? "No repos yet" : "No project selected"}
            </div>
          )}
          {list.map((r) => (
            <WorkspaceRow
              key={r.name}
              repo={r}
              projectColor={
                projects.find((p) => p.id === currentProjectId)?.color ?? "amber"
              }
            />
          ))}
        </div>
      </div>

      {/* Nav */}
      <div style={{ padding: "20px 12px 0", marginTop: "auto" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {NAV.map((n) => {
            const isActive =
              n.href === "/" ? pathname === "/" : pathname?.startsWith(n.href);
            return (
              <Link
                key={n.id}
                href={n.href}
                style={{
                  padding: "8px 10px",
                  borderRadius: 5,
                  background: isActive ? "rgba(245,165,36,0.08)" : "transparent",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  fontSize: 13,
                  color: isActive ? MESH.amber : MESH.fgDim,
                  fontWeight: isActive ? 500 : 400,
                  borderLeft: `2px solid ${isActive ? MESH.amber : "transparent"}`,
                  paddingLeft: 10,
                  textDecoration: "none",
                  transition: "background 120ms, color 120ms",
                }}
              >
                <NavIcon kind={n.id} color={isActive ? MESH.amber : MESH.fgDim} size={13} />
                <span>{n.label}</span>
              </Link>
            );
          })}
        </div>
      </div>

    </aside>
  );
}


function WorkspaceRow({
  repo,
  projectColor,
}: {
  repo: SidebarRepo;
  projectColor: ProjectColor;
}) {
  const [hover, setHover] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    };
  }, []);

  const clean = repo.changes === "clean";
  const isFeatureBranch = repo.branch?.startsWith("mesh/");
  const dotColor = isFeatureBranch
    ? MESH.amber
    : clean
      ? MESH.green
      : PROJECT_COLOR_MAP[projectColor];
  const tokens = repo.tokensEst ? kFormat(repo.tokensEst) : "";

  async function doDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirming) {
      setConfirming(true);
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirming(false), 2500);
      return;
    }
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    setBusy(true);
    try {
      const res = await fetch(
        `/api/repos/${encodeURIComponent(repo.name)}`,
        { method: "DELETE" },
      );
      if (res.ok) emitReposChanged();
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  const title = `${repo.name}  ·  ${repo.branch || "main"}  ·  ${repo.changes}${
    repo.engine ? `  ·  ${repo.engine}` : ""
  }`;

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        setConfirming(false);
      }}
      title={title}
      style={{
        display: "grid",
        gridTemplateColumns: "auto minmax(0, 1fr) auto auto",
        alignItems: "center",
        gap: 6,
        padding: "4px 6px",
        borderRadius: 4,
        background: hover ? MESH.bgElev : "transparent",
        minHeight: 24,
        opacity: busy ? 0.5 : 1,
        transition: "background 120ms",
      }}
    >
      <Dot color={dotColor} size={5} />
      <span
        className="font-mono"
        style={{
          fontSize: 11,
          color: MESH.fg,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {repo.name}
      </span>
      <span
        className="font-mono"
        style={{
          fontSize: 10,
          color: MESH.fgMute,
          maxWidth: 70,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {tokens || repo.branch || "main"}
      </span>
      <button
        type="button"
        onClick={doDelete}
        disabled={busy}
        aria-label={confirming ? `Confirm remove ${repo.name}` : `Remove ${repo.name}`}
        className="font-mono"
        style={{
          width: 16,
          height: 16,
          padding: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "transparent",
          border: "none",
          color: confirming ? MESH.red : MESH.fgMute,
          fontSize: confirming ? 9 : 14,
          lineHeight: 1,
          cursor: busy ? "not-allowed" : "pointer",
          opacity: hover || confirming ? 1 : 0,
          transition: "opacity 120ms, color 120ms",
          letterSpacing: confirming ? "0.04em" : "0",
        }}
      >
        {confirming ? "ok?" : "×"}
      </button>
    </div>
  );
}
