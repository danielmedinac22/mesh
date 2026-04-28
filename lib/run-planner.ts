import { z } from "zod";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getEngine, DEFAULT_MODEL } from "@/lib/engine";
import { loadMemory, type Memory } from "@/lib/memory";
import {
  getProject,
  getReposForProject,
  loadConfig,
  paths,
  type ProjectRecord,
  type RepoRecord,
} from "@/lib/mesh-state";
import { detectRunPlan, type RepoRunPlan } from "@/lib/repo-runner";

// ──────────────────────────────────────────────────────────────────────────
// Run planner — Claude-driven boot ordering for project-level Run.
//
// Reads each repo in a project (run plan + brief + federation hints) and
// asks Claude to emit a structured ordering: which repos boot in which
// "wave", who's a host vs remote, and which to skip. The user sees the
// rationale streamed and can override per-repo via the UI.
// ──────────────────────────────────────────────────────────────────────────

export const RoleSchema = z.enum([
  "host",
  "remote",
  "backend",
  "standalone",
  "skipped",
]);
export type RunRole = z.infer<typeof RoleSchema>;

export const RunPlanRepoSchema = z.object({
  name: z.string().min(1),
  role: RoleSchema,
  // 1-based wave. null = skipped.
  wave: z.number().int().positive().nullable(),
  reason: z.string().min(1),
});

export const RunPlanPayloadSchema = z.object({
  // Each entry is the list of repo names that boot together.
  // Index 0 boots first, index 1 after wave 0 stabilizes, etc.
  waves: z.array(z.array(z.string().min(1))).default([]),
  perRepo: z.array(RunPlanRepoSchema).default([]),
  rationale: z.string().min(1),
});
export type RunPlanPayload = z.infer<typeof RunPlanPayloadSchema>;

export type StoredRunPlan = RunPlanPayload & {
  generated_at: string;
  // Hash of the inputs we fed Claude — used to detect staleness later.
  input_signature: string;
};

export type RunPlannerEvent =
  | { type: "thinking"; delta: string }
  | { type: "text"; delta: string }
  | { type: "done"; plan: StoredRunPlan; duration_ms: number }
  | { type: "error"; message: string };

// ── system prompt ────────────────────────────────────────────────────────

type RepoContext = {
  name: string;
  brief?: { purpose: string; cross_repo_role: string };
  plan: RepoRunPlan;
};

