"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { MESH } from "./tokens";
import { MeshMark, NavIcon, type IconKind } from "./icons";
import { useReposRefresh } from "./use-repos-refresh";
import {
  ProjectSwitcher,
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

type ContextNavItem = { id: IconKind; label: string; href: string; hash?: string };

const CONTEXT_NAV: ContextNavItem[] = [
  { id: "brain", label: "Brain", href: "/brain" },
  { id: "projects", label: "Projects", href: "/projects" },
  { id: "integrations", label: "Integrations", href: "/settings", hash: "integrations" },
  { id: "settings", label: "Settings", href: "/settings" },
];

type ProjectNavItem = { id: IconKind; label: string; href: (projectId: string) => string };

const PROJECT_NAV: ProjectNavItem[] = [
  { id: "overview", label: "Overview", href: (id) => `/projects/${encodeURIComponent(id)}` },
  { id: "connect", label: "Connect", href: () => "/connect" },
  { id: "run", label: "Run", href: (id) => `/projects/${encodeURIComponent(id)}/run` },
  { id: "build", label: "Build", href: () => "/build" },
  { id: "ship", label: "Ship", href: () => "/ship" },
];

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

export function Sidebar({
  repos: _repos,
}: {
  repos?: SidebarRepo[];
}) {
  const pathname = usePathname();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);

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

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useReposRefresh(
    useCallback(() => {
      void loadProjects();
    }, [loadProjects]),
  );

  const hasProject = !!currentProjectId;

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

      {/* HOME */}
      <div style={{ padding: "4px 12px 0" }}>
        <NavLinkRow
          href="/"
          icon="home"
          label="Home"
          active={pathname === "/"}
        />
      </div>

      {/* PROJECTS */}
      <div style={{ padding: "16px 12px 4px" }}>
        <SectionHeader title="Projects" />
        <ProjectSwitcher
          projects={projects}
          currentId={currentProjectId}
          onChanged={() => {
            void loadProjects();
          }}
          variant="inline"
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 1, marginTop: 8 }}>
          {PROJECT_NAV.map((n) => {
            const href = hasProject ? n.href(currentProjectId!) : "#";
            const isActive = hasProject && computeProjectActive(pathname, n, currentProjectId!);
            return (
              <NavLinkRow
                key={n.id}
                href={href}
                icon={n.id}
                label={n.label}
                active={isActive}
                disabled={!hasProject}
                indent
              />
            );
          })}
        </div>
        {!hasProject && (
          <div
            className="font-mono"
            style={{
              fontSize: 10,
              color: MESH.fgMute,
              padding: "8px 12px 0",
              lineHeight: 1.5,
            }}
          >
            Select or create a project to enable Connect, Build and Ship.
          </div>
        )}
      </div>

      {/* MY CONTEXT */}
      <NavSection title="My context">
        {CONTEXT_NAV.map((n) => {
          const target = n.hash ? `${n.href}#${n.hash}` : n.href;
          const isActive = computeContextActive(pathname, n);
          return (
            <NavLinkRow
              key={n.id}
              href={target}
              icon={n.id}
              label={n.label}
              active={isActive}
            />
          );
        })}
      </NavSection>

      <div style={{ flex: 1 }} />
    </aside>
  );
}

function computeContextActive(
  pathname: string | null,
  item: ContextNavItem,
): boolean {
  if (!pathname) return false;
  if (item.href === "/brain") return pathname.startsWith("/brain");
  if (item.href === "/projects") return pathname === "/projects";
  if (item.href === "/settings") {
    if (item.hash === "integrations") return false;
    return pathname.startsWith("/settings");
  }
  return false;
}

function computeProjectActive(
  pathname: string | null,
  item: ProjectNavItem,
  currentProjectId: string,
): boolean {
  if (!pathname) return false;
  const target = item.href(currentProjectId);
  if (target.startsWith("/projects/")) return pathname === target;
  return pathname.startsWith(target);
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div
      className="font-mono"
      style={{
        fontSize: 10,
        color: MESH.fgMute,
        textTransform: "uppercase",
        letterSpacing: "0.14em",
        marginBottom: 8,
        padding: "0 6px",
      }}
    >
      {title}
    </div>
  );
}

function NavSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ padding: "12px 12px 4px" }}>
      <SectionHeader title={title} />
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>{children}</div>
    </div>
  );
}

function NavLinkRow({
  href,
  icon,
  label,
  active,
  disabled,
  indent,
}: {
  href: string;
  icon: IconKind;
  label: string;
  active: boolean;
  disabled?: boolean;
  indent?: boolean;
}) {
  const color = disabled ? MESH.fgMute : active ? MESH.amber : MESH.fgDim;
  const content = (
    <>
      <NavIcon kind={icon} color={color} size={13} />
      <span>{label}</span>
    </>
  );
  const baseStyle: React.CSSProperties = {
    padding: "8px 10px",
    paddingLeft: indent ? 18 : 12,
    borderRadius: 5,
    background: active ? "rgba(245,165,36,0.10)" : "transparent",
    display: "flex",
    alignItems: "center",
    gap: 11,
    fontSize: 13,
    color,
    fontWeight: active ? 500 : 400,
    borderLeft: `2px solid ${active ? MESH.amber : "transparent"}`,
    boxShadow: active ? "inset 8px 0 24px -16px rgba(245,165,36,0.4)" : "none",
    textDecoration: "none",
    transition:
      "background var(--motion-fast) var(--ease), color var(--motion-fast) var(--ease), box-shadow var(--motion-fast) var(--ease)",
    opacity: disabled ? 0.45 : 1,
    cursor: disabled ? "not-allowed" : "pointer",
  };

  if (disabled) {
    return (
      <div style={baseStyle} aria-disabled>
        {content}
      </div>
    );
  }

  return (
    <Link href={href} style={baseStyle}>
      {content}
    </Link>
  );
}
