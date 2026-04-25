import { NextRequest } from "next/server";
import path from "node:path";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ingestRepos, type IngestResult } from "@/lib/repo-ingest";
import { buildConnectSystemPrompt, CONNECT_USER_PROMPT } from "@/lib/prompts/connect";
import { getEngine, DEFAULT_MODEL } from "@/lib/engine";
import { MemorySchema, parseMemoryJson, saveMemory, type Memory, type RepoBrief } from "@/lib/memory";
import { generateRepoBrief, saveRepoBrief } from "@/lib/repo-brief";
import {
  addProject,
  addRepo,
  getProject,
  loadConfig,
  projectSlug,
  safeRepoName,
  setCurrentProject,
  updateProject,
} from "@/lib/mesh-state";
import { bootstrapProjects } from "@/lib/migrations";
import { gh, ghInstalled, GhError } from "@/lib/gh-cli";

type GhSource = { owner: string; repo: string; branch: string };
type LocalSource = {
  path: string;
  branch: string;
  name: string;
  githubOwner?: string;
  githubRepo?: string;
};

const execFileP = promisify(execFile);

const WORKSPACE_DIR = path.join(process.cwd(), ".mesh", "workspace");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConnectEvent =
  | { type: "clone-start"; sources: GhSource[] }
  | { type: "clone-progress"; owner: string; repo: string; stage: "cloning" | "fetching" | "checkout" | "ready"; message?: string }
  | { type: "ingest-start"; paths: string[] }
  | { type: "ingest-done"; totalTokens: number; degraded: boolean; repos: { name: string; files: number; tokens_est: number }[] }
  | { type: "repo-ready"; name: string }
  | { type: "thinking"; delta: string }
  | { type: "text"; delta: string }
  | { type: "meta"; ttft_ms: number }
  | { type: "memory"; memory: Memory }
  | { type: "brief-start"; name: string }
  | { type: "repo-brief"; name: string; brief: RepoBrief }
  | { type: "brief-error"; name: string; message: string }
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

