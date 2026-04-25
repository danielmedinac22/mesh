import { getSkill, listSkills, type SkillKind } from "@/lib/skills";

export type BuildSkillsContextOptions = {
  kinds?: SkillKind[];
  // Filter to skills whose `paths` frontmatter matches at least one of these
  // repo names or file globs. A skill with no `paths` is considered global and
  // always included (unless `requirePaths` is set).
  repos?: string[];
  files?: string[];
  requirePaths?: boolean;
  // If true, group by kind with section headers. Default: true.
  sectioned?: boolean;
};

// Load skills filtered by kind/paths and return a markdown block ready to be
// appended to an agent's system prompt. Invariants come first so the model
// reads hard rules before prescriptive patterns.
export async function buildSkillsContext(
  opts: BuildSkillsContextOptions = {},
): Promise<string> {
  const kinds = opts.kinds ?? ["invariant", "pattern", "knowledge"];
  const summaries = await listSkills();
  const matching = summaries.filter((s) => {
    const kind = s.frontmatter.kind ?? "invariant";
    if (!kinds.includes(kind)) return false;
    if (opts.repos || opts.files || opts.requirePaths) {
      const skillPaths = normalizePaths(s.frontmatter.paths);
      if (skillPaths.length === 0) return !opts.requirePaths;
      return skillPaths.some((p) => pathMatches(p, opts.repos, opts.files));
    }
    return true;
  });

  if (matching.length === 0) return "";

  // Load full bodies once. listSkills only returns summaries.
  const full = await Promise.all(matching.map((s) => getSkill(s.id)));
  const loaded = full.filter((d): d is NonNullable<typeof d> => d !== null);

  const groups: Record<SkillKind, typeof loaded> = {
    invariant: [],
    pattern: [],
    knowledge: [],
  };
  for (const d of loaded) {
    const kind = (d.frontmatter.kind ?? "invariant") as SkillKind;
    groups[kind].push(d);
  }

  const sectioned = opts.sectioned !== false;
  const parts: string[] = [];
  parts.push("# Skills context");
  parts.push("");
  parts.push(
    "These skills describe how the codebase should be touched. Invariants are hard rules — do not violate them. Patterns are the preferred way to implement things. Knowledge entries are stable facts about the stack.",
  );
  parts.push("");

  const kindOrder: SkillKind[] = ["invariant", "pattern", "knowledge"];
  for (const kind of kindOrder) {
    const items = groups[kind];
    if (items.length === 0) continue;
    if (sectioned) {
      parts.push(`## ${kind.toUpperCase()} (${items.length})`);
      parts.push("");
    }
    for (const s of items) {
      parts.push(`### ${s.name} — ${s.scopeLabel}`);
      if (s.description) {
        parts.push(`_${s.description}_`);
      }
      parts.push("");
      parts.push(s.body.trim());
      parts.push("");
    }
  }

  return parts.join("\n");
}

function normalizePaths(
  paths: string | string[] | undefined,
): string[] {
  if (!paths) return [];
  return Array.isArray(paths) ? paths : [paths];
}

// Very lightweight matcher: a skill `paths` entry matches if any of the
// provided repo names / file paths appear inside it (case-insensitive). We
// intentionally skip a full glob engine here — skills typically scope to
// a repo name prefix (e.g. "flarebill-api/**") or "**/*".
function pathMatches(
  skillPath: string,
  repos: string[] | undefined,
  files: string[] | undefined,
): boolean {
  const p = skillPath.toLowerCase();
  if (p === "**/*" || p === "**") return true;
  if (repos) {
    for (const r of repos) {
      if (p.includes(r.toLowerCase())) return true;
    }
  }
  if (files) {
    for (const f of files) {
      if (p.includes(f.toLowerCase())) return true;
    }
  }
  return false;
}
