"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  AppShell,
  MESH,
  ProjectHome,
  type ProjectHomeBrief,
  type ProjectHomeMemory,
  type ProjectHomeProject,
  type ProjectHomeRepo,
} from "@/components/mesh";

type ProjectRecord = ProjectHomeProject & {
  description?: string;
  createdAt: string;
  updatedAt: string;
};

type RepoRecord = ProjectHomeRepo & {
  localPath: string;
  githubOwner?: string;
  githubRepo?: string;
  connectedAt: string;
};

type ProjectResponse = {
  project: ProjectRecord;
  repos: RepoRecord[];
  memory: ProjectHomeMemory;
};

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const projectId = params?.id ?? "";
  const router = useRouter();
  const [data, setData] = useState<ProjectResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [briefStatus, setBriefStatus] = useState<
    "idle" | "streaming" | "done" | "error"
  >("idle");
  const [briefThinking, setBriefThinking] = useState("");
  const [briefError, setBriefError] = useState<string | null>(null);
  const briefAbort = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = (await res.json()) as ProjectResponse;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (projectId) void load();
  }, [projectId, load]);

  const startBrief = useCallback(async () => {
    setBriefStatus("streaming");
    setBriefThinking("");
    setBriefError(null);
    const controller = new AbortController();
    briefAbort.current = controller;
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/brief`,
        { method: "POST", signal: controller.signal },
      );
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buffer.indexOf("\n\n")) !== -1) {
          const raw = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          for (const line of raw.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            try {
              const ev = JSON.parse(line.slice(6)) as
                | { type: "thinking"; delta: string }
                | { type: "text"; delta: string }
                | { type: "done"; brief: ProjectHomeBrief }
                | { type: "error"; message: string };
              if (ev.type === "thinking" || ev.type === "text") {
                setBriefThinking((p) => p + ev.delta);
              } else if (ev.type === "done") {
                setBriefStatus("done");
                await load();
              } else if (ev.type === "error") {
                setBriefStatus("error");
                setBriefError(ev.message);
              }
            } catch {
              // ignore malformed line
            }
          }
        }
      }
    } catch (err) {
      if ((err as { name?: string })?.name !== "AbortError") {
        setBriefStatus("error");
        setBriefError(err instanceof Error ? err.message : String(err));
      }
    }
  }, [projectId, load]);

  if (loading) {
    return (
      <AppShell noTopBar>
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
          loading…
        </div>
      </AppShell>
    );
  }

  if (error || !data) {
    return (
      <AppShell noTopBar>
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            color: MESH.fgDim,
          }}
        >
          <div style={{ fontSize: 14 }}>Project not found</div>
          <Link
            href="/"
            className="font-mono"
            style={{ fontSize: 12, color: MESH.amber }}
          >
            ← back to home
          </Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell noTopBar>
      <ProjectHome
        project={data.project}
        repos={data.repos}
        memory={data.memory}
        briefStatus={briefStatus}
        briefThinking={briefThinking}
        briefError={briefError}
        onGenerateBrief={startBrief}
        onAddRepos={() => router.push("/connect?mode=add")}
      />
    </AppShell>
  );
}