function buildSystem(
  project: ProjectRecord,
  contexts: RepoContext[],
): string {
  const lines: string[] = [];
  lines.push(
    "You are a senior platform engineer planning how to boot a poly-repo federated project locally.",
  );
  lines.push(
    "Given each repo's purpose, run script, env-var needs and federation hints, decide:",
  );
  lines.push("- which repos to boot (skip the ones with no run script).");
  lines.push("- which `role` each one plays (host | remote | backend | standalone | skipped).");
  lines.push(
    "- in what wave they boot. Wave N starts after wave N-1 has at least one ready repo.",
  );
  lines.push(
    "- a short rationale (2-3 sentences) tying the choices to concrete signals you saw.",
  );
  lines.push("");
  lines.push("Heuristic:");
  lines.push(
    "- Module-Federation `host` apps (the shell that imports remotes) should boot LAST so remotes are reachable.",
  );
  lines.push(
    "- Remotes referenced in a host's federation config should boot FIRST.",
  );
  lines.push(
    "- Backends (no UI, exposes APIs over HTTP) usually go in wave 1 alongside remotes.",
  );
  lines.push(
    "- Standalone (no federation, no obvious cross-repo role) goes in any wave; pick wave 1.",
  );
  lines.push(
    "- Repos without a `recommendedScript` AND no docker-compose: role=skipped, wave=null.",
  );
  lines.push(
    "- If a repo is the only one in the project, role=standalone, wave=1.",
  );
  lines.push("");
  lines.push("Output VALID JSON only, no markdown fences, no prose outside the JSON.");
  lines.push("Schema:");
  lines.push("{");
  lines.push('  "waves": [["repoB","repoC"], ["repoA"]],');
  lines.push('  "perRepo": [');
  lines.push(
    '    {"name": string, "role": "host|remote|backend|standalone|skipped", "wave": number|null, "reason": string}',
  );
  lines.push("  ],");
  lines.push('  "rationale": "2-3 sentences"');
  lines.push("}");
  lines.push("");
  lines.push(
    "Constraints: every repo in the input MUST appear exactly once in `perRepo`. `waves` and `perRepo[].wave` MUST agree.",
  );
  lines.push("Use thinking to organize before emitting JSON. Be concise.");
  lines.push("");
  lines.push(`# Project: ${project.name}`);
  if (project.label) lines.push(`Label: ${project.label}`);
  if (project.description) lines.push(`Description: ${project.description}`);
  lines.push("");
  lines.push("## Repos");
  for (const c of contexts) {
    lines.push(`### ${c.name}`);
    if (c.brief) {
      lines.push(`Purpose: ${c.brief.purpose}`);
      if (c.brief.cross_repo_role)
        lines.push(`Cross-repo role: ${c.brief.cross_repo_role}`);
    }
    lines.push(`Package manager: ${c.plan.packageManager ?? "unknown"}`);
    lines.push(
      `Recommended script: ${c.plan.recommendedScript ?? "(none — likely no Node.js entrypoint)"}`,
    );
    if (c.plan.scripts.length > 0) {
      lines.push(
        `Scripts available: ${c.plan.scripts.map((s) => s.name).join(", ")}`,
      );
    }
    if (c.plan.federation.length > 0) {
      lines.push("Federation hints:");
      for (const f of c.plan.federation) {
        const remotes =
          f.remotes && f.remotes.length > 0
            ? ` remotes: ${f.remotes.join(", ")}`
            : "";
        lines.push(`  - ${f.kind} in ${f.file}${remotes}`);
      }
    }
    if (c.plan.monorepo) {
      lines.push(`Monorepo: ${c.plan.monorepo.tool} (${c.plan.monorepo.file})`);
    }
    if (c.plan.dockerCompose) {
      lines.push(
        `Docker compose: ${c.plan.dockerCompose.file} (services: ${c.plan.dockerCompose.services.join(", ") || "n/a"})`,
      );
    }
    if (c.plan.env.required.length > 0) {
      lines.push(
        `Env vars needed (from ${c.plan.env.source}): ${c.plan.env.required.length} keys`,
      );
    }
    if (c.plan.readmeExcerpt) {
      lines.push("README excerpt:");
      lines.push(c.plan.readmeExcerpt.slice(0, 600));
    }
    lines.push("");
  }
  return lines.join("\n");
}

function extractJson(raw: string): string {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return raw;
  return raw.slice(start, end + 1);
}

function inputSignature(contexts: RepoContext[]): string {
  // Cheap, deterministic fingerprint so the API can decide staleness later.
  const parts = contexts
    .map((c) => {
      const fed =
        c.plan.federation
          .map((f) => `${f.kind}:${f.file}:${(f.remotes ?? []).join(",")}`)
          .join(";") || "";
      return `${c.name}|${c.plan.recommendedScript ?? ""}|${fed}|${c.brief?.cross_repo_role ?? ""}`;
    })
    .sort()
    .join("\n");
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < parts.length; i++) {
    h ^= parts.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

// ── persistence ──────────────────────────────────────────────────────────

function planPath(projectId: string): string {
  return path.join(paths.root, "projects", projectId, "run-plan.json");
}

export async function readCachedPlan(
  projectId: string,
): Promise<StoredRunPlan | null> {
  try {
    const raw = await fs.readFile(planPath(projectId), "utf8");
    return JSON.parse(raw) as StoredRunPlan;
  } catch {
    return null;
  }
}

async function savePlan(
  projectId: string,
  plan: StoredRunPlan,
): Promise<void> {
  const p = planPath(projectId);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(plan, null, 2) + "\n", "utf8");
}

// ── input gathering ──────────────────────────────────────────────────────

