import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";

const AGENTS_DIR = path.join(process.cwd(), ".claude", "agents");

export const AgentIdSchema = z.enum(["frontend", "backend", "product", "qa"]);
export type AgentId = z.infer<typeof AgentIdSchema>;

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

// Loads all agent definitions from .claude/agents/*.md. Order is fixed
// (frontend, backend, product, qa) regardless of directory iteration order,
// so the UI and the master dispatch see a stable roster.
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
    const order: AgentId[] = ["frontend", "backend", "product", "qa"];
    agents.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
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
