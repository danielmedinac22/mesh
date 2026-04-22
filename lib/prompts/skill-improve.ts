import type { Memory } from "@/lib/memory";

const INSTRUCTIONS = `You improve Claude Code SKILL.md files. A skill is an instruction file that fires when a diff matches its \`paths\` glob, and nudges the agent toward an invariant.

You receive:
- The current SKILL.md content.
- The project's cross-repo memory (invariants, flows, repos).
- Optional: recent commit messages in the repo the skill targets.

Return a better SKILL.md. Specifically:
- Tighten \`paths\` globs so the skill fires only on code that actually matters. Over-matching skills create noise.
- Expand the body with 1-2 concrete examples drawn from the cross-repo memory evidence (file paths, invariant ids).
- Add an "When this skill fires" section if missing.
- Add a "What to do on violation" section if missing.
- Keep \`name\` and \`description\` meaningful and under 160 chars total for description.
- Preserve the frontmatter format. Do not invent frontmatter keys outside the canonical set (name, description, allowed-tools, paths, disable-model-invocation, user-invocable).

Output ONLY the full new SKILL.md content. Start with the \`---\` frontmatter. No fences, no prose before or after.`;

export function buildSkillImproveSystem(memory: Memory): string {
  return `${INSTRUCTIONS}\n\n---\n\nPROJECT MEMORY (context for drawing examples):\n\n${summarizeMemory(memory)}`;
}

export function buildSkillImproveUser(args: {
  currentRaw: string;
  scope: string;
  scopeLabel: string;
  recentCommits?: string;
}): string {
  const parts: string[] = [];
  parts.push(`SCOPE: ${args.scope} / ${args.scopeLabel}`);
  parts.push(`CURRENT SKILL.md:\n\n\`\`\`\n${args.currentRaw}\n\`\`\``);
  if (args.recentCommits) {
    parts.push(
      `RECENT COMMIT MESSAGES (target repo):\n\n${args.recentCommits.slice(0, 2000)}`,
    );
  }
  parts.push("Emit the improved SKILL.md in full.");
  return parts.join("\n\n");
}

function summarizeMemory(memory: Memory): string {
  const lines: string[] = [];
  lines.push("Repos:");
  for (const r of memory.repos) {
    lines.push(`- ${r.name} (${r.symbol_count} symbols)`);
    for (const inv of r.invariants.slice(0, 3)) {
      lines.push(
        `  - invariant ${inv.id}: ${inv.statement.slice(0, 140)}`,
      );
      for (const e of inv.evidence.slice(0, 2)) {
        lines.push(`    evidence: ${e.repo}:${e.path}`);
      }
    }
  }
  lines.push("Global invariants:");
  for (const inv of memory.invariants.slice(0, 6)) {
    lines.push(`- ${inv.id}: ${inv.statement.slice(0, 140)}`);
  }
  lines.push("Flows:");
  for (const f of memory.cross_repo_flows.slice(0, 6)) {
    lines.push(`- ${f.id}: ${f.repos.join(" -> ")}`);
  }
  return lines.join("\n");
}
