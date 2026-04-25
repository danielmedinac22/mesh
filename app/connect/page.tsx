"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AppShell,
  Dot,
  MESH,
  NavIcon,
  Pill,
  ProjectHome,
  CinemaThinking,
  Kbd,
  ThinkingPanelRaw,
  type CinemaMode,
  type CinemaPhase,
  useUsageRecorder,
  type ProjectHomeMemory,
  type ProjectHomeProject,
  type ProjectHomeRepo,
  type SidebarRepo,
} from "@/components/mesh";
import { useReposRefresh } from "@/components/mesh/use-repos-refresh";
import { ProjectGraph } from "@/components/mesh/project-graph";
import type { ProjectColor } from "@/components/mesh/project-switcher";

type Status = "idle" | "cloning" | "ingesting" | "streaming" | "done" | "error";

type RepoState = {
  name: string;
  files?: number;
  tokens_est?: number;
  status: "idle" | "analyzing" | "ready";
  branch?: string;
};

type PersistedRepo = {
  name: string;
  localPath: string;
  defaultBranch: string;
  githubOwner?: string;
  githubRepo?: string;
  filesIndexed?: number;
  tokensEst?: number;
};

type Evidence = { repo: string; path: string; line: number };

type InvariantView = {
  id: string;
  statement: string;
  evidence: Evidence[];
};

type MemoryView = {
  repos: { name: string; symbol_count: number; invariants: InvariantView[] }[];
  cross_repo_flows: { id: string; name: string; repos: string[] }[];
  invariants: InvariantView[];
  meta?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    duration_ms?: number;
  };
};

type GhSource = { owner: string; repo: string; branch: string };

type ServerEvent =
  | { type: "clone-start"; sources: GhSource[] }
  | {
      type: "clone-progress";
      owner: string;
      repo: string;
      stage: "cloning" | "fetching" | "checkout" | "ready";
      message?: string;
    }
  | { type: "ingest-start"; paths: string[] }
  | {
      type: "ingest-done";
      totalTokens: number;
      degraded: boolean;
      repos: { name: string; files: number; tokens_est: number }[];
    }
  | { type: "repo-ready"; name: string }
  | { type: "thinking"; delta: string }
  | { type: "text"; delta: string }
  | { type: "meta"; ttft_ms: number }
  | { type: "memory"; memory: MemoryView }
  | { type: "retry"; attempt: number; reason: string }
  | {
      type: "done";
      duration_ms: number;
      engine_mode: string;
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    }
  | { type: "error"; message: string };

type InstallHint = { command: string; platform: string; fallback: string };

type GhAuth =
  | { state: "loading" }
  | { state: "not-installed"; error?: string; installHint?: InstallHint }
  | { state: "signed-out"; error?: string; installHint?: InstallHint }
  | { state: "signed-in"; user: string };

type RemoteRepo = {
  nameWithOwner: string;
  name: string;
  owner: string;
  description: string | null;
  defaultBranch: string;
  isPrivate: boolean;
  updatedAt: string;
  url: string;
  language: string | null;
};

type BranchInfo = { name: string; sha: string; protected: boolean };

type GhSelection = {
  kind: "github";
  owner: string;
  repo: string;
  branch: string;
};
type LocalSelection = {
  kind: "local";
  path: string;
  name: string;
  branch: string;
  branches: string[];
  githubOwner?: string;
  githubRepo?: string;
  isWorktree: boolean;
  hasOrigin: boolean;
};
type Selection = GhSelection | LocalSelection;

type ScannedRepo = {
  path: string;
  name: string;
  isWorktree: boolean;
  currentBranch: string;
  branches: string[];
  isDirty: boolean;
  hasOrigin: boolean;
  githubOwner?: string;
  githubRepo?: string;
  warnings?: string[];
};

type ScanResponse =
  | { type: "repo"; repo: ScannedRepo }
  | { type: "container"; root: string; repos: ScannedRepo[]; truncated?: boolean }
  | { type: "empty"; root: string }
  | { type: "error"; message: string };

type ListEntry = {
  name: string;
  path: string;
  isDir: boolean;
  isGitRepo: boolean;
};
type ListResponse = {
  path: string;
  parent: string | null;
  home: string;
  showHidden: boolean;
  truncated: boolean;
  entries: ListEntry[];
  error?: string;
};

type LocalView = "browse" | "results";
type PickerTab = "github" | "local";

