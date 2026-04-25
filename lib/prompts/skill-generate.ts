import type { Memory } from "@/lib/memory";
import type { SkillSummary } from "@/lib/skills";
import { summarizeMemoryForPrompt } from "@/lib/prompts/_memory-context";

const INSTRUCTIONS = `You author Claude Code SKILL.md files from a short user intent. A skill is an instruction file that fires when a diff matches its \`paths\` glob, and nudges the agent toward an invariant, a preferred pattern, or a stable fact about the codebase.

You are given:
- The user's free-form intent (one sentence or paragraph describing the rule, pattern, or fact they want captured).
- The target scope ("personal" or "project · <name>").
- The cross-repo memory of the project (invariants with evidence file paths, cross-repo flows, repo summaries).
- The roster of skills that already exist in the project — name, description, paths, and a body excerpt for each.

Your job:
- Decide internally whether the intent is best captured as kind=invariant (hard rule, violation is a defect), kind=pattern (preferred way, no enforcement), or kind=knowledge (stable fact, informational). Do not ask the user — pick the best fit and reflect it in the frontmatter.
- Choose a kebab-case \`name\` that does not collide with any existing skill and reads as a verb-led description of the rule.
- Tighten \`paths\` globs against real file paths from the memory evidence — over-matching skills create noise. If the intent targets a specific repo, anchor the globs there. Use \`**/*\` only as a last resort.
- Write a body that:
  - has a clear h1 matching the name,
  - opens with one or two sentences stating the rule,
  - includes a "When this skill fires" section grounded in concrete file paths or invariant ids from memory,
  - includes a "What to do" or "What to do on violation" section,
  - cites at least one existing invariant id or evidence path drawn from memory when relevant,
  - does not duplicate guidance already covered by an existing skill — instead, reference the existing skill by name and add only what is new.
- Keep \`description\` under 160 chars; it is what the agent sees first.
- Preserve the canonical frontmatter keys only: name, description, kind, allowed-tools, paths, disable-model-invocation, user-invocable. Do not invent new keys.

Output ONLY the full new SKILL.md content. Start with the \`---\` frontmatter. No fences, no prose before or after.`;

export function buildSkillGenerateSystem(args: {
  memory: Memory;
  existingSkills: SkillSummary[];
}): string {
  return [
    INSTRUCTIONS,
    "",
    "---",
    "",
    "PROJECT MEMORY (context for grounding the skill in real files / invariants):",
    "",
    summarizeMemoryForPrompt(args.memory),
    "",
    "---",
    "",
    "EXISTING SKILLS IN THIS PROJECT (do not duplicate — reference instead):",
    "",
    renderExistingSkills(args.existingSkills),
  ].join("\n");
}

export function buildSkillGenerateUser(args: {
  intent: string;
  scope: string;
  scopeLabel: string;
}): string {
  return [
    `SCOPE: ${args.scope} / ${args.scopeLabel}`,
    "",
    `INTENT:`,
    args.intent.trim(),
    "",
    "Emit the complete new SKILL.md.",
  ].join("\n");
}

function renderExistingSkills(skills: SkillSummary[]): string {
  if (skills.length === 0) return "(none)";
  const lines: string[] = [];
  for (const s of skills) {
    const paths = Array.isArray(s.frontmatter.paths)
      ? s.frontmatter.paths.join(", ")
      : (s.frontmatter.paths ?? "");
    lines.push(
      `- ${s.scope}/${s.scopeLabel}/${s.name} (kind=${s.frontmatter.kind ?? "invariant"})`,
    );
    if (s.description) lines.push(`  description: ${s.description.slice(0, 200)}`);
    if (paths) lines.push(`  paths: ${paths}`);
  }
  return lines.join("\n");
}
