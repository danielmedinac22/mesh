import type { IngestedRepo } from "@/lib/repo-ingest";
import type { Memory, RepoBrief } from "@/lib/memory";
import { renderRepoAsSystemBlock } from "@/lib/repo-brief";
import { renderBriefAsMarkdown } from "@/lib/repo-brief";

const INSTRUCTIONS = `You author Claude Code SKILL.md files that govern how future code changes land inside ONE specific repository. You receive:
- The repository's full ingest (source files, git log, ADRs).
- The repo's brief (purpose, stack, entry points, key modules).
- The cross-repo memory (invariants and flows discovered across the project).

Your job is to distill 2 to 4 SKILL.md documents that capture the most load-bearing rules a code agent must respect when editing this repo. Skills must be GROUNDED in real evidence — invariant ids from memory, file paths actually present in the ingest, modules listed in the brief.

For each skill:
- kind = "invariant" when the rule is hard (violation is a defect), "pattern" when it's the preferred way (no enforcement), "knowledge" only for stable orienting facts. Default to invariant when in doubt.
- name = kebab-case, prefixed with the repo name to avoid collisions across repos in the same project. Example: "<repo>-no-direct-db-from-handlers".
- description = under 160 chars; this is the first thing the agent sees.
- paths = glob(s) ANCHORED to this repo. Prefer specific globs from real file paths in the ingest (e.g. "<repo>/src/api/**/*.ts"). Only use "<repo>/**/*" when the rule truly spans the whole repo.
- body = markdown with:
  - h1 matching name,
  - opening sentence stating the rule,
  - "When this skill fires" section citing concrete file paths,
  - "What to do" or "What to do on violation" section,
  - reference at least one invariant id from memory or evidence path.
- Do not duplicate guidance between skills you emit — each must add something distinct.

Output format: a single JSON object {"skills": [{"raw": "<full SKILL.md>"}, ...]}. Each "raw" string MUST start with the "---" frontmatter line and contain only canonical frontmatter keys (name, description, kind, allowed-tools, paths, disable-model-invocation, user-invocable). Do not invent new keys. Output ONLY the JSON object — no markdown fence, no prose before or after.`;

export function buildRepoSkillsSystem(args: {
  repo: IngestedRepo;
  brief: RepoBrief;
  memory: Memory;
}): string {
  const repoMemory = filterMemoryForRepo(args.memory, args.repo.name);
  return [
    INSTRUCTIONS,
    "",
    "---",
    "",
    `REPO BRIEF for ${args.repo.name}:`,
    "",
    renderBriefAsMarkdown(args.brief),
    "",
    "---",
    "",
    `MEMORY scoped to ${args.repo.name} (invariants and flows that touch this repo):`,
    "",
    repoMemory,
    "",
    "---",
    "",
    renderRepoAsSystemBlock(args.repo),
  ].join("\n");
}

export function buildRepoSkillsUser(repoName: string): string {
  return `Emit the SKILL.md set for ${repoName} as JSON now. 2 to 4 skills. JSON only.`;
}

function filterMemoryForRepo(memory: Memory, repoName: string): string {
  const lines: string[] = [];
  const repo = memory.repos.find((r) => r.name === repoName);
  if (repo) {
    lines.push(`Repo invariants for ${repoName}:`);
    for (const inv of repo.invariants) {
      lines.push(`- ${inv.id}: ${inv.statement}`);
      for (const e of inv.evidence.slice(0, 3)) {
        lines.push(`  evidence: ${e.repo}:${e.path}:${e.line}`);
      }
    }
    if (repo.invariants.length === 0) lines.push("- (none)");
  }
  const globalForRepo = memory.invariants.filter((inv) =>
    inv.evidence.some((e) => e.repo === repoName),
  );
  if (globalForRepo.length > 0) {
    lines.push("");
    lines.push("Global invariants with evidence in this repo:");
    for (const inv of globalForRepo) {
      lines.push(`- ${inv.id}: ${inv.statement}`);
      for (const e of inv.evidence.filter((ev) => ev.repo === repoName).slice(0, 3)) {
        lines.push(`  evidence: ${e.repo}:${e.path}:${e.line}`);
      }
    }
  }
  const flows = memory.cross_repo_flows.filter((f) => f.repos.includes(repoName));
  if (flows.length > 0) {
    lines.push("");
    lines.push("Cross-repo flows touching this repo:");
    for (const f of flows) {
      lines.push(`- ${f.id} (${f.name}): ${f.repos.join(" -> ")}`);
    }
  }
  return lines.join("\n");
}
