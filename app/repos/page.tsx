"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Repo = {
  name: string;
  localPath: string;
  githubOwner?: string;
  githubRepo?: string;
  defaultBranch: string;
  connectedAt: string;
};

export default function ReposPage() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/repos", { cache: "no-store" });
        const json = (await res.json()) as { repos: Repo[] };
        setRepos(json.repos ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <main className="min-h-screen bg-background text-foreground p-6 flex flex-col gap-6 max-w-3xl mx-auto">
      <header className="flex items-baseline justify-between border-b border-border pb-4">
        <div className="flex items-baseline gap-3">
          <Link
            href="/"
            className="text-xs font-mono text-muted-foreground hover:text-accent"
          >
            mesh
          </Link>
          <span className="text-muted-foreground">/</span>
          <h1 className="text-xl font-mono">repos</h1>
        </div>
        <Link
          href="/connect"
          className="text-xs font-mono text-accent hover:underline"
        >
          connect new
        </Link>
      </header>

      {error && (
        <div className="rounded-md border border-destructive bg-destructive/10 text-destructive p-3 font-mono text-xs">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground font-mono">loading...</p>
      ) : repos.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center">
          <p className="text-sm text-muted-foreground">
            No repos connected yet.
          </p>
          <p className="text-xs text-muted-foreground mt-2 font-mono">
            Use <Link href="/connect" className="text-accent hover:underline">/connect</Link> to ingest a set of local repositories.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {repos.map((repo) => (
            <li
              key={repo.name}
              className="rounded-md border border-border px-4 py-3 flex items-center justify-between"
            >
              <div className="flex flex-col">
                <span className="font-mono text-sm">{repo.name}</span>
                <span className="text-xs text-muted-foreground font-mono">
                  {repo.localPath}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs font-mono">
                <span className="text-muted-foreground">
                  {repo.defaultBranch}
                </span>
                <Link
                  href={`/repos/${repo.name}/env`}
                  className="text-accent hover:underline"
                >
                  env →
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
