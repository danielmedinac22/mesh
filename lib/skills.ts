import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { z } from "zod";
import {
  getCurrentProjectId,
  getProject,
  paths as meshPaths,
} from "@/lib/mesh-state";
import { bootstrapProjects } from "@/lib/migrations";

export type SkillScope = "personal" | "project";

export type SkillLocation = {
  scope: SkillScope;
  // For project scope, the project display name.
  label: string;
  root: string;
};

export type SkillSummary = {
  id: string; // `${scope}:${label}:${name}`
  scope: SkillScope;
  scopeLabel: string;
  name: string;
  description: string;
  filePath: string;
  frontmatter: SkillFrontmatter;
};

export type SkillDetail = SkillSummary & {
  body: string;
  raw: string;
};

export const SkillKindSchema = z.enum(["invariant", "pattern", "knowledge"]);
export type SkillKind = z.infer<typeof SkillKindSchema>;

export const SkillFrontmatterSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  kind: SkillKindSchema.default("invariant"),
  "allowed-tools": z.union([z.string(), z.array(z.string())]).optional(),
  paths: z.union([z.string(), z.array(z.string())]).optional(),
  "disable-model-invocation": z.boolean().optional(),
  "user-invocable": z.boolean().optional(),
});
export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

export async function skillLocations(): Promise<SkillLocation[]> {
  await bootstrapProjects();
  const out: SkillLocation[] = [];

  const personal = path.join(os.homedir(), ".claude", "skills");
  if (await dirExists(personal)) {
    out.push({ scope: "personal", label: "personal", root: personal });
  }

  const projectId = await getCurrentProjectId();
  if (projectId) {
    const project = await getProject(projectId);
    if (project) {
      out.push({
        scope: "project",
        label: project.name,
        root: meshPaths.projectSkills(projectId),
      });
    }
  }

  return out;
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const s = await fs.stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

export async function listSkills(): Promise<SkillSummary[]> {
  const locations = await skillLocations();
  const results: SkillSummary[] = [];
  for (const loc of locations) {
    if (!(await dirExists(loc.root))) continue;
    const entries = await fs.readdir(loc.root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const filePath = path.join(loc.root, entry.name, "SKILL.md");
      try {
        const raw = await fs.readFile(filePath, "utf8");
        const parsed = parseSkillFile(raw);
        results.push({
          id: buildId(loc, entry.name),
          scope: loc.scope,
          scopeLabel: loc.label,
          name: parsed.frontmatter.name || entry.name,
          description: parsed.frontmatter.description ?? "",
          filePath,
          frontmatter: parsed.frontmatter,
        });
      } catch {
        // skip unreadable skill directory
      }
    }
  }
  return results;
}

export async function getSkill(id: string): Promise<SkillDetail | null> {
  const { loc, dirName } = await resolveId(id);
  if (!loc) return null;
  const filePath = path.join(loc.root, dirName, "SKILL.md");
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = parseSkillFile(raw);
    return {
      id,
      scope: loc.scope,
      scopeLabel: loc.label,
      name: parsed.frontmatter.name || dirName,
      description: parsed.frontmatter.description ?? "",
      filePath,
      frontmatter: parsed.frontmatter,
      body: parsed.body,
      raw,
    };
  } catch {
    return null;
  }
}

export async function saveSkill(id: string, raw: string): Promise<SkillDetail> {
  // Ensure the content parses before writing.
  const parsed = parseSkillFile(raw);
  const { loc, dirName } = await resolveId(id);
  if (!loc) throw new Error(`unknown skill scope for id: ${id}`);
  const dir = path.join(loc.root, dirName);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, "SKILL.md");
  await fs.writeFile(filePath, raw, "utf8");
  return {
    id,
    scope: loc.scope,
    scopeLabel: loc.label,
    name: parsed.frontmatter.name || dirName,
    description: parsed.frontmatter.description ?? "",
    filePath,
    frontmatter: parsed.frontmatter,
    body: parsed.body,
    raw,
  };
}