async function gatherContexts(
  repos: RepoRecord[],
  memory: Memory | null,
): Promise<RepoContext[]> {
  const memByName = new Map((memory?.repos ?? []).map((r) => [r.name, r]));
  const out: RepoContext[] = [];
  for (const r of repos) {
    const plan = await detectRunPlan(r.localPath);
    const m = memByName.get(r.name);
    out.push({
      name: r.name,
      brief: m?.brief
        ? { purpose: m.brief.purpose, cross_repo_role: m.brief.cross_repo_role }
        : undefined,
      plan,
    });
  }
  return out;
}

function fallbackPlan(contexts: RepoContext[]): RunPlanPayload {
  // Used when Claude fails to emit valid JSON. Boot everything that has a
  // run script in wave 1 in parallel; skip the rest. Conservative, never
  // wrong, just not as smart.
  const perRepo = contexts.map((c) => {
    if (!c.plan.recommendedScript) {
      return {
        name: c.name,
        role: "skipped" as const,
        wave: null,
        reason: "no run script detected",
      };
    }
    return {
      name: c.name,
      role: "standalone" as const,
      wave: 1,
      reason: "fallback all-parallel ordering",
    };
  });
  const wave1 = perRepo.filter((r) => r.wave === 1).map((r) => r.name);
  return {
    waves: wave1.length > 0 ? [wave1] : [],
    perRepo,
    rationale:
      "Claude couldn't produce a structured plan; falling back to all-parallel for runnable repos.",
  };
}

function reconcileWaves(plan: RunPlanPayload): RunPlanPayload {
  // Defensive: ensure `waves` and `perRepo[].wave` agree. perRepo wins.
  const byWave = new Map<number, string[]>();
  for (const r of plan.perRepo) {
    if (r.wave === null) continue;
    if (!byWave.has(r.wave)) byWave.set(r.wave, []);
    byWave.get(r.wave)!.push(r.name);
  }
  const sorted = [...byWave.keys()].sort((a, b) => a - b);
  return {
    ...plan,
    waves: sorted.map((w) => byWave.get(w)!),
  };
}

// ── public entry point ───────────────────────────────────────────────────

export async function* generateRunPlan(
  projectId: string,
): AsyncIterable<RunPlannerEvent> {
  const startedAt = Date.now();
  const project = await getProject(projectId);
  if (!project) {
    yield { type: "error", message: `project not found: ${projectId}` };
    return;
  }
  const repos = await getReposForProject(projectId);
  if (repos.length === 0) {
    yield { type: "error", message: "project has no repos yet" };
    return;
  }

  const memory = await loadMemory(projectId);
  const contexts = await gatherContexts(repos, memory);
  const config = await loadConfig();
  const engine = getEngine(config.engineMode);
  const system = buildSystem(project, contexts);

  let fullText = "";
  try {
    for await (const ev of engine.run({
      prompt:
        "Emit the JSON object described in the system prompt. JSON only, no fences, no commentary.",
      system,
      cacheSystem: true,
      wrapThinking: true,
    })) {
      if (ev.type === "thinking") {
        yield { type: "thinking", delta: ev.delta };
      } else if (ev.type === "text") {
        fullText += ev.delta;
        yield { type: "text", delta: ev.delta };
      } else if (ev.type === "error") {
        yield { type: "error", message: ev.message };
        return;
      }
    }
    let payload: RunPlanPayload;
    try {
      const parsed = RunPlanPayloadSchema.parse(
        JSON.parse(extractJson(fullText)),
      );
      payload = reconcileWaves(parsed);
    } catch {
      payload = fallbackPlan(contexts);
    }
    const stored: StoredRunPlan = {
      ...payload,
      generated_at: new Date().toISOString(),
      input_signature: inputSignature(contexts),
    };
    await savePlan(projectId, stored);
    yield {
      type: "done",
      plan: stored,
      duration_ms: Date.now() - startedAt,
    };
  } catch (err) {
    yield {
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export { DEFAULT_MODEL };
