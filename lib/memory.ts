import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";

const MEMORY_PATH = path.join(process.cwd(), ".mesh", "memory.json");

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

const RepoSummarySchema = z.object({
  name: z.string(),
  symbol_count: z.number().int().nonnegative().default(0),
  invariants: z.array(InvariantSchema).default([]),
  adrs: z
    .array(z.object({ path: z.string(), title: z.string() }))
    .default([]),
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

export const MemorySchema = z.object({
  repos: z.array(RepoSummarySchema),
  cross_repo_flows: z.array(CrossRepoFlowSchema).default([]),
  invariants: z.array(InvariantSchema).default([]),
  call_graph: z.array(CallGraphEdgeSchema).default([]),
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

export async function saveMemory(m: Memory): Promise<void> {
  MemorySchema.parse(m);
  await fs.mkdir(path.dirname(MEMORY_PATH), { recursive: true });
  await fs.writeFile(MEMORY_PATH, JSON.stringify(m, null, 2) + "\n", "utf8");
}

export async function loadMemory(): Promise<Memory | null> {
  try {
    const raw = await fs.readFile(MEMORY_PATH, "utf8");
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

export async function hasMemory(): Promise<boolean> {
  return (await loadMemory()) !== null;
}

export const memoryPath = MEMORY_PATH;
