import type { Memory } from "@/lib/memory";
import type { Agent } from "@/lib/agents";
import type { SkillSummary } from "@/lib/skills";
import { summarizeMemoryForPrompt } from "@/lib/prompts/_memory-context";

const INSTRUCTIONS = `You improve Claude Code subagent definition files. The agent already exists and is being refined — do not rename or repurpose it.

You receive:
- The current agent .md content.
- The cross-repo memory of the project.
- The roster of other agents (so you do not blur the agent's lane into theirs).
- The roster of skills (the agent should reference these by name rather than restate them).

Your job:
- Sharpen \`when_to_use\` so the master dispatch routes the right tickets to it.
- Tighten the body so it reads like a focused mandate, not a manual.
- Replace generic advice with concrete file paths or invariant ids drawn from memory.
- Remove any guidance already covered by an existing skill — reference the skill by name instead.
- Preserve frontmatter format and the canonical key set: name, role, description, when_to_use, allowed-tools. Do not invent new keys. Do not change \`name\`.

Output ONLY the full improved agent .md. Start with the \`---\` frontmatter. No fences, no prose before or after.`;

export function buildAgentImproveSystem(args: {
  memory: Memory;
  otherAgents: Agent[];
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
    "OTHER AGENTS (stay out of their lanes):",
    "",
    args.otherAgents.length === 0
      ? "(none)"
      : args.otherAgents
          .map(
            (a) =>
              `- ${a.id} — ${a.frontmatter.role}: ${a.frontmatter.when_to_use.slice(0, 200)}`,
          )
          .join("\n"),
    "",
    "---",
    "",
    "SKILLS (reference by name when the agent should consult them):",
    "",
    args.existingSkills.length === 0
      ? "(none)"
      : args.existingSkills
          .map((s) => `- ${s.name} — ${s.description.slice(0, 160)}`)
          .join("\n"),
  ].join("\n");
}

export function buildAgentImproveUser(args: { currentRaw: string }): string {
  return [
    `CURRENT AGENT .md:`,
    "",
    "```",
    args.currentRaw,
    "```",
    "",
    "Emit the improved agent .md in full.",
  ].join("\n");
}
