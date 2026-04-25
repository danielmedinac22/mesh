"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AppShell, Dot, MESH, NavIcon, Pill } from "@/components/mesh";
import type { SidebarRepo } from "@/components/mesh";
import {
  emitReposChanged,
  useReposRefresh,
} from "@/components/mesh/use-repos-refresh";

type Repo = {
  name: string;
  localPath: string;
  githubOwner?: string;
  githubRepo?: string;
  defaultBranch: string;
  connectedAt: string;
  filesIndexed?: number;
  tokensEst?: number;
};

export default function ReposPage() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/repos", { cache: "no-store" });
      const json = (await res.json()) as { repos: Repo[] };
      setRepos(json.repos ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useReposRefresh(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function removeRepo(name: string) {
    setRemoving(name);
    try {
      const res = await fetch(`/api/repos/${encodeURIComponent(name)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setRepos((cur) => cur.filter((r) => r.name !== name));
        emitReposChanged();
      }
    } finally {
      setRemoving(null);
    }
  }

  const sidebarRepos: SidebarRepo[] = repos.map((r) => ({
    name: r.name,
    branch: r.defaultBranch,
    changes: "indexed",
  }));

  return (
    <AppShell
      title="Repos"
      subtitle="connected repositories"
      repos={sidebarRepos}
      topRight={
        <>
          <Pill tone="dim">{repos.length} connected</Pill>
          <Link
            href="/connect"
            className="font-mono"
            style={{
              padding: "6px 12px",
              borderRadius: 5,
              border: `1px solid ${MESH.amber}`,
              color: MESH.amber,
              fontSize: 11.5,
              textDecoration: "none",
            }}
          >
            + connect new
          </Link>
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

      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "28px 32px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
          maxWidth: 960,
          width: "100%",
          margin: "0 auto",
        }}
      >
        {loading ? (
          <p className="font-mono" style={{ color: MESH.fgMute, fontSize: 12 }}>
            loading…
          </p>
        ) : repos.length === 0 ? (
          <div
            style={{
              padding: 40,
              borderRadius: 8,
              border: `1px dashed ${MESH.border}`,
              background: MESH.bgElev,
              textAlign: "center",
              color: MESH.fgDim,
            }}
          >
            <p style={{ fontSize: 14, margin: 0, marginBottom: 8 }}>No repos connected yet.</p>
            <p className="font-mono" style={{ fontSize: 11, color: MESH.fgMute, margin: 0 }}>
              Use{" "}
              <Link href="/connect" style={{ color: MESH.amber, textDecoration: "underline" }}>
                /connect
              </Link>{" "}
              to ingest local repositories.
            </p>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
              gap: 12,
            }}
          >
            {repos.map((repo) => (
              <div
                key={repo.name}
                style={{
                  padding: "16px 18px",
                  borderRadius: 8,
                  border: `1px solid ${MESH.border}`,
                  background: MESH.bgElev,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Dot color={MESH.green} size={6} />
                  <Link
                    href={`/repos/${encodeURIComponent(repo.name)}`}
                    className="font-mono"
                    style={{
                      fontSize: 13,
                      color: MESH.fg,
                      fontWeight: 500,
                      textDecoration: "none",
                    }}
                  >
                    {repo.name}
                  </Link>
                  <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
                    <NavIcon kind="branch" color={MESH.fgMute} size={11} />
                    <span className="font-mono" style={{ fontSize: 11, color: MESH.fgDim }}>
                      {repo.defaultBranch}
                    </span>
                  </span>
                </div>
                <div
                  className="font-mono"
                  style={{
                    fontSize: 11,
                    color: MESH.fgMute,
                    wordBreak: "break-all",
                    lineHeight: 1.5,
                  }}
                >
                  {repo.localPath}
                </div>
                {(repo.githubOwner || repo.githubRepo) && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <Pill tone="dim">
                      {repo.githubOwner}/{repo.githubRepo}
                    </Pill>
                  </div>
                )}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingTop: 4,
                    gap: 8,
                  }}
                >
                  <span className="font-mono" style={{ fontSize: 10, color: MESH.fgMute }}>
                    connected {timeAgo(repo.connectedAt)}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <button
                      type="button"
                      onClick={() => {
                        if (removing === repo.name) return;
                        const confirmed = window.confirm(
                          `Remove "${repo.name}" from Mesh?\n\nThis only unregisters it — local files are not deleted.`,
                        );
                        if (confirmed) void removeRepo(repo.name);
                      }}
                      disabled={removing === repo.name}
                      className="font-mono"
                      style={{
                        background: "transparent",
                        border: "none",
                        padding: 0,
                        color: removing === repo.name ? MESH.fgMute : MESH.red,
                        fontSize: 11,
                        cursor: removing === repo.name ? "not-allowed" : "pointer",
                        opacity: removing === repo.name ? 0.5 : 0.8,
                      }}
                    >
                      {removing === repo.name ? "removing…" : "remove"}
                    </button>
                    <Link
                      href={`/repos/${encodeURIComponent(repo.name)}`}
                      className="font-mono"
                      style={{
                        fontSize: 11,
                        color: MESH.fgDim,
                        textDecoration: "none",
                      }}
                    >
                      overview
                    </Link>
                    <Link
                      href={`/repos/${encodeURIComponent(repo.name)}/env`}
                      className="font-mono"
                      style={{
                        fontSize: 11,
                        color: MESH.amber,
                        textDecoration: "none",
                        borderBottom: `1px solid ${MESH.amber}`,
                      }}
                    >
                      env →
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
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
