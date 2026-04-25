import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";

const AGENTS_DIR = path.join(process.cwd(), ".claude", "agents");

// Agent ids are slug-shaped: lowercase alpha first, then alphanumerics or
// hyphens. This loosened from a closed enum so users can author additional
// agents in .claude/agents/ via Settings. The four "base" ids below remain
// the only ones wired into the multi-agent build dispatch (see
// build-pipeline.ts) — custom agents are visible in Settings but inert until
// dispatch is taught to handle them.
export const AgentIdSchema = z
  .string()
  .min(1)
  .max(48)
  .regex(/^[a-z][a-z0-9-]*$/, "agent id must be a kebab-case slug");
export type AgentId = z.infer<typeof AgentIdSchema>;

export const BASE_AGENT_IDS = [
  "frontend",
  "backend",
  "product",
  "qa",
] as const;
export type BaseAgentId = (typeof BASE_AGENT_IDS)[number];
export function isBaseAgentId(id: string): id is BaseAgentId {
  return (BASE_AGENT_IDS as readonly string[]).includes(id);
}

export const AgentFrontmatterSchema = z.object({
  name: AgentIdSchema,
  role: z.string().min(1),
  description: z.string().min(1),
  when_to_use: z.string().min(1),
  "allowed-tools": z.union([z.string(), z.array(z.string())]).optional(),
});
export type AgentFrontmatter = z.infer<typeof AgentFrontmatterSchema>;

export type Agent = {
  id: AgentId;
  filePath: string;
  frontmatter: AgentFrontmatter;
  body: string;
};

// Loads all agent definitions from .claude/agents/*.md. Base agents come
// first in fixed order, then user-created agents alphabetically. Both the
// Settings editor and the master dispatch see a stable roster.
export async function loadAgents(): Promise<Agent[]> {
  try {
    const entries = await fs.readdir(AGENTS_DIR, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile() && e.name.endsWith(".md"));
    const agents: Agent[] = [];
    for (const f of files) {
      const filePath = path.join(AGENTS_DIR, f.name);
      try {
        const raw = await fs.readFile(filePath, "utf8");
        const parsed = parseAgentFile(raw);
        agents.push({
          id: parsed.frontmatter.name,
          filePath,
          frontmatter: parsed.frontmatter,
          body: parsed.body.trim(),
        });
      } catch {
        // skip unparseable agents
      }
    }
    agents.sort((a, b) => {
      const ai = (BASE_AGENT_IDS as readonly string[]).indexOf(a.id);
      const bi = (BASE_AGENT_IDS as readonly string[]).indexOf(b.id);
      if (ai !== -1 || bi !== -1) {
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      }
      return a.id.localeCompare(b.id);
    });
    return agents;
  } catch {
    return [];
  }
}

function parseAgentFile(raw: string): {
  frontmatter: AgentFrontmatter;
  body: string;
} {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) {
    throw new Error("agent file missing frontmatter");
  }
  const obj = parseSimpleYaml(match[1]);
  const frontmatter = AgentFrontmatterSchema.parse({
    name: obj.name,
    role: obj.role,
    description: obj.description,
    when_to_use: obj.when_to_use,
    "allowed-tools": obj["allowed-tools"] as AgentFrontmatter["allowed-tools"],
  });
  return { frontmatter, body: match[2] ?? "" };
}

function parseSimpleYaml(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      i += 1;
      continue;
    }
    const m = trimmed.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
    if (!m) {
      i += 1;
      continue;
    }
    const key = m[1];
    const rest = m[2];
    if (rest.length > 0) {
      out[key] = stripQuotes(rest.trim());
      i += 1;
    } else {
      const list: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const ln = lines[j];
        const lm = ln.match(/^\s+-\s+(.*)$/);
        if (!lm) break;
        list.push(stripQuotes(lm[1].trim()));
        j += 1;
      }
      out[key] = list.length > 0 ? list : "";
      i = j;
    }
  }
  return out;
}

function stripQuotes(s: string): string {
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

// Reads a single agent file by id. Returns null if missing or unparseable.
export async function getAgent(id: string): Promise<Agent | null> {
  const slug = AgentIdSchema.safeParse(id);
  if (!slug.success) return null;
  const filePath = path.join(AGENTS_DIR, `${slug.data}.md`);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = parseAgentFile(raw);
    return {
      id: parsed.frontmatter.name,
      filePath,
      frontmatter: parsed.frontmatter,
      body: parsed.body.trim(),
    };
  } catch {
    return null;
  }
}

// Reads the raw .md (unparsed) for an agent — used by the editor to round-trip
// frontmatter formatting that our minimal YAML parser drops.
export async function getAgentRaw(id: string): Promise<string | null> {
  const slug = AgentIdSchema.safeParse(id);
  if (!slug.success) return null;
  const filePath = path.join(AGENTS_DIR, `${slug.data}.md`);
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

// Writes a complete agent .md after validating its frontmatter. The caller
// must ensure the id in the URL matches frontmatter.name; this function
// trusts the parsed value.
export async function saveAgent(raw: string): Promise<Agent> {
  const parsed = parseAgentFile(raw);
  await fs.mkdir(AGENTS_DIR, { recursive: true });
  const filePath = path.join(AGENTS_DIR, `${parsed.frontmatter.name}.md`);
  await fs.writeFile(filePath, raw, "utf8");
  return {
    id: parsed.frontmatter.name,
    filePath,
    frontmatter: parsed.frontmatter,
    body: parsed.body.trim(),
  };
}

// Creates a new agent file. Refuses to overwrite an existing id so the user
// is forced to pick a unique slug.
export async function createAgentFromRaw(raw: string): Promise<Agent> {
  const parsed = parseAgentFile(raw);
  const id = parsed.frontmatter.name;
  const filePath = path.join(AGENTS_DIR, `${id}.md`);
  try {
    await fs.access(filePath);
    throw new Error(`agent already exists: ${id}`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  await fs.mkdir(AGENTS_DIR, { recursive: true });
  await fs.writeFile(filePath, raw, "utf8");
  return {
    id,
    filePath,
    frontmatter: parsed.frontmatter,
    body: parsed.body.trim(),
  };
}

// Deletes a custom agent. Refuses to delete one of the four base agents that
// the build dispatch depends on.
export async function deleteAgent(id: string): Promise<void> {
  if (isBaseAgentId(id)) {
    throw new Error(`cannot delete base agent: ${id}`);
  }
  const slug = AgentIdSchema.safeParse(id);
  if (!slug.success) throw new Error("invalid agent id");
  const filePath = path.join(AGENTS_DIR, `${slug.data}.md`);
  await fs.unlink(filePath);
}

// Compact roster description the master sees to make the dispatch decision.
// Keeps each agent to name + role + when_to_use — no body, no examples.
export function renderAgentRoster(agents: Agent[]): string {
  const parts: string[] = [];
  parts.push("Available agents:");
  parts.push("");
  for (const a of agents) {
    parts.push(`## ${a.id} — ${a.frontmatter.role}`);
    parts.push(`${a.frontmatter.description}`);
    parts.push(`When to use: ${a.frontmatter.when_to_use}`);
    parts.push("");
  }
  return parts.join("\n");
}
