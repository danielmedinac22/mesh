import type { Memory } from "@/lib/memory";
import type { Agent } from "@/lib/agents";
import type { SkillSummary } from "@/lib/skills";
import { summarizeMemoryForPrompt } from "@/lib/prompts/_memory-context";

const INSTRUCTIONS = `You author Claude Code subagent definition files (agent .md files) from a short user intent. Each agent file lives in .claude/agents/<id>.md and is loaded into a master dispatch that decides which specialists tackle a ticket.

You are given:
- The user's free-form intent (one sentence or paragraph describing the kind of agent they want).
- The cross-repo memory of the project (invariants, evidence, flows).
- The roster of agents that already exist (id, role, when_to_use, body excerpt).
- The roster of skills already defined for the project (so you can reference them rather than restate the rules in the agent body).

Your job:
- Pick a kebab-case \`name\` (the agent's id) that is short, role-led, and does not collide with any existing agent. Examples: "sql-cost-auditor", "schema-migrations".
- Write a short \`role\` (3-6 words) and a \`description\` sentence.
- Write \`when_to_use\` describing the ticket signals that should route to this agent — phrase it so the master can match it against ticket text.
- Write a body (the agent's system prompt) that:
  - opens with one paragraph stating the agent's mandate,
  - references the project's existing skills by name when the agent should consult them (do not duplicate the skill content here),
  - cites at least one invariant id or evidence file path from memory when relevant,
  - lists the agent's "definition of done" — concrete artifacts it should emit (review notes, checks, suggested diffs).
- Use the canonical frontmatter keys only: name, role, description, when_to_use, allowed-tools.
- Keep the body grounded in concrete file paths and ids from memory rather than generic advice.

Output ONLY the full new agent .md content. Start with the \`---\` frontmatter. No fences, no prose before or after.`;

export function buildAgentGenerateSystem(args: {
  memory: Memory;
  existingAgents: Agent[];
  existingSkills: SkillSummary[];
}): string {
  return [
    INSTRUCTIONS,
    "",
    "---",
    "",
    "PROJECT MEMORY:",
    "",
    summarizeMemoryForPrompt(args.memory),
    "",
    "---",
    "",
    "EXISTING AGENTS (do not duplicate — pick a different niche):",
    "",
    renderExistingAgents(args.existingAgents),
    "",
    "---",
    "",
    "EXISTING SKILLS (reference by name when this agent should consult them):",
    "",
    renderExistingSkills(args.existingSkills),
  ].join("\n");
}

export function buildAgentGenerateUser(args: { intent: string }): string {
  return [`INTENT:`, args.intent.trim(), "", "Emit the complete new agent .md."].join(
    "\n",
  );
}

function renderExistingAgents(agents: Agent[]): string {
  if (agents.length === 0) return "(none)";
  const lines: string[] = [];
  for (const a of agents) {
    lines.push(`- ${a.id} — ${a.frontmatter.role}`);
    lines.push(`  description: ${a.frontmatter.description.slice(0, 200)}`);
    lines.push(`  when_to_use: ${a.frontmatter.when_to_use.slice(0, 200)}`);
  }
  return lines.join("\n");
}

function renderExistingSkills(skills: SkillSummary[]): string {
  if (skills.length === 0) return "(none)";
  return skills
    .map((s) => `- ${s.name} — ${s.description.slice(0, 160)}`)
    .join("\n");
}
