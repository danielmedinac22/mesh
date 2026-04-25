import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { paths as meshPaths } from "@/lib/mesh-state";

const EvidenceSchema = z.object({
  repo: z.string(),
  path: z.string(),
  line: z.number().int().nonnegative().default(1),
});

const InvariantSchema = z.object({
  id: z.string(),
  statement: z.string(),
  evidence: z.array(EvidenceSchema).min(1),
});

export const RepoBriefSchema = z.object({
  name: z.string(),
  purpose: z.string(),
  stack: z.array(z.string()).default([]),
  entry_points: z.array(z.string()).default([]),
  data_model: z.string().default(""),
  key_modules: z
    .array(z.object({ path: z.string(), role: z.string() }))
    .default([]),
  cross_repo_role: z.string().default(""),
  generated_at: z.string(),
});
export type RepoBrief = z.infer<typeof RepoBriefSchema>;

const RepoSummarySchema = z.object({
  name: z.string(),
  symbol_count: z.number().int().nonnegative().default(0),
  invariants: z.array(InvariantSchema).default([]),
  adrs: z
    .array(z.object({ path: z.string(), title: z.string() }))
    .default([]),
  brief: RepoBriefSchema.optional(),
});

const CrossRepoFlowSchema = z.object({
  id: z.string(),
  name: z.string(),
  repos: z.array(z.string()),
  entry: z.object({ repo: z.string(), path: z.string() }),
});

const CallGraphEdgeSchema = z.object({
  from: z.object({ repo: z.string(), symbol: z.string() }),
  to: z.object({ repo: z.string(), symbol: z.string() }),
});

export const RepoRelationshipSchema = z.object({
  from: z.string(),
  to: z.string(),
  kind: z.string(),
  note: z.string().optional(),
});
export type RepoRelationship = z.infer<typeof RepoRelationshipSchema>;

export const ProjectBriefSchema = z.object({
  description: z.string().default(""),
  relationships: z.array(RepoRelationshipSchema).default([]),
  generated_at: z.string().optional(),
});
export type ProjectBrief = z.infer<typeof ProjectBriefSchema>;

export const MemorySchema = z.object({
  repos: z.array(RepoSummarySchema),
  cross_repo_flows: z.array(CrossRepoFlowSchema).default([]),
  invariants: z.array(InvariantSchema).default([]),
  call_graph: z.array(CallGraphEdgeSchema).default([]),
  project_brief: ProjectBriefSchema.optional(),
  meta: z
    .object({
      generated_at: z.string().optional(),
      model: z.string().optional(),
      engine_mode: z.string().optional(),
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
      cache_creation_input_tokens: z.number().optional(),
      cache_read_input_tokens: z.number().optional(),
      duration_ms: z.number().optional(),
      repos_ingested: z.array(z.string()).optional(),
    })
    .optional(),
});

export type Memory = z.infer<typeof MemorySchema>;

export function parseMemoryJson(raw: string): Memory {
  // The model is instructed to emit JSON only, but we forgive markdown
  // fences, leading/trailing prose, or stray whitespace just in case.
  const body = extractJsonObject(stripFences(raw.trim()));
  const obj = JSON.parse(body);
  return MemorySchema.parse(obj);
}

function stripFences(s: string): string {
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/;
  const m = s.match(fence);
  return m ? m[1] : s;
}

function extractJsonObject(s: string): string {
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return s;
  return s.slice(start, end + 1);
}

export async function saveMemory(projectId: string, m: Memory): Promise<void> {
  MemorySchema.parse(m);
  const p = meshPaths.projectMemory(projectId);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(m, null, 2) + "\n", "utf8");
}

export async function loadMemory(projectId: string): Promise<Memory | null> {
  try {
    const raw = await fs.readFile(meshPaths.projectMemory(projectId), "utf8");
    return MemorySchema.parse(JSON.parse(raw));
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "ENOENT"
    ) {
      return null;
    }
    throw err;
  }
}

export async function hasMemory(projectId: string): Promise<boolean> {
  return (await loadMemory(projectId)) !== null;
}

// Update a single repo's brief in a project's memory.json. If memory does not
// yet exist or the repo is missing, the brief is written to a fresh placeholder
// summary so the dashboard / repo overview can still read it.
export async function updateRepoBrief(
  projectId: string,
  repoName: string,
  brief: RepoBrief,
): Promise<void> {
  const current: Memory =
    (await loadMemory(projectId)) ?? {
      repos: [],
      cross_repo_flows: [],
      invariants: [],
      call_graph: [],
    };
  const idx = current.repos.findIndex((r) => r.name === repoName);
  if (idx >= 0) {
    current.repos[idx] = { ...current.repos[idx], brief };
  } else {
    current.repos.push({
      name: repoName,
      symbol_count: 0,
      invariants: [],
      adrs: [],
      brief,
    });
  }
  await saveMemory(projectId, current);
}

export async function getRepoBrief(
  projectId: string,
  repoName: string,
): Promise<RepoBrief | null> {
  const m = await loadMemory(projectId);
  if (!m) return null;
  const repo = m.repos.find((r) => r.name === repoName);
  return repo?.brief ?? null;
}

export async function saveProjectBrief(
  projectId: string,
  brief: ProjectBrief,
): Promise<void> {
  const current: Memory =
    (await loadMemory(projectId)) ?? {
      repos: [],
      cross_repo_flows: [],
      invariants: [],
      call_graph: [],
    };
  current.project_brief = ProjectBriefSchema.parse({
    ...brief,
    generated_at: brief.generated_at ?? new Date().toISOString(),
  });
  await saveMemory(projectId, current);
}

export function memoryPathFor(projectId: string): string {
  return meshPaths.projectMemory(projectId);
}