export default function ConnectPage() {
  // ── GitHub auth & picker state ─────────────────────────────────────────
  const [auth, setAuth] = useState<GhAuth>({ state: "loading" });
  const [query, setQuery] = useState("");
  const [remoteRepos, setRemoteRepos] = useState<RemoteRepo[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [repoError, setRepoError] = useState<string | null>(null);
  const [branches, setBranches] = useState<Record<string, BranchInfo[]>>({});
  const [selections, setSelections] = useState<Selection[]>([]);
  const [tab, setTab] = useState<PickerTab>("github");

  // ── Local folder picker state ──────────────────────────────────────────
  const [localView, setLocalView] = useState<LocalView>("browse");
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);
  const [browseList, setBrowseList] = useState<ListResponse | null>(null);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [scanStatus, setScanStatus] = useState<"idle" | "scanning" | "done" | "error">("idle");
  const [scanResult, setScanResult] = useState<ScanResponse | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  // ── Ingest state (same lifecycle as before) ────────────────────────────
  const [status, setStatus] = useState<Status>("idle");
  const [repos, setRepos] = useState<RepoState[]>([]);
  const [thinking, setThinking] = useState("");
  const [ttft, setTtft] = useState<number | null>(null);
  const [ingestTokens, setIngestTokens] = useState<number | null>(null);
  const [cinemaMode, setCinemaMode] = useState<CinemaMode>("off");
  const [degraded, setDegraded] = useState(false);
  const [memory, setMemory] = useState<MemoryView | null>(null);
  const [retries, setRetries] = useState<{ attempt: number; reason: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [cacheCreate, setCacheCreate] = useState<number | null>(null);
  const [cacheRead, setCacheRead] = useState<number | null>(null);
  const [cloneLog, setCloneLog] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const recordUsage = useUsageRecorder();

  // ── Project binding ────────────────────────────────────────────────────
  const searchParams = useSearchParams();
  const [projects, setProjects] = useState<
    { id: string; name: string; label?: string; color: ProjectColor; repos: string[] }[]
  >([]);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [projectLoaded, setProjectLoaded] = useState(false);
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectLabel, setNewProjectLabel] = useState("");
  const [newProjectBusy, setNewProjectBusy] = useState(false);
  const [mode, setMode] = useState<"overview" | "picker" | null>(null);
  const [projectData, setProjectData] = useState<{
    project: ProjectHomeProject;
    repos: (ProjectHomeRepo & { localPath?: string; githubOwner?: string; githubRepo?: string })[];
    memory: ProjectHomeMemory;
  } | null>(null);
  const initialModeApplied = useRef(false);

  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/projects", { cache: "no-store" });
      const data = await res.json();
      const list = (data?.projects ?? []) as typeof projects;
      setProjects(list);
      setCurrentProjectId(data?.currentProjectId ?? list[0]?.id ?? null);
      setShowCreateProject(list.length === 0);
    } catch {
      // silent
    } finally {
      setProjectLoaded(true);
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  // ── Load project data for overview view ────────────────────────────────
  const loadProjectData = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const json = await res.json();
      setProjectData(json);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    if (!currentProjectId) {
      setProjectData(null);
      return;
    }
    void loadProjectData(currentProjectId);
  }, [currentProjectId, loadProjectData]);

  // Decide initial mode once projects load: 0 repos → picker; ?mode=add → picker; else overview.
  useEffect(() => {
    if (!projectLoaded || initialModeApplied.current) return;
    const current = projects.find((p) => p.id === currentProjectId);
    const wantAdd = searchParams?.get("mode") === "add";
    if (!current || current.repos.length === 0 || wantAdd) {
      setMode("picker");
    } else {
      setMode("overview");
    }
    initialModeApplied.current = true;
  }, [projectLoaded, projects, currentProjectId, searchParams]);

  // If user switches to a project with no repos while in overview, fall back to picker.
  useEffect(() => {
    if (!initialModeApplied.current) return;
    const current = projects.find((p) => p.id === currentProjectId);
    if (mode === "overview" && (!current || current.repos.length === 0)) {
      setMode("picker");
    }
  }, [mode, projects, currentProjectId]);

  const createProject = useCallback(async () => {
    const name = newProjectName.trim();
    if (!name) return;
    setNewProjectBusy(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          label: newProjectLabel.trim() || undefined,
        }),
      });
      if (res.ok) {
        setNewProjectName("");
        setNewProjectLabel("");
        setShowCreateProject(false);
        await loadProjects();
      }
    } finally {
      setNewProjectBusy(false);
    }
  }, [newProjectName, newProjectLabel, loadProjects]);

  // ── Project brief generation ──────────────────────────────────────────
  type ProjectBriefData = {
    description: string;
    relationships: {
      from: string;
      to: string;
      kind: string;
      note?: string;
    }[];
  };
  const [briefStatus, setBriefStatus] = useState<
    "idle" | "streaming" | "done" | "error"
  >("idle");
  const [briefThinking, setBriefThinking] = useState("");
  const [briefData, setBriefData] = useState<ProjectBriefData | null>(null);
  const [briefError, setBriefError] = useState<string | null>(null);
  const briefAbort = useRef<AbortController | null>(null);

  const startBrief = useCallback(async () => {
    if (!currentProjectId) return;
    setBriefStatus("streaming");
    setBriefThinking("");
    setBriefData(null);
    setBriefError(null);
    const controller = new AbortController();
    briefAbort.current = controller;
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(currentProjectId)}/brief`,
        { method: "POST", signal: controller.signal },
      );
      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }
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
                | { type: "done"; brief: ProjectBriefData }
                | { type: "error"; message: string };
              if (ev.type === "thinking" || ev.type === "text") {
                setBriefThinking((p) => p + ev.delta);
              } else if (ev.type === "done") {
                setBriefData(ev.brief);
                setBriefStatus("done");
                if (currentProjectId) void loadProjectData(currentProjectId);
              } else if (ev.type === "error") {
                setBriefError(ev.message);
                setBriefStatus("error");
              }
            } catch {
              // ignore malformed SSE line
            }
          }
        }
      }
    } catch (err) {
      if ((err as { name?: string })?.name !== "AbortError") {
        setBriefError(err instanceof Error ? err.message : String(err));
        setBriefStatus("error");
      }
    }
  }, [currentProjectId, loadProjectData]);

  const invariantCount = useMemo(() => (memory ? memory.invariants.length : 0), [memory]);

  // Repos already connected to the current project — used to mark them in the picker.
  const connectedKeys = useMemo(() => {
    const set = new Set<string>();
    const add = (v?: string | null) => {
      if (v) set.add(v.toLowerCase());
    };
    for (const r of projectData?.repos ?? []) {
      add(r.name);
      if (r.githubOwner && r.githubRepo) {
        add(`${r.githubOwner}/${r.githubRepo}`);
      }
      if (r.localPath) add(r.localPath);
    }
    return set;
  }, [projectData]);

  // ── Auth + repo list ───────────────────────────────────────────────────
  const loadAuth = useCallback(async () => {
    setAuth({ state: "loading" });
    try {
      const res = await fetch("/api/github/auth", { cache: "no-store" });
      const json = await res.json();
      if (json?.state === "signed-in" && json.user) {
        setAuth({ state: "signed-in", user: json.user });
      } else if (json?.state === "not-installed") {
        setAuth({
          state: "not-installed",
          error: json.error,
          installHint: json.installHint,
        });
      } else {
        setAuth({
          state: "signed-out",
          error: json?.error,
          installHint: json?.installHint,
        });
      }
    } catch (err) {
      setAuth({
        state: "signed-out",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const loadRepos = useCallback(async (q?: string) => {
    setLoadingRepos(true);
    setRepoError(null);
    try {
      const u = new URL("/api/github/repos", window.location.origin);
      if (q?.trim()) u.searchParams.set("q", q.trim());
      u.searchParams.set("limit", "50");
      const res = await fetch(u.toString(), { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      setRemoteRepos(json.repos ?? []);
    } catch (err) {
      setRepoError(err instanceof Error ? err.message : String(err));
      setRemoteRepos([]);
    } finally {
      setLoadingRepos(false);
    }
  }, []);

  useEffect(() => {
    loadAuth();
  }, [loadAuth]);

  useEffect(() => {
    if (auth.state === "signed-in") void loadRepos();
  }, [auth.state, loadRepos]);

  const loadPersistedRepos = useCallback(async () => {
    try {
      const res = await fetch("/api/repos", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as { repos: PersistedRepo[] };
      const workspace = (json.repos ?? []).filter((r) => r.name !== "mesh");
      setRepos((cur) => {
        if (cur.length > 0) return cur;
        return workspace.map((r) => ({
          name: r.name,
          status: "ready" as const,
          branch: r.defaultBranch,
          files: r.filesIndexed,
          tokens_est: r.tokensEst,
        }));
      });
    } catch {
      // silent — sidebar falls back to empty state
    }
  }, []);

  useEffect(() => {
    void loadPersistedRepos();
  }, [loadPersistedRepos]);

  useReposRefresh(
    useCallback(() => {
      setRepos([]);
      void loadPersistedRepos();
    }, [loadPersistedRepos]),
  );

  // debounce search
  useEffect(() => {
    if (auth.state !== "signed-in") return;
    const t = setTimeout(() => {
      void loadRepos(query);
    }, 280);
    return () => clearTimeout(t);
  }, [query, auth.state, loadRepos]);

  async function ensureBranches(owner: string, name: string): Promise<BranchInfo[]> {
    const key = `${owner}/${name}`;
    if (branches[key]) return branches[key];
    const res = await fetch(
      `/api/github/branches?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(name)}`,
      { cache: "no-store" },
    );
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
    const list: BranchInfo[] = json.branches ?? [];
    setBranches((b) => ({ ...b, [key]: list }));
    return list;
  }

  async function addSelection(r: RemoteRepo) {
    if (
      selections.some(
        (s) => s.kind === "github" && s.owner === r.owner && s.repo === r.name,
      )
    )
      return;
    try {
      await ensureBranches(r.owner, r.name);
    } catch (err) {
      setRepoError(err instanceof Error ? err.message : String(err));
    }
    setSelections((cur) => [
      ...cur,
      { kind: "github", owner: r.owner, repo: r.name, branch: r.defaultBranch },
    ]);
  }

  function addLocalSelection(scanned: ScannedRepo) {
    if (selections.some((s) => s.kind === "local" && s.path === scanned.path)) return;
    const taken = new Set<string>();
    for (const s of selections) taken.add(s.kind === "github" ? `${s.owner}-${s.repo}` : s.name);
    for (const r of repos) taken.add(r.name.split("/").pop() ?? r.name);
    let base = scanned.name;
    let candidate = base;
    let suffix = 2;
    while (taken.has(candidate)) {
      candidate = `${base}-${suffix++}`;
    }
    setSelections((cur) => [
      ...cur,
      {
        kind: "local",
        path: scanned.path,
        name: candidate,
        branch: scanned.currentBranch === "HEAD" ? "" : scanned.currentBranch,
        branches: scanned.branches,
        githubOwner: scanned.githubOwner,
        githubRepo: scanned.githubRepo,
        isWorktree: scanned.isWorktree,
        hasOrigin: scanned.hasOrigin,
      },
    ]);
  }

  function removeSelection(key: string) {
    setSelections((cur) => cur.filter((s) => selectionKey(s) !== key));
  }

  function setSelectionBranch(key: string, branch: string) {
    setSelections((cur) =>
      cur.map((s) => (selectionKey(s) === key ? ({ ...s, branch } as Selection) : s)),
    );
  }

  // ── Ingest runner ──────────────────────────────────────────────────────
  async function run() {
    if (status === "streaming" || status === "ingesting" || status === "cloning") {
      abortRef.current?.abort();
      return;
    }
    if (selections.length === 0) {
      setError("Pick at least one repo.");
      return;
    }
    const detached = selections.find((s) => s.kind === "local" && !s.branch);
    if (detached && detached.kind === "local") {
      setError(`Pick a base branch for ${detached.name} (detached HEAD).`);
      return;
    }
    setStatus("cloning");
    setRepos(
      selections.map((s) => ({ name: selectionLabel(s), status: "idle" as const })),
    );
    setThinking("");
    setTtft(null);
    setIngestTokens(null);
    setDegraded(false);
    setMemory(null);
    setRetries([]);
    setError(null);
    setDuration(null);
    setCacheCreate(null);
    setCacheRead(null);
    setCloneLog([]);

    const controller = new AbortController();
    abortRef.current = controller;

    const ghPayload = selections
      .filter((s): s is GhSelection => s.kind === "github")
      .map(({ owner, repo, branch }) => ({ owner, repo, branch }));
    const localPayload = selections
      .filter((s): s is LocalSelection => s.kind === "local")
      .map((s) => ({
        path: s.path,
        branch: s.branch,
        name: s.name,
        githubOwner: s.githubOwner,
        githubRepo: s.githubRepo,
      }));

    try {
      if (!currentProjectId) {
        setShowCreateProject(true);
        setStatus("idle");
        setError("Create a project first.");
        return;
      }
      const res = await fetch("/api/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sources: ghPayload,
          localSources: localPayload,
          projectId: currentProjectId,
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${text || "no body"}`);
      }
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
              handleEvent(JSON.parse(line.slice(6)) as ServerEvent);
            } catch {
              // ignore malformed
            }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setStatus("idle");
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }

  function handleEvent(ev: ServerEvent) {
    switch (ev.type) {
      case "clone-start":
        setStatus("cloning");
        break;
      case "clone-progress":
        setCloneLog((l) => [
          ...l,
          `${ev.owner}/${ev.repo}: ${ev.stage}${ev.message ? " · " + ev.message : ""}`,
        ]);
        break;
      case "ingest-start":
        break;
      case "ingest-done":
        setIngestTokens(ev.totalTokens);
        setDegraded(ev.degraded);
        setRepos(
          ev.repos.map((r) => ({
            name: r.name,
            files: r.files,
            tokens_est: Math.round(r.tokens_est),
            status: "analyzing",
          })),
        );
        setStatus("streaming");
        break;
      case "repo-ready":
        setRepos((prev) =>
          prev.map((r) => (r.name === ev.name ? { ...r, status: "ready" } : r)),
        );
        break;
      case "thinking":
        setThinking((t) => t + ev.delta);
        break;
      case "text":
        break;
      case "meta":
        setTtft(ev.ttft_ms);
        break;
      case "memory":
        setMemory(ev.memory);
        break;
      case "retry":
        setRetries((r) => [...r, { attempt: ev.attempt, reason: ev.reason }]);
        break;
      case "done":
        setStatus("done");
        setDuration(ev.duration_ms);
        setCacheCreate(ev.cache_creation_input_tokens ?? null);
        setCacheRead(ev.cache_read_input_tokens ?? null);
        recordUsage({
          input_tokens: ev.input_tokens,
          output_tokens: ev.output_tokens,
          cache_creation_input_tokens: ev.cache_creation_input_tokens,
          cache_read_input_tokens: ev.cache_read_input_tokens,
        });
        setRepos((prev) => prev.map((r) => ({ ...r, status: "ready" })));
        // Kick off project brief generation once memory is saved.
        if (currentProjectId) {
          setTimeout(() => {
            void startBrief();
          }, 150);
        }
        break;
      case "error":
        setStatus("error");
        setError(ev.message);
        break;
    }
  }

  const isRunning = status === "cloning" || status === "ingesting" || status === "streaming";
  const hasRun = status !== "idle";

  const sidebarRepos: SidebarRepo[] = repos.map((r) => {
    const matched = selections.find((s) => selectionMatchesRepo(s, r.name));
    const branch =
      matched?.branch ??
      r.branch ??
      (r.status === "ready" ? "indexed" : r.status);
    return {
      name: r.name.split("/").pop() ?? r.name,
      branch,
      changes:
        r.files !== undefined
          ? `${r.files} files · ~${Math.round((r.tokens_est ?? 0) / 1000)}k tok`
          : r.status === "ready"
            ? "clean"
            : r.status,
    };
  });

  const loadList = useCallback(async (p?: string | null) => {
    setBrowseLoading(true);
    setBrowseError(null);
    try {
      const u = new URL("/api/local/list", window.location.origin);
      if (p) u.searchParams.set("path", p);
      const res = await fetch(u.toString(), { cache: "no-store" });
      const json = (await res.json()) as ListResponse;
      if (!res.ok || json.error) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      setBrowseList(json);
    } catch (err) {
      setBrowseError(err instanceof Error ? err.message : String(err));
    } finally {
      setBrowseLoading(false);
    }
  }, []);

  const scanPath = useCallback(async (target: string) => {
    setScanStatus("scanning");
    setScanError(null);
    setScanResult(null);
    try {
      const res = await fetch("/api/local/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: target }),
      });
      const json = (await res.json()) as ScanResponse;
      if (!res.ok || json.type === "error") {
        const msg = json.type === "error" ? json.message : `HTTP ${res.status}`;
        setScanStatus("error");
        setScanError(msg);
        return;
      }
      setScanResult(json);
      setScanStatus("done");
    } catch (err) {
      setScanStatus("error");
      setScanError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const useThisFolder = useCallback(
    async (target: string) => {
      setWorkspaceRoot(target);
      setLocalView("results");
      try {
        await fetch("/api/config", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceRoot: target }),
        });
      } catch {
        // non-fatal: we still scan even if persistence fails
      }
      await scanPath(target);
    },
    [scanPath],
  );

  const changeFolder = useCallback(async () => {
    setWorkspaceRoot(null);
    setScanResult(null);
    setScanStatus("idle");
    setScanError(null);
    setLocalView("browse");
    try {
      await fetch("/api/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceRoot: null }),
      });
    } catch {
      // non-fatal
    }
    void loadList(null);
  }, [loadList]);

  // Restore the saved workspaceRoot on mount: if present and repos exist,
  // auto-open the Local tab and rescan. Otherwise init the browse picker.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/config", { cache: "no-store" });
        const json = await res.json();
        const saved = json?.config?.workspaceRoot as string | undefined;
        if (!cancelled && saved) {
          setWorkspaceRoot(saved);
          setTab("local");
          setLocalView("results");
          await scanPath(saved);
        } else if (!cancelled) {
          void loadList(null);
        }
      } catch {
        if (!cancelled) void loadList(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scanPath, loadList]);

  const statusTone: "green" | "red" | "amber" | "dim" =
    status === "done" ? "green" : status === "error" ? "red" : isRunning ? "amber" : "dim";

  const connectPhases: CinemaPhase[] = useMemo(
    () => [
      { id: "clone", label: "Clone", tone: "signal" },
      { id: "ingest", label: "Ingest", tone: "signal" },
      { id: "analyze", label: "Analyze", tone: "amber" },
      { id: "memory", label: "Memory", tone: "green" },
    ],
    [],
  );
  const connectPhase: CinemaPhase | null = useMemo(() => {
    if (status === "cloning") return connectPhases[0];
    if (status === "ingesting") return connectPhases[1];
    if (status === "streaming") return connectPhases[2];
    if (status === "done") return connectPhases[3];
    return null;
  }, [status, connectPhases]);

  // Auto-open cinema when an ingest run kicks off; auto-dock when done.
  useEffect(() => {
    if (isRunning && cinemaMode === "off") setCinemaMode("cinema");
  }, [isRunning, cinemaMode]);
  useEffect(() => {
    if (status === "done" && cinemaMode === "cinema") {
      const t = setTimeout(() => setCinemaMode("docked"), 1800);
      return () => clearTimeout(t);
    }
  }, [status, cinemaMode]);

  return (
    <AppShell
      title="Connect"
      subtitle="cross-repo memory builder"
      repos={sidebarRepos}
      topRight={
        <>
          <Pill tone={statusTone}>{status}</Pill>
          {ttft !== null && (
            <Pill tone="dim">
              ttft <span style={{ color: MESH.fg, marginLeft: 4 }}>{ttft}ms</span>
            </Pill>
          )}
          {duration !== null && (
            <Pill tone="dim">
              total <span style={{ color: MESH.fg, marginLeft: 4 }}>{duration}ms</span>
            </Pill>
          )}
        </>
      }
    >
      {/* Overview mode: show ProjectHome inline (skip strip + auth + picker) */}
      {!projectLoaded || mode === null || (mode === "overview" && !projectData && !hasRun) ? null : mode === "overview" && projectData && !hasRun ? (
        <ProjectHome
          project={projectData.project}
          repos={projectData.repos}
          memory={projectData.memory}
          briefStatus={briefStatus}
          briefThinking={briefThinking}
          briefError={briefError}
          onGenerateBrief={() => void startBrief()}
          onAddRepos={() => setMode("picker")}
          addReposLabel="Add more repos →"
        />
      ) : (
        <>
          {/* Project strip */}
          {projectLoaded && (
            <ProjectStrip
              projects={projects}
              currentProjectId={currentProjectId}
              onSelect={async (id) => {
                await fetch(`/api/projects/${encodeURIComponent(id)}/select`, {
                  method: "POST",
                });
                await loadProjects();
              }}
              onCreate={() => setShowCreateProject(true)}
              onViewProject={
                projectData && projectData.repos.length > 0
                  ? () => setMode("overview")
                  : undefined
              }
            />
          )}

          {showCreateProject && (
            <CreateProjectGate
              required={projects.length === 0}
              name={newProjectName}
              label={newProjectLabel}
              busy={newProjectBusy}
              onNameChange={setNewProjectName}
              onLabelChange={setNewProjectLabel}
              onCreate={createProject}
              onClose={() => setShowCreateProject(false)}
            />
          )}

          {/* Auth bar */}
          <AuthBar auth={auth} onRefresh={loadAuth} />

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

          {!hasRun ? (
        <PickerLayout
          tab={tab}
          onTabChange={setTab}
          authReady={auth.state === "signed-in"}
          query={query}
          onQuery={setQuery}
          remoteRepos={remoteRepos}
          loadingRepos={loadingRepos}
          repoError={repoError}
          branches={branches}
          selections={selections}
          connectedKeys={connectedKeys}
          onAdd={addSelection}
          onAddLocal={addLocalSelection}
          onRemove={removeSelection}
          onBranch={setSelectionBranch}
          onConnect={run}
          isRunning={isRunning}
          localView={localView}
          workspaceRoot={workspaceRoot}
          browseList={browseList}
          browseLoading={browseLoading}
          browseError={browseError}
          onBrowse={loadList}
          onUseFolder={useThisFolder}
          onChangeFolder={changeFolder}
          scanStatus={scanStatus}
          scanResult={scanResult}
          scanError={scanError}
        />
      ) : (
        <>
          <IngestLayout
            thinking={thinking}
            isRunning={isRunning}
            status={status}
            repos={repos}
            invariantCount={invariantCount}
            memory={memory}
            ingestTokens={ingestTokens}
            degraded={degraded}
            cacheRead={cacheRead}
            cacheCreate={cacheCreate}
            retries={retries}
            cloneLog={cloneLog}
            selections={selections}
            onReset={() => {
              setStatus("idle");
            }}
            onAbort={run}
          />
          {status === "done" && currentProjectId && (
            <ProjectBriefPanel
              projectId={currentProjectId}
              projectName={
                projects.find((p) => p.id === currentProjectId)?.name ??
                currentProjectId
              }
              repos={repos.map((r) => r.name)}
              status={briefStatus}
              thinking={briefThinking}
              brief={briefData}
              error={briefError}
              onRegenerate={() => void startBrief()}
            />
          )}
        </>
      )}
        </>
      )}

      <CinemaThinking
        mode={cinemaMode}
        text={thinking}
        active={isRunning}
        tokens={thinking.length}
        phase={connectPhase}
        phases={connectPhases}
        title={
          status === "cloning"
            ? "Cloning repos"
            : status === "ingesting"
              ? "Ingesting source"
              : status === "streaming"
                ? "Extracting cross-repo invariants"
                : status === "done"
                  ? "Memory committed"
                  : status === "error"
                    ? "Run failed"
                    : "Connect"
        }
        subtitle={
          repos.length > 0
            ? `${repos.length} repos · ${repos.filter((r) => r.status === "ready").length} ready`
            : undefined
        }
        meta={
          status === "error" ? (
            <Pill tone="red">error</Pill>
          ) : ingestTokens ? (
            <Pill tone="amber">{Math.round(ingestTokens / 1000)}k ingested</Pill>
          ) : (
            <Pill tone={statusTone}>{status}</Pill>
          )
        }
        footer={
          status === "done" ? (
            <button
              type="button"
              onClick={() => setCinemaMode("off")}
              className="mesh-mono"
              style={{
                padding: "6px 12px",
                background: MESH.green,
                color: "#0A1A12",
                border: `1px solid ${MESH.green}`,
                borderRadius: 6,
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.14em",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              memory ready · view summary
            </button>
          ) : (
            <span
              className="mesh-mono"
              style={{ fontSize: 11, color: MESH.fgMute }}
            >
              <Kbd size="xs">esc</Kbd> to dock
            </span>
          )
        }
        onDismiss={() =>
          setCinemaMode(isRunning || status === "done" ? "docked" : "off")
        }
        onExpand={() => setCinemaMode("cinema")}
      />
    </AppShell>
  );
}

// ── sub-components ──────────────────────────────────────────────────────────

function AuthBar({ auth, onRefresh }: { auth: GhAuth; onRefresh: () => void }) {
  if (auth.state === "loading") {
    return (
      <div
        className="font-mono"
        style={{
          padding: "12px 24px",
          borderBottom: `1px solid ${MESH.border}`,
          fontSize: 12,
          color: MESH.fgMute,
        }}
      >
        checking GitHub auth…
      </div>
    );
  }
  if (auth.state === "not-installed") {
    const cmd = auth.installHint?.command ?? "brew install gh";
    const platform = auth.installHint?.platform ?? "your platform";
    return (
      <div
        style={{
          padding: "16px 24px",
          borderBottom: `1px solid ${MESH.border}`,
          background: "rgba(229,72,77,0.04)",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Pill tone="red">GitHub CLI not installed</Pill>
          <span className="font-mono" style={{ fontSize: 11, color: MESH.fgDim }}>
            Mesh uses <code style={{ color: MESH.amber }}>gh</code> for auth and cloning.
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span
            className="font-mono"
            style={{
              fontSize: 10,
              color: MESH.fgMute,
              textTransform: "uppercase",
              letterSpacing: "0.14em",
            }}
          >
            Install on {platform}
          </span>
          <CodeBlock text={cmd} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span
            className="font-mono"
            style={{
              fontSize: 10,
              color: MESH.fgMute,
              textTransform: "uppercase",
              letterSpacing: "0.14em",
            }}
          >
            Or ask Claude Code
          </span>
          <CodeBlock text={`claude "install the GitHub CLI (gh) on my machine and run gh auth login"`} />
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            onClick={onRefresh}
            className="font-mono"
            style={{
              padding: "6px 12px",
              borderRadius: 5,
              border: `1px solid ${MESH.amber}`,
              background: MESH.amber,
              color: "#0B0B0C",
              fontSize: 11.5,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            I installed gh — check again
          </button>
          {auth.installHint?.fallback && (
            <a
              href={auth.installHint.fallback.replace(/^.*(https?:\/\/\S+).*/, "$1")}
              target="_blank"
              rel="noreferrer"
              className="font-mono"
              style={{ fontSize: 10.5, color: MESH.amber, textDecoration: "underline" }}
            >
              other install methods ↗
            </a>
          )}
        </div>
      </div>
    );
  }
  if (auth.state === "signed-out") {
    return (
      <div
        style={{
          padding: "16px 24px",
          borderBottom: `1px solid ${MESH.border}`,
          background: "rgba(245,165,36,0.04)",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Pill tone="amber">GitHub not connected</Pill>
          <span className="font-mono" style={{ fontSize: 11, color: MESH.fgDim }}>
            gh is installed — sign in once in your terminal:
          </span>
        </div>
        <CodeBlock text="gh auth login" />
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            onClick={onRefresh}
            className="font-mono"
            style={{
              padding: "6px 12px",
              borderRadius: 5,
              border: `1px solid ${MESH.amber}`,
              background: MESH.amber,
              color: "#0B0B0C",
              fontSize: 11.5,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            I signed in — check again
          </button>
          {auth.error && (
            <span className="font-mono" style={{ fontSize: 10.5, color: MESH.fgMute }}>
              {auth.error}
            </span>
          )}
        </div>
      </div>
    );
  }
  return (
    <div
      style={{
        padding: "10px 24px",
        borderBottom: `1px solid ${MESH.border}`,
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <Pill tone="green">
        <Dot color={MESH.green} size={5} />
        gh · {auth.user}
      </Pill>
      <span className="font-mono" style={{ fontSize: 11, color: MESH.fgMute }}>
        signed in via GitHub CLI
      </span>
      <button
        onClick={onRefresh}
        className="font-mono"
        style={{
          marginLeft: "auto",
          padding: "4px 10px",
          borderRadius: 4,
          border: `1px solid ${MESH.border}`,
          background: "transparent",
          color: MESH.fgDim,
          fontSize: 10.5,
          cursor: "pointer",
        }}
      >
        refresh
      </button>
    </div>
  );
}

function PickerLayout({
  tab,
  onTabChange,
  authReady,
  query,
  onQuery,
  remoteRepos,
  loadingRepos,
  repoError,
  branches,
  selections,
  connectedKeys,
  onAdd,
  onAddLocal,
  onRemove,
  onBranch,
  onConnect,
  isRunning,
  localView,
  workspaceRoot,
  browseList,
  browseLoading,
  browseError,
  onBrowse,
  onUseFolder,
  onChangeFolder,
  scanStatus,
  scanResult,
  scanError,
}: {
  tab: PickerTab;
  onTabChange: (t: PickerTab) => void;
  authReady: boolean;
  query: string;
  onQuery: (s: string) => void;
  remoteRepos: RemoteRepo[];
  loadingRepos: boolean;
  repoError: string | null;
  branches: Record<string, BranchInfo[]>;
  selections: Selection[];
  connectedKeys: Set<string>;
  onAdd: (r: RemoteRepo) => void;
  onAddLocal: (r: ScannedRepo) => void;
  onRemove: (key: string) => void;
  onBranch: (key: string, branch: string) => void;
  onConnect: () => void;
  isRunning: boolean;
  localView: LocalView;
  workspaceRoot: string | null;
  browseList: ListResponse | null;
  browseLoading: boolean;
  browseError: string | null;
  onBrowse: (p?: string | null) => void;
  onUseFolder: (p: string) => void;
  onChangeFolder: () => void;
  scanStatus: "idle" | "scanning" | "done" | "error";
  scanResult: ScanResponse | null;
  scanError: string | null;
}) {
  const ghCount = selections.filter((s) => s.kind === "github").length;
  const localCount = selections.filter((s) => s.kind === "local").length;
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "grid",
        gridTemplateColumns: "1fr 400px",
      }}
    >
      {/* Left: source picker with tabs */}
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div
          style={{
            display: "flex",
            borderBottom: `1px solid ${MESH.border}`,
            padding: "0 24px",
            gap: 4,
          }}
        >
          <TabButton
            active={tab === "github"}
            onClick={() => onTabChange("github")}
            label="GitHub"
            count={ghCount}
          />
          <TabButton
            active={tab === "local"}
            onClick={() => onTabChange("local")}
            label="Local folder"
            count={localCount}
          />
        </div>

        {tab === "github" ? (
          <GithubTab
            authReady={authReady}
            query={query}
            onQuery={onQuery}
            remoteRepos={remoteRepos}
            loadingRepos={loadingRepos}
            repoError={repoError}
            selections={selections}
            connectedKeys={connectedKeys}
            onAdd={onAdd}
          />
        ) : (
          <LocalTab
            view={localView}
            workspaceRoot={workspaceRoot}
            browseList={browseList}
            browseLoading={browseLoading}
            browseError={browseError}
            onBrowse={onBrowse}
            onUseFolder={onUseFolder}
            onChangeFolder={onChangeFolder}
            scanStatus={scanStatus}
            scanResult={scanResult}
            scanError={scanError}
            selections={selections}
            connectedKeys={connectedKeys}
            onAdd={onAddLocal}
          />
        )}
      </div>

      {/* Right: selection summary */}
      <aside
        style={{
          background: MESH.bgElev,
          padding: 20,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          borderLeft: `1px solid ${MESH.border}`,
        }}
      >
        <div>
          <span
            className="font-mono"
            style={{
              fontSize: 10,
              color: MESH.fgMute,
              textTransform: "uppercase",
              letterSpacing: "0.14em",
            }}
          >
            Workspace
          </span>
          <div style={{ marginTop: 4, display: "flex", alignItems: "baseline", gap: 8 }}>
            <span className="font-mono" style={{ fontSize: 17, color: MESH.fg, fontWeight: 500 }}>
              {selections.length}
            </span>
            <span style={{ fontSize: 11, color: MESH.fgMute }}>
              repo{selections.length === 1 ? "" : "s"} queued
            </span>
          </div>
        </div>

        {selections.length === 0 ? (
          <p className="font-mono" style={{ fontSize: 11.5, color: MESH.fgMute, lineHeight: 1.6 }}>
            Pick repos from GitHub or a local folder. You&apos;ll set a base branch for each.
            Mesh creates feature branches per ticket in Build.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {selections.map((s) => {
              const key = selectionKey(s);
              return (
                <SelectionCard
                  key={key}
                  sel={s}
                  branches={
                    s.kind === "github"
                      ? (branches[`${s.owner}/${s.repo}`] ?? []).map((b) => b.name)
                      : s.branches
                  }
                  protectedBranches={
                    s.kind === "github"
                      ? new Set(
                          (branches[`${s.owner}/${s.repo}`] ?? [])
                            .filter((b) => b.protected)
                            .map((b) => b.name),
                        )
                      : new Set()
                  }
                  onBranch={(b) => onBranch(key, b)}
                  onRemove={() => onRemove(key)}
                />
              );
            })}
          </div>
        )}

        <button
          onClick={onConnect}
          disabled={selections.length === 0 || isRunning}
          className="font-mono"
          style={{
            marginTop: "auto",
            padding: "10px 16px",
            borderRadius: 6,
            border: `1px solid ${MESH.amber}`,
            background: selections.length === 0 ? "transparent" : MESH.amber,
            color: selections.length === 0 ? MESH.amber : "#0B0B0C",
            fontSize: 12.5,
            fontWeight: 500,
            cursor: selections.length === 0 || isRunning ? "default" : "pointer",
            opacity: selections.length === 0 || isRunning ? 0.6 : 1,
          }}
        >
          Connect & Ingest {selections.length > 0 ? `(${selections.length})` : ""}
        </button>
        <p
          className="font-mono"
          style={{ fontSize: 10, color: MESH.fgMute, lineHeight: 1.55, margin: 0 }}
        >
          GitHub repos clone to <code style={{ color: MESH.amber }}>.mesh/workspace/</code>{" "}
          via <code style={{ color: MESH.amber }}>gh</code>. Local folders stay in place — no
          clone, no checkout. Base branch is used as the PR target; ticket work happens on new
          branches.
        </p>
      </aside>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      onClick={onClick}
      className="font-mono"
      style={{
        padding: "12px 14px",
        background: "transparent",
        border: "none",
        borderBottom: `2px solid ${active ? MESH.amber : "transparent"}`,
        color: active ? MESH.fg : MESH.fgMute,
        fontSize: 12,
        fontWeight: active ? 500 : 400,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      {label}
      {count > 0 && <Pill tone={active ? "amber" : "dim"}>{count}</Pill>}
    </button>
  );
}

function GithubTab({
  authReady,
  query,
  onQuery,
  remoteRepos,
  loadingRepos,
  repoError,
  selections,
  connectedKeys,
  onAdd,
}: {
  authReady: boolean;
  query: string;
  onQuery: (s: string) => void;
  remoteRepos: RemoteRepo[];
  loadingRepos: boolean;
  repoError: string | null;
  selections: Selection[];
  connectedKeys: Set<string>;
  onAdd: (r: RemoteRepo) => void;
}) {
  if (!authReady) {
    return (
      <div style={{ padding: "18px 24px" }}>
        <p
          className="font-mono"
          style={{ fontSize: 11.5, color: MESH.fgMute, lineHeight: 1.6, margin: 0 }}
        >
          Sign in with <code style={{ color: MESH.amber }}>gh auth login</code> above to list
          your GitHub repos. Or switch to <strong style={{ color: MESH.fg }}>Local folder</strong>{" "}
          to point Mesh at a directory you already have.
        </p>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div
        style={{
          padding: "14px 24px",
          borderBottom: `1px solid ${MESH.border}`,
          display: "flex",
          gap: 10,
          alignItems: "center",
        }}
      >
        <div style={{ position: "relative", flex: 1, display: "flex", alignItems: "center" }}>
          <div style={{ position: "absolute", left: 12, pointerEvents: "none" }}>
            <NavIcon kind="search" color={MESH.fgMute} size={13} />
          </div>
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="search your repos, or paste github.com/owner/repo URL"
            className="font-mono"
            style={{
              flex: 1,
              background: MESH.bgInput,
              color: MESH.fg,
              border: `1px solid ${MESH.border}`,
              borderRadius: 6,
              padding: "8px 12px 8px 32px",
              fontSize: 12.5,
              outline: "none",
            }}
          />
        </div>
        {loadingRepos && <Pill tone="amber">loading…</Pill>}
        <span className="font-mono" style={{ fontSize: 11, color: MESH.fgMute }}>
          {remoteRepos.length} results
        </span>
      </div>

        {repoError && (
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
            {repoError}
          </div>
        )}

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "12px 24px 24px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {remoteRepos.map((r) => {
            const picked = selections.some(
              (s) => s.kind === "github" && s.owner === r.owner && s.repo === r.name,
            );
            const connected =
              connectedKeys.has(`${r.owner}/${r.name}`.toLowerCase()) ||
              connectedKeys.has(r.name.toLowerCase());
            const inactive = picked || connected;
            return (
              <button
                key={`${r.owner}/${r.name}`}
                onClick={() => onAdd(r)}
                disabled={inactive}
                style={{
                  textAlign: "left",
                  padding: "12px 14px",
                  borderRadius: 7,
                  border: `1px solid ${inactive ? "rgba(48,164,108,0.28)" : MESH.border}`,
                  background: inactive ? "rgba(48,164,108,0.04)" : MESH.bgElev,
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  cursor: inactive ? "default" : "pointer",
                }}
              >
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      className="font-mono"
                      style={{
                        fontSize: 12.5,
                        color: MESH.fg,
                        fontWeight: 500,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {r.nameWithOwner}
                    </span>
                    <Pill tone={r.isPrivate ? "amber" : "dim"}>
                      {r.isPrivate ? "private" : "public"}
                    </Pill>
                    {r.language && <Pill tone="dim">{r.language}</Pill>}
                  </div>
                  {r.description && (
                    <p
                      style={{
                        fontSize: 11.5,
                        color: MESH.fgDim,
                        margin: 0,
                        lineHeight: 1.55,
                        overflow: "hidden",
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                      }}
                    >
                      {r.description}
                    </p>
                  )}
                  <div
                    className="font-mono"
                    style={{ fontSize: 10, color: MESH.fgMute, display: "flex", gap: 10 }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <NavIcon kind="branch" color={MESH.fgMute} size={10} />
                      {r.defaultBranch}
                    </span>
                    <span>updated {timeAgo(r.updatedAt)}</span>
                  </div>
                </div>
                {connected ? (
                  <Pill tone="green">
                    <Dot color={MESH.green} size={5} />
                    connected
                  </Pill>
                ) : picked ? (
                  <Pill tone="green">
                    <Dot color={MESH.green} size={5} />
                    added
                  </Pill>
                ) : (
                  <span
                    className="font-mono"
                    style={{
                      padding: "4px 10px",
                      borderRadius: 4,
                      border: `1px solid ${MESH.amber}`,
                      color: MESH.amber,
                      fontSize: 10.5,
                      fontWeight: 500,
                    }}
                  >
                    + add
                  </span>
                )}
              </button>
            );
          })}
          {!loadingRepos && remoteRepos.length === 0 && (
            <p className="font-mono" style={{ fontSize: 11.5, color: MESH.fgMute }}>
              no repos match. Try a different query or type <code>owner/repo</code> exactly.
            </p>
          )}
        </div>
    </div>
  );
}

function LocalTab({
  view,
  workspaceRoot,
  browseList,
  browseLoading,
  browseError,
  onBrowse,
  onUseFolder,
  onChangeFolder,
  scanStatus,
  scanResult,
  scanError,
  selections,
  connectedKeys,
  onAdd,
}: {
  view: LocalView;
  workspaceRoot: string | null;
  browseList: ListResponse | null;
  browseLoading: boolean;
  browseError: string | null;
  onBrowse: (p?: string | null) => void;
  onUseFolder: (p: string) => void;
  onChangeFolder: () => void;
  scanStatus: "idle" | "scanning" | "done" | "error";
  scanResult: ScanResponse | null;
  scanError: string | null;
  selections: Selection[];
  connectedKeys: Set<string>;
  onAdd: (r: ScannedRepo) => void;
}) {
  if (view === "browse") {
    return (
      <BrowseView
        list={browseList}
        loading={browseLoading}
        error={browseError}
        onBrowse={onBrowse}
        onUseFolder={onUseFolder}
      />
    );
  }

  const repoList: ScannedRepo[] =
    scanResult?.type === "repo"
      ? [scanResult.repo]
      : scanResult?.type === "container"
        ? scanResult.repos
        : [];
  const truncated = scanResult?.type === "container" ? scanResult.truncated : false;
  const empty = scanResult?.type === "empty";

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <WorkspaceBanner
        path={workspaceRoot}
        onChange={onChangeFolder}
        scanning={scanStatus === "scanning"}
      />

      {scanError && (
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
          {scanError}
        </div>
      )}

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "12px 24px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {scanStatus === "scanning" && repoList.length === 0 && (
          <p
            className="font-mono"
            style={{ fontSize: 11.5, color: MESH.fgMute, lineHeight: 1.6 }}
          >
            scanning for git repos…
          </p>
        )}

        {empty && (
          <p
            className="font-mono"
            style={{ fontSize: 11.5, color: MESH.fgMute, lineHeight: 1.6 }}
          >
            no git repos found under this folder (depth 0 + 1). Try a different folder.
          </p>
        )}

        {truncated && (
          <p
            className="font-mono"
            style={{ fontSize: 10.5, color: MESH.amber, margin: 0 }}
          >
            showing first 200 entries — refine the path to see the rest.
          </p>
        )}

        {repoList.map((r) => {
          const picked = selections.some((s) => s.kind === "local" && s.path === r.path);
          const ownerRepo =
            r.githubOwner && r.githubRepo
              ? `${r.githubOwner}/${r.githubRepo}`.toLowerCase()
              : null;
          const connected =
            connectedKeys.has(r.path.toLowerCase()) ||
            connectedKeys.has(r.name.toLowerCase()) ||
            (ownerRepo !== null && connectedKeys.has(ownerRepo));
          const inactive = picked || connected;
          return (
            <button
              key={r.path}
              onClick={() => onAdd(r)}
              disabled={inactive}
              style={{
                textAlign: "left",
                padding: "12px 14px",
                borderRadius: 7,
                border: `1px solid ${inactive ? "rgba(48,164,108,0.28)" : MESH.border}`,
                background: inactive ? "rgba(48,164,108,0.04)" : MESH.bgElev,
                display: "flex",
                alignItems: "center",
                gap: 12,
                cursor: inactive ? "default" : "pointer",
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  minWidth: 0,
                  flex: 1,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span
                    className="font-mono"
                    style={{
                      fontSize: 12.5,
                      color: MESH.fg,
                      fontWeight: 500,
                    }}
                  >
                    {r.githubOwner && r.githubRepo
                      ? `${r.githubOwner}/${r.githubRepo}`
                      : r.name}
                  </span>
                  {r.isWorktree && <Pill tone="amber">worktree</Pill>}
                  {r.isDirty && <Pill tone="amber">dirty</Pill>}
                  {!r.hasOrigin && <Pill tone="dim">no origin</Pill>}
                  {r.currentBranch === "HEAD" && <Pill tone="red">detached</Pill>}
                </div>
                <span
                  className="font-mono"
                  style={{
                    fontSize: 10.5,
                    color: MESH.fgMute,
                    direction: "rtl",
                    textAlign: "left",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={r.path}
                >
                  {r.path}
                </span>
                <div
                  className="font-mono"
                  style={{ fontSize: 10, color: MESH.fgMute, display: "flex", gap: 10 }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <NavIcon kind="branch" color={MESH.fgMute} size={10} />
                    {r.currentBranch}
                  </span>
                  <span>{r.branches.length} branches</span>
                </div>
              </div>
              {connected ? (
                <Pill tone="green">
                  <Dot color={MESH.green} size={5} />
                  connected
                </Pill>
              ) : picked ? (
                <Pill tone="green">
                  <Dot color={MESH.green} size={5} />
                  added
                </Pill>
              ) : (
                <span
                  className="font-mono"
                  style={{
                    padding: "4px 10px",
                    borderRadius: 4,
                    border: `1px solid ${MESH.amber}`,
                    color: MESH.amber,
                    fontSize: 10.5,
                    fontWeight: 500,
                  }}
                >
                  + add
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function WorkspaceBanner({
  path,
  onChange,
  scanning,
}: {
  path: string | null;
  onChange: () => void;
  scanning: boolean;
}) {
  if (!path) return null;
  return (
    <div
      style={{
        padding: "12px 24px",
        borderBottom: `1px solid ${MESH.border}`,
        background: "rgba(245,165,36,0.04)",
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <NavIcon kind="branch" color={MESH.amber} size={12} />
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
        <span
          className="font-mono"
          style={{
            fontSize: 9.5,
            color: MESH.fgMute,
            textTransform: "uppercase",
            letterSpacing: "0.14em",
          }}
        >
          Workspace
        </span>
        <span
          className="font-mono"
          title={path}
          style={{
            fontSize: 12.5,
            color: MESH.fg,
            fontWeight: 500,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {path}
        </span>
      </div>
      {scanning && <Pill tone="amber">scanning…</Pill>}
      <button
        onClick={onChange}
        className="font-mono"
        style={{
          padding: "5px 11px",
          borderRadius: 5,
          border: `1px solid ${MESH.border}`,
          background: "transparent",
          color: MESH.fgDim,
          fontSize: 11,
          cursor: "pointer",
        }}
      >
        change folder
      </button>
    </div>
  );
}

function BrowseView({
  list,
  loading,
  error,
  onBrowse,
  onUseFolder,
}: {
  list: ListResponse | null;
  loading: boolean;
  error: string | null;
  onBrowse: (p?: string | null) => void;
  onUseFolder: (p: string) => void;
}) {
  const current = list?.path ?? "";
  const entries = list?.entries ?? [];
  const parent = list?.parent ?? null;
  const home = list?.home ?? "";
  const crumbs = breadcrumbs(current, home);

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div
        style={{
          padding: "14px 24px",
          borderBottom: `1px solid ${MESH.border}`,
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <button
          onClick={() => onBrowse(parent)}
          disabled={!parent}
          className="font-mono"
          style={{
            padding: "4px 10px",
            borderRadius: 5,
            border: `1px solid ${MESH.border}`,
            background: "transparent",
            color: parent ? MESH.fgDim : MESH.fgMute,
            fontSize: 11,
            cursor: parent ? "pointer" : "default",
            opacity: parent ? 1 : 0.5,
          }}
        >
          ← up
        </button>
        <button
          onClick={() => onBrowse(home)}
          className="font-mono"
          style={{
            padding: "4px 10px",
            borderRadius: 5,
            border: `1px solid ${MESH.border}`,
            background: "transparent",
            color: MESH.fgDim,
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          home
        </button>
        <div
          className="font-mono"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            flexWrap: "wrap",
            flex: 1,
            minWidth: 0,
            fontSize: 11.5,
            color: MESH.fgDim,
          }}
          title={current}
        >
          {crumbs.map((c, i) => (
            <span key={c.path} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              {i > 0 && <span style={{ color: MESH.fgMute }}>/</span>}
              <button
                onClick={() => onBrowse(c.path)}
                className="font-mono"
                style={{
                  background: "transparent",
                  border: "none",
                  color: i === crumbs.length - 1 ? MESH.fg : MESH.fgDim,
                  cursor: "pointer",
                  fontSize: 11.5,
                  padding: 0,
                }}
              >
                {c.label}
              </button>
            </span>
          ))}
        </div>
      </div>

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
          overflowY: "auto",
          padding: "12px 24px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {loading && (
          <p className="font-mono" style={{ fontSize: 11.5, color: MESH.fgMute }}>
            loading…
          </p>
        )}
        {!loading && entries.length === 0 && !error && (
          <p
            className="font-mono"
            style={{ fontSize: 11.5, color: MESH.fgMute, lineHeight: 1.6 }}
          >
            empty folder. Go up, pick a different one, or use this folder as-is.
          </p>
        )}
        {entries.map((e) => (
          <button
            key={e.path}
            onClick={() => onBrowse(e.path)}
            className="font-mono"
            style={{
              textAlign: "left",
              padding: "9px 12px",
              borderRadius: 6,
              border: `1px solid ${MESH.border}`,
              background: e.isGitRepo ? "rgba(245,165,36,0.05)" : MESH.bgElev,
              display: "flex",
              alignItems: "center",
              gap: 10,
              cursor: "pointer",
              fontSize: 12,
              color: MESH.fg,
            }}
          >
            <span style={{ color: e.isGitRepo ? MESH.amber : MESH.fgMute, fontSize: 13 }}>▸</span>
            <span
              style={{
                flex: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {e.name}
            </span>
            {e.isGitRepo && <Pill tone="amber">git</Pill>}
          </button>
        ))}
      </div>

      <div
        style={{
          padding: "14px 24px",
          borderTop: `1px solid ${MESH.border}`,
          background: MESH.bgElev,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <span
            className="font-mono"
            style={{
              fontSize: 9.5,
              color: MESH.fgMute,
              textTransform: "uppercase",
              letterSpacing: "0.14em",
            }}
          >
            Use this folder
          </span>
          <div
            className="font-mono"
            title={current}
            style={{
              fontSize: 11.5,
              color: MESH.fgDim,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              marginTop: 2,
            }}
          >
            {current || "—"}
          </div>
        </div>
        <button
          onClick={() => current && onUseFolder(current)}
          disabled={!current || loading}
          className="font-mono"
          style={{
            padding: "8px 14px",
            borderRadius: 6,
            border: `1px solid ${MESH.amber}`,
            background: MESH.amber,
            color: "#0B0B0C",
            fontSize: 12,
            fontWeight: 500,
            cursor: !current || loading ? "default" : "pointer",
            opacity: !current || loading ? 0.6 : 1,
          }}
        >
          Use this folder
        </button>
      </div>
    </div>
  );
}

function breadcrumbs(p: string, home: string): { label: string; path: string }[] {
  if (!p) return [];
  const parts = p.split("/").filter(Boolean);
  const out: { label: string; path: string }[] = [];
  let acc = "";
  // Shorten home to ~
  if (home && p.startsWith(home)) {
    const rel = p.slice(home.length).split("/").filter(Boolean);
    out.push({ label: "~", path: home });
    acc = home;
    for (const seg of rel) {
      acc = acc + "/" + seg;
      out.push({ label: seg, path: acc });
    }
    return out;
  }
  out.push({ label: "/", path: "/" });
  for (const seg of parts) {
    acc = acc + "/" + seg;
    out.push({ label: seg, path: acc });
  }
  return out;
}

function SelectionCard({
  sel,
  branches,
  protectedBranches,
  onBranch,
  onRemove,
}: {
  sel: Selection;
  branches: string[];
  protectedBranches: Set<string>;
  onBranch: (b: string) => void;
  onRemove: () => void;
}) {
  const title =
    sel.kind === "github"
      ? `${sel.owner}/${sel.repo}`
      : sel.githubOwner && sel.githubRepo
        ? `${sel.githubOwner}/${sel.githubRepo}`
        : sel.name;
  const needsBranch = sel.kind === "local" && !sel.branch;
  return (
    <div
      style={{
        padding: "12px 14px",
        borderRadius: 7,
        border: `1px solid ${needsBranch ? MESH.red : MESH.border}`,
        background: MESH.bg,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Dot color={sel.kind === "local" ? MESH.fgDim : MESH.amber} />
        <span
          className="font-mono"
          style={{
            fontSize: 12,
            color: MESH.fg,
            fontWeight: 500,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </span>
        {sel.kind === "local" && <Pill tone="dim">local</Pill>}
        {sel.kind === "local" && sel.isWorktree && <Pill tone="amber">worktree</Pill>}
        {sel.kind === "local" && !sel.hasOrigin && <Pill tone="dim">no origin</Pill>}
        <button
          onClick={onRemove}
          aria-label="remove"
          className="font-mono"
          style={{
            marginLeft: "auto",
            background: "transparent",
            border: `1px solid ${MESH.border}`,
            color: MESH.fgMute,
            borderRadius: 4,
            padding: "2px 8px",
            fontSize: 10.5,
            cursor: "pointer",
          }}
        >
          remove
        </button>
      </div>
      {sel.kind === "local" && (
        <span
          className="font-mono"
          title={sel.path}
          style={{
            fontSize: 10.5,
            color: MESH.fgMute,
            direction: "rtl",
            textAlign: "left",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {sel.path}
        </span>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          className="font-mono"
          style={{
            fontSize: 10,
            color: needsBranch ? MESH.red : MESH.fgMute,
            textTransform: "uppercase",
            letterSpacing: "0.12em",
          }}
        >
          {needsBranch ? "pick a base branch" : "base branch (PR target)"}
        </span>
      </div>
      <select
        value={sel.branch}
        onChange={(e) => onBranch(e.target.value)}
        className="font-mono"
        style={{
          background: MESH.bgInput,
          color: MESH.fg,
          border: `1px solid ${needsBranch ? MESH.red : MESH.border}`,
          borderRadius: 5,
          padding: "6px 10px",
          fontSize: 11.5,
          outline: "none",
        }}
      >
        {needsBranch && <option value="">— select —</option>}
        {branches.length === 0 ? (
          sel.branch ? (
            <option value={sel.branch}>{sel.branch}</option>
          ) : null
        ) : (
          branches.map((b) => (
            <option key={b} value={b}>
              {b}
              {protectedBranches.has(b) ? " (protected)" : ""}
            </option>
          ))
        )}
      </select>
    </div>
  );
}

function IngestLayout({
  thinking,
  isRunning,
  status,
  repos,
  invariantCount,
  memory,
  ingestTokens,
  degraded,
  cacheRead,
  cacheCreate,
  retries,
  cloneLog,
  selections,
  onReset,
  onAbort,
}: {
  thinking: string;
  isRunning: boolean;
  status: Status;
  repos: RepoState[];
  invariantCount: number;
  memory: MemoryView | null;
  ingestTokens: number | null;
  degraded: boolean;
  cacheRead: number | null;
  cacheCreate: number | null;
  retries: { attempt: number; reason: string }[];
  cloneLog: string[];
  selections: Selection[];
  onReset: () => void;
  onAbort: () => void;
}) {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "grid",
        gridTemplateColumns: "1fr 380px",
      }}
    >
      <div style={{ minHeight: 0, padding: 16, borderRight: `1px solid ${MESH.border}` }}>
        <ThinkingPanelRaw
          text={thinking}
          tokens={thinking.length}
          active={isRunning}
          header={phaseHeader(status, repos, memory)}
          sub={phaseSub(status, repos, memory, invariantCount, cloneLog)}
          placeholder={
            status === "cloning" && cloneLog.length > 0
              ? cloneLog.join("\n")
              : status === "cloning"
                ? "— starting clone —"
                : "— waiting for first token —"
          }
        />
      </div>

      <aside
        style={{
          background: MESH.bgElev,
          padding: 20,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            aria-hidden
            style={{ width: 4, height: 14, background: MESH.amber, borderRadius: 1 }}
          />
          <span className="mesh-hud" style={{ color: MESH.fgDim }}>
            WORKSPACE
          </span>
          <Pill tone="amber">
            {repos.length} repos · {repos.filter((r) => r.status === "ready").length} ready
          </Pill>
          <button
            onClick={status === "done" || status === "error" ? onReset : onAbort}
            className="font-mono"
            style={{
              marginLeft: "auto",
              padding: "4px 10px",
              borderRadius: 4,
              border: `1px solid ${MESH.border}`,
              background: "transparent",
              color: MESH.fgDim,
              fontSize: 10.5,
              cursor: "pointer",
            }}
          >
            {status === "done" || status === "error" ? "add more" : "abort"}
          </button>
        </div>

        {repos.map((r) => (
          <RepoIngestCard key={r.name} r={r} selections={selections} />
        ))}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <Stat label="invariants" value={invariantCount} />
          <Stat label="flows" value={memory?.cross_repo_flows.length ?? 0} />
          <Stat label="cache hit" value={cacheRead ?? 0} format="tokens" />
          <Stat label="ingest" value={Math.round((ingestTokens ?? 0) / 1000)} suffix="k" />
        </div>

        {cacheCreate !== null && cacheCreate > 0 && (
          <p className="font-mono" style={{ fontSize: 10, color: MESH.fgMute, lineHeight: 1.5 }}>
            cache created: {cacheCreate.toLocaleString()} tokens — subsequent Build / Ship
            calls will read from cache.
          </p>
        )}
        {degraded && <Pill tone="amber">degraded · priority exts only</Pill>}

        {retries.length > 0 && (
          <div
            style={{
              padding: 10,
              borderRadius: 6,
              border: "1px solid rgba(245,165,36,0.3)",
              background: "rgba(245,165,36,0.04)",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <span className="font-mono" style={{ fontSize: 11, color: MESH.amber }}>
              {retries.length} retr{retries.length > 1 ? "ies" : "y"}
            </span>
            {retries.map((r) => (
              <div
                key={r.attempt}
                className="font-mono"
                style={{ fontSize: 10, color: MESH.fgMute }}
              >
                #{r.attempt}: {r.reason.slice(0, 120)}
              </div>
            ))}
          </div>
        )}

        {memory && memory.invariants.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span
              className="font-mono"
              style={{
                fontSize: 10,
                color: MESH.fgMute,
                textTransform: "uppercase",
                letterSpacing: "0.14em",
              }}
            >
              Invariants
            </span>
            <p
              className="font-mono"
              style={{
                fontSize: 10.5,
                color: MESH.fgMute,
                lineHeight: 1.55,
                margin: 0,
              }}
            >
              Cross-repo rules Claude extracted from the code — single source of
              pricing, consistent auth, shared schemas. Ship enforces them on every
              change. Each invariant is backed by file-level evidence.
            </p>
            {memory.invariants.map((inv) => (
              <div
                key={inv.id}
                style={{
                  padding: "10px 12px",
                  borderRadius: 6,
                  border: `1px solid ${MESH.border}`,
                  background: MESH.bg,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <span className="font-mono" style={{ fontSize: 11, color: MESH.amber }}>
                  {inv.id}
                </span>
                <p style={{ fontSize: 12, color: MESH.fg, margin: 0, lineHeight: 1.5 }}>
                  {inv.statement}
                </p>
                <span className="font-mono" style={{ fontSize: 10, color: MESH.fgMute }}>
                  {inv.evidence.length} evidence
                </span>
              </div>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}

function RepoIngestCard({ r, selections }: { r: RepoState; selections: Selection[] }) {
  const tone: "amber" | "green" | "default" =
    r.status === "ready" ? "green" : r.status === "analyzing" ? "amber" : "default";
  const label = r.status === "ready" ? "indexed" : r.status === "analyzing" ? "scanning" : "queued";
  const match = selections.find((s) => selectionMatchesRepo(s, r.name));
  return (
    <div
      style={{
        padding: "12px 14px",
        borderRadius: 7,
        border: `1px solid ${MESH.border}`,
        background: MESH.bg,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Dot
          color={
            r.status === "ready"
              ? MESH.green
              : r.status === "analyzing"
                ? MESH.amber
                : MESH.fgMute
          }
        />
        <span
          className="font-mono"
          style={{
            fontSize: 12,
            color: MESH.fg,
            fontWeight: 500,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {r.name}
        </span>
        <div style={{ marginLeft: "auto" }}>
          <Pill tone={tone}>{label}</Pill>
        </div>
      </div>
      {match && (
        <div
          style={{ display: "flex", alignItems: "center", gap: 6, color: MESH.fgMute }}
          className="font-mono"
        >
          <NavIcon kind="branch" color={MESH.fgMute} size={10} />
          <span style={{ fontSize: 10.5 }}>base: {match.branch}</span>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
        {r.files !== undefined && (
          <span className="font-mono" style={{ fontSize: 13, color: MESH.fg, fontWeight: 500 }}>
            {r.files}
            <span style={{ fontSize: 10, color: MESH.fgMute, marginLeft: 4 }}>files</span>
          </span>
        )}
        {r.tokens_est !== undefined && (
          <span className="font-mono" style={{ fontSize: 13, color: MESH.fg, fontWeight: 500 }}>
            ~{Math.round(r.tokens_est / 1000)}k
            <span style={{ fontSize: 10, color: MESH.fgMute, marginLeft: 4 }}>tokens</span>
          </span>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  format,
  suffix,
}: {
  label: string;
  value: number;
  format?: "tokens";
  suffix?: string;
}) {
  const display =
    format === "tokens" && value > 1000
      ? `${Math.round(value / 1000)}k`
      : `${value.toLocaleString()}${suffix ?? ""}`;
  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: 6,
        border: `1px solid ${MESH.border}`,
        background: MESH.bg,
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div className="mesh-hud" style={{ color: MESH.fgMute }}>
        {label}
      </div>
      <div
        className="mesh-display"
        style={{
          fontSize: 22,
          color: MESH.fg,
          letterSpacing: "-0.02em",
          lineHeight: 1,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {display}
      </div>
    </div>
  );
}

function CodeBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* noop */
    }
  }
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: MESH.bg,
        border: `1px solid ${MESH.border}`,
        borderRadius: 6,
        padding: "8px 10px 8px 14px",
        width: "fit-content",
        maxWidth: "100%",
      }}
    >
      <code
        className="font-mono"
        style={{
          fontSize: 12.5,
          color: MESH.amber,
          whiteSpace: "pre",
          overflow: "auto",
        }}
      >
        {text}
      </code>
      <button
        onClick={copy}
        className="font-mono"
        style={{
          background: "transparent",
          border: `1px solid ${MESH.border}`,
          borderRadius: 4,
          padding: "3px 8px",
          fontSize: 10.5,
          color: copied ? MESH.green : MESH.fgDim,
          cursor: "pointer",
          marginLeft: 4,
          flexShrink: 0,
        }}
      >
        {copied ? "copied" : "copy"}
      </button>
    </div>
  );
}

function selectionKey(s: Selection): string {
  return s.kind === "github" ? `gh:${s.owner}/${s.repo}` : `local:${s.path}`;
}

function selectionLabel(s: Selection): string {
  if (s.kind === "github") return `${s.owner}/${s.repo}`;
  if (s.githubOwner && s.githubRepo) return `${s.githubOwner}/${s.githubRepo}`;
  return s.name;
}

function selectionMatchesRepo(s: Selection, repoName: string): boolean {
  // ingestRepos names repos by the basename of the local path. For GitHub,
  // that basename is `owner-repo`; for local sources it's the folder basename.
  if (s.kind === "github") {
    return repoName === `${s.owner}-${s.repo}` || repoName === `${s.owner}/${s.repo}`;
  }
  const base = s.path.split("/").filter(Boolean).pop() ?? "";
  return repoName === base || repoName === s.name;
}

function phaseHeader(
  status: Status,
  repos: RepoState[],
  memory: MemoryView | null,
): string {
  if (status === "cloning") return "Cloning repositories";
  if (status === "error") return "Stopped";
  if (status === "done") return "Memory built";
  if (memory) return "Linking cross-repo flows";
  if (repos.some((r) => r.status === "analyzing")) return "Navigating repositories";
  return "Extended thinking";
}

function phaseSub(
  status: Status,
  repos: RepoState[],
  memory: MemoryView | null,
  invariantCount: number,
  cloneLog: string[],
): string {
  if (status === "cloning") {
    const last = cloneLog[cloneLog.length - 1];
    return last ? last.toLowerCase() : "gh clone";
  }
  if (status === "done") {
    const flows = memory?.cross_repo_flows.length ?? 0;
    return `${invariantCount} invariants · ${flows} flows`;
  }
  if (status === "error") return "see error above";
  if (memory) {
    const flows = memory.cross_repo_flows.length;
    return `mapping ${invariantCount} invariants · ${flows} flows`;
  }
  const total = repos.length;
  const ready = repos.filter((r) => r.status === "ready").length;
  const active = repos.find((r) => r.status === "analyzing");
  if (active) return `scanning ${active.name} (${ready}/${total})`;
  if (total > 0) return `scanning ${total} repo${total === 1 ? "" : "s"}`;
  return "preparing workspace";
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

// ── Project strip / gate / brief ────────────────────────────────────────

function ProjectStrip({
  projects,
  currentProjectId,
  onSelect,
  onCreate,
  onViewProject,
}: {
  projects: {
    id: string;
    name: string;
    label?: string;
    color: string;
    repos: string[];
  }[];
  currentProjectId: string | null;
  onSelect: (id: string) => void | Promise<void>;
  onCreate: () => void;
  onViewProject?: () => void;
}) {
  const current = projects.find((p) => p.id === currentProjectId);
  const others = projects.filter((p) => p.id !== currentProjectId);
  return (
    <div
      style={{
        padding: "18px 24px",
        borderBottom: `1px solid ${MESH.border}`,
        background:
          "linear-gradient(180deg, rgba(245,165,36,0.04) 0%, rgba(11,11,12,0) 100%)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          flexWrap: "wrap",
        }}
      >
        <span
          className="font-mono"
          style={{
            fontSize: 10,
            color: MESH.fgMute,
            textTransform: "uppercase",
            letterSpacing: "0.14em",
          }}
        >
          Adding repos to
        </span>
        {current ? (
          <>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 10,
                padding: "6px 14px",
                borderRadius: 8,
                background: "rgba(245,165,36,0.08)",
                border: "1px solid rgba(245,165,36,0.3)",
              }}
            >
              <Dot color={colorToHex(current.color)} size={9} />
              <span
                style={{
                  fontSize: 16,
                  fontWeight: 600,
                  color: MESH.fg,
                  letterSpacing: "-0.01em",
                }}
              >
                {current.name}
              </span>
              {current.label && (
                <span
                  className="font-mono"
                  style={{
                    fontSize: 11,
                    color: MESH.fgMute,
                    marginLeft: 2,
                  }}
                >
                  · {current.label}
                </span>
              )}
            </div>
            <span
              className="font-mono"
              style={{
                fontSize: 11,
                color: MESH.fgMute,
                letterSpacing: "0.02em",
              }}
            >
              {current.repos.length} repo
              {current.repos.length === 1 ? "" : "s"} already connected
            </span>
            {current.repos.length > 0 ? (
              onViewProject ? (
                <button
                  type="button"
                  onClick={onViewProject}
                  className="font-mono"
                  style={{
                    marginLeft: "auto",
                    fontSize: 11,
                    color: MESH.amber,
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  ← Back to project
                </button>
              ) : (
                <a
                  href={`/projects/${encodeURIComponent(current.id)}`}
                  className="font-mono"
                  style={{
                    marginLeft: "auto",
                    fontSize: 11,
                    color: MESH.amber,
                    textDecoration: "none",
                  }}
                >
                  View project →
                </a>
              )
            ) : null}
          </>
        ) : (
          <span
            className="font-mono"
            style={{ fontSize: 12.5, color: MESH.fgDim }}
          >
            no project selected — create one to continue
          </span>
        )}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <span
          className="font-mono"
          style={{
            fontSize: 10,
            color: MESH.fgMute,
            textTransform: "uppercase",
            letterSpacing: "0.14em",
          }}
        >
          Switch
        </span>
        {others.length === 0 && (
          <span
            className="font-mono"
            style={{ fontSize: 11, color: MESH.fgMute }}
          >
            no other projects
          </span>
        )}
        {others.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => void onSelect(p.id)}
            style={{
              padding: "4px 10px",
              borderRadius: 999,
              background: "transparent",
              border: `1px solid ${MESH.border}`,
              color: MESH.fgDim,
              fontSize: 11.5,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Dot color={colorToHex(p.color)} size={5} />
            {p.name}
          </button>
        ))}
        <button
          type="button"
          onClick={onCreate}
          style={{
            padding: "4px 10px",
            borderRadius: 999,
            background: "transparent",
            border: `1px dashed ${MESH.border}`,
            color: MESH.fgDim,
            fontSize: 11.5,
            cursor: "pointer",
          }}
        >
          + New project
        </button>
      </div>
    </div>
  );
}

function CreateProjectGate({
  required,
  name,
  label,
  busy,
  onNameChange,
  onLabelChange,
  onCreate,
  onClose,
}: {
  required: boolean;
  name: string;
  label: string;
  busy: boolean;
  onNameChange: (v: string) => void;
  onLabelChange: (v: string) => void;
  onCreate: () => void;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(11,11,12,0.78)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: MESH.bgElev,
          border: `1px solid ${MESH.borderHi}`,
          borderRadius: 12,
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div>
          <h3
            style={{
              margin: 0,
              fontSize: 17,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              color: MESH.fg,
            }}
          >
            {required ? "Create your first project" : "New project"}
          </h3>
          <p
            style={{
              margin: "6px 0 0",
              fontSize: 13,
              color: MESH.fgDim,
              lineHeight: 1.55,
            }}
          >
            {required
              ? "A project groups related repos so Mesh can share memory, skills and cross-repo flows between them."
              : "Group repos under a new project."}
          </p>
        </div>
        <input
          autoFocus
          placeholder="Project name · e.g. Flarebill"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) onCreate();
          }}
          style={{
            padding: "9px 11px",
            background: MESH.bgInput,
            border: `1px solid ${MESH.border}`,
            borderRadius: 6,
            color: MESH.fg,
            fontSize: 13,
            outline: "none",
          }}
        />
        <input
          placeholder="Label (optional) · e.g. SaaS billing"
          value={label}
          onChange={(e) => onLabelChange(e.target.value)}
          style={{
            padding: "9px 11px",
            background: MESH.bgInput,
            border: `1px solid ${MESH.border}`,
            borderRadius: 6,
            color: MESH.fg,
            fontSize: 13,
            outline: "none",
          }}
        />
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 4,
          }}
        >
          {!required && (
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "7px 14px",
                background: "transparent",
                border: `1px solid ${MESH.border}`,
                borderRadius: 6,
                color: MESH.fgDim,
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            disabled={busy || !name.trim()}
            onClick={onCreate}
            style={{
              padding: "7px 16px",
              background: MESH.amber,
              border: `1px solid ${MESH.amber}`,
              borderRadius: 6,
              color: "#0B0B0C",
              fontSize: 12.5,
              fontWeight: 600,
              cursor: busy ? "wait" : "pointer",
              opacity: !name.trim() ? 0.5 : 1,
            }}
          >
            {busy ? "Creating…" : "Create project"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProjectBriefPanel({
  projectId,
  projectName,
  repos,
  status,
  thinking,
  brief,
  error,
  onRegenerate,
}: {
  projectId: string;
  projectName: string;
  repos: string[];
  status: "idle" | "streaming" | "done" | "error";
  thinking: string;
  brief: {
    description: string;
    relationships: { from: string; to: string; kind: string; note?: string }[];
  } | null;
  error: string | null;
  onRegenerate: () => void;
}) {
  const streaming = status === "streaming";
  return (
    <div
      style={{
        margin: "20px 24px 24px",
        padding: 20,
        border: `1px solid ${MESH.border}`,
        borderRadius: 10,
        background: MESH.bgElev,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
          gap: 12,
        }}
      >
        <div>
          <div
            className="font-mono"
            style={{
              fontSize: 10,
              color: MESH.amber,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              marginBottom: 4,
            }}
          >
            Project brief · {projectName}
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: MESH.fg }}>
            Relationship map across {repos.length} repos
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={onRegenerate}
            disabled={streaming}
            style={{
              padding: "6px 12px",
              background: "transparent",
              border: `1px solid ${MESH.border}`,
              borderRadius: 6,
              color: streaming ? MESH.fgMute : MESH.fgDim,
              fontSize: 11.5,
              cursor: streaming ? "wait" : "pointer",
            }}
          >
            {status === "idle"
              ? "Generate"
              : streaming
                ? "Thinking…"
                : "Regenerate"}
          </button>
          <a
            href={`/projects/${encodeURIComponent(projectId)}`}
            style={{
              padding: "6px 14px",
              background: MESH.amber,
              border: `1px solid ${MESH.amber}`,
              borderRadius: 6,
              color: "#0B0B0C",
              fontSize: 12,
              fontWeight: 600,
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            View project →
          </a>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 20,
          minHeight: 320,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            minHeight: 0,
          }}
        >
          {brief ? (
            <>
              <p
                style={{
                  margin: 0,
                  fontSize: 13,
                  lineHeight: 1.7,
                  color: MESH.fg,
                }}
              >
                {brief.description}
              </p>
              {brief.relationships.length > 0 && (
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
                    Relationships · {brief.relationships.length}
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
                    {brief.relationships.map((r, i) => (
                      <li
                        key={i}
                        className="font-mono"
                        style={{ fontSize: 11.5, color: MESH.fgDim }}
                      >
                        <span style={{ color: MESH.fg }}>{r.from}</span>
                        <span style={{ margin: "0 6px", color: MESH.fgMute }}>
                          {r.kind} →
                        </span>
                        <span style={{ color: MESH.fg }}>{r.to}</span>
                        {r.note && (
                          <span
                            style={{
                              marginLeft: 8,
                              color: MESH.fgMute,
                            }}
                          >
                            · {r.note}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <ThinkingPanelRaw
              text={thinking}
              active={streaming}
              placeholder="Claude is writing the project brief…"
            />
          )}
          {error && (
            <div
              className="font-mono"
              style={{ fontSize: 11, color: MESH.red }}
            >
              {error}
            </div>
          )}
        </div>
        <div
          style={{
            border: `1px solid ${MESH.border}`,
            borderRadius: 10,
            background:
              "radial-gradient(60% 60% at 50% 40%, rgba(245,165,36,0.05) 0%, rgba(11,11,12,0) 70%), #0C0C0E",
            padding: 16,
            position: "relative",
            minHeight: 300,
          }}
        >
          {brief ? (
            <ProjectGraph repos={repos} relationships={brief.relationships} />
          ) : (
            <div
              className="font-mono"
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: MESH.fgMute,
                fontSize: 11,
                letterSpacing: "0.02em",
              }}
            >
              {streaming ? "building graph…" : "graph will appear here"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function colorToHex(c: string): string {
  switch (c) {
    case "amber":
      return MESH.amber;
    case "violet":
      return MESH.purple;
    case "blue":
      return MESH.blue;
    case "green":
      return MESH.green;
    case "red":
      return MESH.red;
    case "slate":
      return MESH.fgMute;
    default:
      return MESH.amber;
  }
}