export async function createSkill(input: {
  scope: SkillScope;
  scopeLabel: string;
  name: string;
  description?: string;
  kind?: SkillKind;
}): Promise<SkillDetail> {
  const dirName = slug(input.name);
  if (!dirName) throw new Error("invalid skill name");
  const locations = await skillLocations();
  const loc = locations.find(
    (l) => l.scope === input.scope && l.label === input.scopeLabel,
  );
  if (!loc) throw new Error(`unknown scope: ${input.scope}:${input.scopeLabel}`);
  const body = defaultSkillBody({
    name: input.name,
    description: input.description ?? "",
    kind: input.kind ?? "invariant",
  });
  const id = buildId(loc, dirName);
  return saveSkill(id, body);
}

function defaultSkillBody(opts: {
  name: string;
  description: string;
  kind: SkillKind;
}): string {
  const hint =
    opts.kind === "invariant"
      ? "Describe the invariant this skill enforces, when it applies, and what to do when violations are detected."
      : opts.kind === "pattern"
        ? "Describe the preferred way to do this in the codebase. Agents consume this when writing code — there is no runtime enforcement."
        : "Describe stable facts about the codebase that agents should know upfront (stack, conventions, gotchas). Informational only.";
  return `---
name: ${opts.name}
description: ${opts.description || "TODO describe when this skill applies"}
kind: ${opts.kind}
allowed-tools:
  - Read
  - Grep
paths:
  - "**/*"
disable-model-invocation: false
---

# ${opts.name}

${hint}
`;
}

export function parseSkillFile(raw: string): {
  frontmatter: SkillFrontmatter;
  body: string;
} {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) {
    // Fallback: treat entire file as body with minimal frontmatter.
    return {
      frontmatter: SkillFrontmatterSchema.parse({
        name: "untitled",
        description: "",
      }),
      body: raw,
    };
  }
  const fmText = match[1];
  const body = match[2] ?? "";
  const obj = parseSimpleYaml(fmText);
  const kindRaw = typeof obj.kind === "string" ? obj.kind : undefined;
  const frontmatter = SkillFrontmatterSchema.parse({
    name: typeof obj.name === "string" ? obj.name : "untitled",
    description: typeof obj.description === "string" ? obj.description : "",
    kind:
      kindRaw && ["invariant", "pattern", "knowledge"].includes(kindRaw)
        ? kindRaw
        : "invariant",
    "allowed-tools": obj["allowed-tools"] as SkillFrontmatter["allowed-tools"],
    paths: obj.paths as SkillFrontmatter["paths"],
    "disable-model-invocation":
      typeof obj["disable-model-invocation"] === "boolean"
        ? obj["disable-model-invocation"]
        : undefined,
    "user-invocable":
      typeof obj["user-invocable"] === "boolean"
        ? obj["user-invocable"]
        : undefined,
  });
  return { frontmatter, body };
}

// Minimal YAML parser for SKILL.md frontmatter: scalar key: value, and
// list-of-strings via "- item" under a key. Sufficient for our schema; we
// do not try to cover nested objects or flow-style lists.
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
      out[key] = coerceScalar(rest);
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

function coerceScalar(v: string): string | number | boolean {
  const s = stripQuotes(v.trim());
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
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

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function buildId(loc: SkillLocation, dirName: string): string {
  return `${loc.scope}:${loc.label}:${dirName}`;
}

async function resolveId(
  id: string,
): Promise<{ loc: SkillLocation | null; dirName: string }> {
  const parts = id.split(":");
  if (parts.length < 3) return { loc: null, dirName: "" };
  const [scope, label, ...rest] = parts;
  const dirName = rest.join(":");
  const locations = await skillLocations();
  const loc =
    locations.find((l) => l.scope === (scope as SkillScope) && l.label === label) ??
    null;
  return { loc, dirName };
}