export async function POST(req: NextRequest) {
  await bootstrapProjects();
  const body = await req.json().catch(() => ({}));

  // Resolve project: either existing projectId or inline createProject { name, label?, color? }.
  let projectId: string | null = null;
  if (typeof body?.projectId === "string" && body.projectId.trim()) {
    const existing = await getProject(body.projectId.trim());
    if (!existing) {
      return Response.json(
        { error: `project not found: ${body.projectId}` },
        { status: 400 },
      );
    }
    projectId = existing.id;
  } else if (body?.createProject && typeof body.createProject === "object") {
    const cp = body.createProject as Record<string, unknown>;
    const name = typeof cp.name === "string" ? cp.name.trim() : "";
    if (!name) {
      return Response.json(
        { error: "createProject.name required" },
        { status: 400 },
      );
    }
    const id = projectSlug(name);
    const existing = await getProject(id);
    const now = new Date().toISOString();
    if (existing) {
      projectId = existing.id;
    } else {
      const color =
        typeof cp.color === "string" ? (cp.color as string) : "amber";
      await addProject({
        id,
        name,
        label: typeof cp.label === "string" ? cp.label : undefined,
        color: color as never,
        repos: [],
        createdAt: now,
        updatedAt: now,
      });
      projectId = id;
    }
  } else {
    return Response.json(
      { error: "projectId or createProject required" },
      { status: 400 },
    );
  }

  const rawSources = Array.isArray(body?.sources) ? (body.sources as unknown[]) : [];
  const sources: GhSource[] = rawSources
    .map((s) => {
      if (!s || typeof s !== "object") return null;
      const o = s as Record<string, unknown>;
      const owner = typeof o.owner === "string" ? o.owner : null;
      const repo = typeof o.repo === "string" ? o.repo : null;
      const branch = typeof o.branch === "string" ? o.branch : null;
      if (!owner || !repo || !branch) return null;
      return { owner, repo, branch };
    })
    .filter((s): s is GhSource => s !== null);

  const rawLocals = Array.isArray(body?.localSources) ? (body.localSources as unknown[]) : [];
  const localSources: LocalSource[] = rawLocals
    .map((l): LocalSource | null => {
      if (!l || typeof l !== "object") return null;
      const o = l as Record<string, unknown>;
      const lp = typeof o.path === "string" ? o.path : null;
      const branch = typeof o.branch === "string" ? o.branch : null;
      const name = typeof o.name === "string" ? o.name : null;
      if (!lp || !branch || !name) return null;
      const entry: LocalSource = { path: lp, branch, name };
      if (typeof o.githubOwner === "string") entry.githubOwner = o.githubOwner;
      if (typeof o.githubRepo === "string") entry.githubRepo = o.githubRepo;
      return entry;
    })
    .filter((l): l is LocalSource => l !== null);

  if (sources.length === 0 && localSources.length === 0) {
    return Response.json(
      { error: "sources[] or localSources[] required" },
      { status: 400 },
    );
  }

  // Validate any local sources up-front. GitHub sources are validated after clone.
  for (const l of localSources) {
    if (!path.isAbsolute(l.path)) {
      return Response.json(
        { error: `localSources[].path must be absolute: ${l.path}` },
        { status: 400 },
      );
    }
    if (!safeRepoName(l.name)) {
      return Response.json(
        { error: `localSources[].name not safe: ${l.name}` },
        { status: 400 },
      );
    }
    try {
      const stat = await fs.stat(l.path);
      if (!stat.isDirectory()) {
        return Response.json({ error: `not a directory: ${l.path}` }, { status: 400 });
      }
    } catch {
      return Response.json({ error: `path not found: ${l.path}` }, { status: 400 });
    }
    try {
      await execFileP("git", ["-C", l.path, "rev-parse", "--git-dir"], {
        timeout: 5_000,
        maxBuffer: 1 * 1024 * 1024,
      });
    } catch {
      return Response.json(
        { error: `not a git repo: ${l.path}` },
        { status: 400 },
      );
    }
  }

  const encoder = new TextEncoder();
  const startedAt = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: ConnectEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      };

      try {
        const config = await loadConfig();

        // Resolve paths: clone/update GitHub sources into .mesh/workspace first.
        const clonedPaths: string[] = [];
        const sourceByPath = new Map<string, GhSource>();
        if (sources.length > 0) {
          if (!(await ghInstalled())) {
            throw new Error(
              "GitHub CLI (gh) is not installed. Install it and run `gh auth login`, then retry.",
            );
          }
          await fs.mkdir(WORKSPACE_DIR, { recursive: true });
          send({ type: "clone-start", sources });
          for (const src of sources) {
            const name = workspaceName(src);
            const dest = path.join(WORKSPACE_DIR, name);
            await prepareRepo(dest, src, (stage, message) =>
              send({ type: "clone-progress", owner: src.owner, repo: src.repo, stage, message }),
            );
            clonedPaths.push(dest);
            sourceByPath.set(dest, src);
          }
        }

        // Locals are used as-is (no clone, no checkout, no pull — respect the user's tree).
        const localByPath = new Map<string, LocalSource>();
        const localPaths: string[] = [];
        for (const l of localSources) {
          const resolved = path.resolve(l.path);
          localByPath.set(resolved, l);
          localPaths.push(resolved);
        }

        const paths = [...clonedPaths, ...localPaths];

        send({ type: "ingest-start", paths });
        const ingest = await ingestRepos(paths);
        send({
          type: "ingest-done",
          totalTokens: ingest.totalTokens,
          degraded: ingest.degraded,
          repos: ingest.repos.map((r) => ({
            name: r.name,
            files: r.files.length,
            tokens_est: estimateRepoChars(r) / 4,
          })),
        });

        const ingestedAt = new Date().toISOString();
        for (const repo of ingest.repos) {
          const existing = path.resolve(repo.localPath);
          const gh = sourceByPath.get(existing);
          const local = localByPath.get(existing);
          await addRepo({
            name: repo.name,
            localPath: existing,
            githubOwner: gh?.owner ?? local?.githubOwner,
            githubRepo: gh?.repo ?? local?.githubRepo,
            defaultBranch: gh?.branch ?? local?.branch ?? "main",
            projectId: projectId!,
            connectedAt: ingestedAt,
            filesIndexed: repo.files.length,
            tokensEst: Math.round(estimateRepoChars(repo) / 4),
            ingestedAt,
          });
        }

        // Attach new repo names to the project roster (dedupe).
        {
          const project = await getProject(projectId!);
          if (project) {
            const merged = Array.from(
              new Set([...project.repos, ...ingest.repos.map((r) => r.name)]),
            );
            await updateProject(projectId!, { repos: merged });
          }
          await setCurrentProject(projectId!);
        }

        const memory = await runWithRetries(ingest, config.engineMode, send);
        const duration_ms = Date.now() - startedAt;
        const withMeta: Memory = {
          ...memory,
          meta: {
            ...(memory.meta ?? {}),
            generated_at: new Date().toISOString(),
            model: DEFAULT_MODEL,
            engine_mode: config.engineMode,
            duration_ms,
            repos_ingested: ingest.repos.map((r) => r.name),
          },
        };
        await saveMemory(projectId!, withMeta);
        send({ type: "memory", memory: withMeta });

        // Per-repo briefs run in parallel after memory is ready. Failures
        // on one repo must not block the rest — each is isolated and its
        // failure reported as a brief-error event.
        await Promise.all(
          ingest.repos.map(async (r) => {
            send({ type: "brief-start", name: r.name });
            try {
              const brief = await generateRepoBrief(r, config.engineMode);
              await saveRepoBrief(projectId!, r.name, brief);
              send({ type: "repo-brief", name: r.name, brief });
            } catch (err) {
              send({
                type: "brief-error",
                name: r.name,
                message: err instanceof Error ? err.message : String(err),
              });
            }
          }),
        );

        send({
          type: "done",
          duration_ms: Date.now() - startedAt,
          engine_mode: config.engineMode,
          input_tokens: withMeta.meta?.input_tokens,
          output_tokens: withMeta.meta?.output_tokens,
          cache_creation_input_tokens: withMeta.meta?.cache_creation_input_tokens,
          cache_read_input_tokens: withMeta.meta?.cache_read_input_tokens,
        });
      } catch (err) {
        send({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function workspaceName(src: GhSource): string {
  const joined = `${src.owner}-${src.repo}`;
  // Replace any char that isn't safe for a dir / repo record name
  return joined.replace(/[^A-Za-z0-9._-]+/g, "-");
}

async function prepareRepo(
  dest: string,
  src: GhSource,
  onStage: (stage: "cloning" | "fetching" | "checkout" | "ready", message?: string) => void,
): Promise<void> {
  const slug = `${src.owner}/${src.repo}`;
  let exists = false;
  try {
    const stat = await fs.stat(path.join(dest, ".git"));
    exists = stat.isDirectory();
  } catch {
    exists = false;
  }

  if (!exists) {
    // Guard: if a non-repo dir lives there, bail. Avoid blowing away user data.
    try {
      const stat = await fs.stat(dest);
      if (stat.isDirectory()) {
        const entries = await fs.readdir(dest);
        if (entries.length > 0) {
          throw new Error(`workspace dir exists but is not a git repo: ${dest}`);
        }
      }
    } catch (err) {
      if ((err as { code?: string }).code && (err as { code?: string }).code !== "ENOENT") throw err;
    }
    onStage("cloning", `gh repo clone ${slug}`);
    try {
      await gh(["repo", "clone", slug, dest, "--", "--branch", src.branch], {
        timeout: 120_000,
      });
    } catch (err) {
      if (err instanceof GhError && /not found|did not match/i.test(err.stderr)) {
        // Branch may not exist yet; clone default then fetch
        await gh(["repo", "clone", slug, dest], { timeout: 120_000 });
        await gitCmd(["fetch", "origin", src.branch], dest);
        await gitCmd(["checkout", src.branch], dest);
      } else {
        throw err;
      }
    }
  } else {
    onStage("fetching", `git fetch origin ${src.branch}`);
    await gitCmd(["fetch", "origin", src.branch], dest);
    onStage("checkout", `git checkout ${src.branch}`);
    await gitCmd(["checkout", src.branch], dest);
    await gitCmd(["pull", "--ff-only", "origin", src.branch], dest).catch(() => {
      // non-fatal: demo environments may have diverged local state
    });
  }
  onStage("ready");
  // Sanity check the resulting dir becomes a valid workspace slot.
  const base = path.basename(dest);
  if (!safeRepoName(base)) {
    throw new Error(`unsafe workspace name: ${base}`);
  }
}

async function gitCmd(args: string[], cwd: string): Promise<void> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const exec = promisify(execFile);
  await exec("git", args, { cwd, maxBuffer: 20 * 1024 * 1024, timeout: 60_000 });
}

function estimateRepoChars(repo: {
  files: { content: string }[];
  gitLog: string;
  adrs: { content: string }[];
}): number {
  let c = 0;
  for (const f of repo.files) c += f.content.length;
  c += repo.gitLog.length;
  for (const a of repo.adrs) c += a.content.length;
  return c;
}

async function runWithRetries(
  ingest: IngestResult,
  mode: "raw" | "agent",
  send: (ev: ConnectEvent) => void,
): Promise<Memory> {
  const engine = getEngine(mode);
  const system = buildConnectSystemPrompt(ingest);
  const MAX_ATTEMPTS = 3;
  let lastError: string = "no attempts run";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const corrective =
      attempt === 1
        ? CONNECT_USER_PROMPT
        : `${CONNECT_USER_PROMPT}\n\nYour previous attempt did not produce valid JSON matching the schema. Error: ${lastError}\nEmit ONLY the JSON object after </thinking>. No markdown fences, no prose.`;

    if (attempt > 1) {
      send({ type: "retry", attempt, reason: lastError });
    }

    let fullText = "";
    let fullThinking = "";
    let metaInputTokens: number | undefined;
    let metaOutputTokens: number | undefined;
    let metaCacheCreate: number | undefined;
    let metaCacheRead: number | undefined;
    const readyRepos = new Set<string>();
    const repoNames = new Set(ingest.repos.map((r) => r.name));

    for await (const ev of engine.run({
      prompt: corrective,
      system,
      cacheSystem: true,
      wrapThinking: false,
    })) {
      if (ev.type === "thinking") {
        fullThinking += ev.delta;
        send({ type: "thinking", delta: ev.delta });
      } else if (ev.type === "text") {
        fullText += ev.delta;
        // Connect streams JSON directly (no thinking wrap). Route text to
        // the UI's reasoning panel so the user watches the memory emerge.
        send({ type: "thinking", delta: ev.delta });
        for (const name of repoNames) {
          if (!readyRepos.has(name) && mentionsRepoCompletion(fullText, name)) {
            readyRepos.add(name);
            send({ type: "repo-ready", name });
          }
        }
      } else if (ev.type === "meta") {
        send({ type: "meta", ttft_ms: ev.ttft_ms });
      } else if (ev.type === "done") {
        metaInputTokens = ev.input_tokens;
        metaOutputTokens = ev.output_tokens;
        metaCacheCreate = ev.cache_creation_input_tokens;
        metaCacheRead = ev.cache_read_input_tokens;
      } else if (ev.type === "error") {
        lastError = ev.message;
        continue;
      }
    }

    for (const name of repoNames) {
      if (!readyRepos.has(name)) send({ type: "repo-ready", name });
    }

    try {
      const memory = parseMemoryJson(fullText);
      MemorySchema.parse(memory);
      return {
        ...memory,
        meta: {
          ...(memory.meta ?? {}),
          input_tokens: metaInputTokens,
          output_tokens: metaOutputTokens,
          cache_creation_input_tokens: metaCacheCreate,
          cache_read_input_tokens: metaCacheRead,
        },
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  throw new Error(`Connect failed after ${MAX_ATTEMPTS} attempts: ${lastError}`);
}

// Connect emits repo summaries sequentially in the JSON output. We mark a
// repo as "ready" once we've seen its name token followed by at least one
// "evidence" block closing (}]) — strong signal its invariant list is being
// populated. Not perfect; a final sweep on "done" marks stragglers.
function mentionsRepoCompletion(stream: string, repoName: string): boolean {
  const marker = `"name": "${repoName}"`;
  const idx = stream.indexOf(marker);
  if (idx === -1) return false;
  const after = stream.slice(idx + marker.length);
  return /\}\s*\]/.test(after);
}
