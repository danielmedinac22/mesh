"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AppShell, MESH, Pill } from "@/components/mesh";
import type { RepoBrief } from "@/lib/memory";
import { displayRepoName } from "@/lib/repo-display";

type RepoRecord = {
  name: string;
  localPath: string;
  githubOwner?: string;
  githubRepo?: string;
  defaultBranch: string;
  connectedAt: string;
  filesIndexed?: number;
  tokensEst?: number;
};

type RepoResponse = { repo: RepoRecord; brief: RepoBrief | null };

export default function RepoOverviewPage() {
  const params = useParams<{ name: string }>();
  const name = params.name;
  const [data, setData] = useState<RepoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/repos/${encodeURIComponent(name)}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error ?? `HTTP ${res.status}`);
        }
        const json = (await res.json()) as RepoResponse;
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [name]);

  const brief = data?.brief ?? null;
  const repo = data?.repo ?? null;

  return (
    <AppShell
      title={
        <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <Link
            href="/repos"
            className="font-mono"
            style={{ fontSize: 11, color: MESH.fgMute, textDecoration: "none" }}
          >
            repos
          </Link>
          <span style={{ color: MESH.fgMute }}>/</span>
          <span>{repo ? displayRepoName(repo) : name}</span>
        </span>
      }
      subtitle={<>Repository overview</>}
      topRight={
        <>
          {repo && (
            <Pill tone="dim">
              {repo.filesIndexed ?? 0} files ·{" "}
              {repo.tokensEst ? `${Math.round(repo.tokensEst / 1000)}K` : "—"}{" "}
              tokens
            </Pill>
          )}
          <Link
            href={`/repos/${encodeURIComponent(name)}/env`}
            className="font-mono"
            style={{
              padding: "6px 12px",
              borderRadius: 5,
              border: `1px solid ${MESH.border}`,
              color: MESH.fgDim,
              fontSize: 11.5,
              textDecoration: "none",
            }}
          >
            env vars →
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
          padding: "28px 32px 40px",
          maxWidth: 960,
          width: "100%",
          margin: "0 auto",
        }}
      >
        {loading ? (
          <p className="font-mono" style={{ fontSize: 12, color: MESH.fgMute }}>
            loading…
          </p>
        ) : !brief ? (
          <EmptyBrief name={name} />
        ) : (
          <BriefView brief={brief} />
        )}
      </div>
    </AppShell>
  );
}

function EmptyBrief({ name }: { name: string }) {
  return (
    <div
      style={{
        padding: 32,
        borderRadius: 8,
        border: `1px dashed ${MESH.border}`,
        background: MESH.bgElev,
        textAlign: "center",
      }}
    >
      <p style={{ fontSize: 14, color: MESH.fgDim, margin: 0, marginBottom: 8 }}>
        No brief yet for <code style={{ color: MESH.amber }}>{name}</code>.
      </p>
      <p
        className="font-mono"
        style={{ fontSize: 11, color: MESH.fgMute, margin: 0 }}
      >
        Run{" "}
        <Link href="/connect" style={{ color: MESH.amber }}>
          /connect
        </Link>{" "}
        to ingest this repo and generate a brief.
      </p>
    </div>
  );
}

function BriefView({ brief }: { brief: RepoBrief }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <Section title="Purpose">
        <p style={{ fontSize: 14, color: MESH.fg, lineHeight: 1.65, margin: 0 }}>
          {brief.purpose}
        </p>
      </Section>

      {brief.stack.length > 0 && (
        <Section title="Stack">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {brief.stack.map((s) => (
              <Pill key={s} tone="amber">
                {s}
              </Pill>
            ))}
          </div>
        </Section>
      )}

      {brief.entry_points.length > 0 && (
        <Section title="Entry points">
          <ul
            className="font-mono"
            style={{
              fontSize: 12,
              color: MESH.fgDim,
              margin: 0,
              paddingLeft: 18,
              lineHeight: 1.8,
            }}
          >
            {brief.entry_points.map((e) => (
              <li key={e}>
                <code style={{ color: MESH.amber }}>{e}</code>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {brief.data_model && (
        <Section title="Data model">
          <p style={{ fontSize: 13, color: MESH.fgDim, lineHeight: 1.65, margin: 0 }}>
            {brief.data_model}
          </p>
        </Section>
      )}

      {brief.key_modules.length > 0 && (
        <Section title="Key modules">
          <div
            style={{
              border: `1px solid ${MESH.border}`,
              borderRadius: 8,
              background: MESH.bgElev,
              overflow: "hidden",
            }}
          >
            {brief.key_modules.map((m, i) => (
              <div
                key={m.path}
                style={{
                  padding: "12px 16px",
                  borderTop: i === 0 ? undefined : `1px solid ${MESH.border}`,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <code
                  className="font-mono"
                  style={{ fontSize: 12, color: MESH.amber }}
                >
                  {m.path}
                </code>
                <span style={{ fontSize: 12.5, color: MESH.fgDim, lineHeight: 1.55 }}>
                  {m.role}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {brief.cross_repo_role && (
        <Section title="Role in the mesh">
          <p style={{ fontSize: 13, color: MESH.fgDim, lineHeight: 1.65, margin: 0 }}>
            {brief.cross_repo_role}
          </p>
        </Section>
      )}

      <div
        className="font-mono"
        style={{ fontSize: 10, color: MESH.fgMute, marginTop: 8 }}
      >
        generated {brief.generated_at}
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h2
        className="mesh-hud"
        style={{
          margin: 0,
          marginBottom: 12,
          color: MESH.fgDim,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <span
          aria-hidden
          style={{ width: 4, height: 12, background: MESH.amber, borderRadius: 1 }}
        />
        {title}
      </h2>
      {children}
    </div>
  );
}
