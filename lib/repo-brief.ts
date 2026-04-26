import { promises as fs } from "node:fs";
import path from "node:path";
import { getEngine } from "@/lib/engine";
import {
  RepoBriefSchema,
  type RepoBrief,
  updateRepoBrief,
} from "@/lib/memory";
import type { IngestedRepo } from "@/lib/repo-ingest";
import type { EngineMode } from "@/lib/mesh-state";

const BRIEF_INSTRUCTIONS = `You are Mesh's per-repo brief agent. You received ONE repository. Produce a short structured summary that a non-technical operator can read to understand what this repo is, how it's built, and what role it plays in the larger system.

Emit this schema exactly:

{
  "name": "string",
  "purpose": "2-3 sentence explanation of what this repo does and for whom",
  "stack": ["framework or library names actually used, e.g. Next.js 14, Prisma, Postgres"],
  "entry_points": ["top-level files or routes where requests/jobs begin"],
  "data_model": "2-3 sentences on what data lives here and how it's stored",
  "key_modules": [
    { "path": "relative/path", "role": "what this module is responsible for" }
  ],
  "cross_repo_role": "1-2 sentences on how this repo relates to siblings (consumes/produces/owns)",
  "generated_at": "ISO-8601 timestamp"
}

Rules:
- 3 to 6 key_modules. Pick the ones a new engineer would open first.
- stack entries must be concrete names visible in package.json, imports, or config.
- Output ONLY the JSON object. No markdown fence, no prose, no commentary.`;

export function renderRepoAsSystemBlock(repo: IngestedRepo): string {
  const parts: string[] = [];
  parts.push(`==================== REPO: ${repo.name} ====================`);
  parts.push(`localPath: ${repo.localPath}`);
  parts.push(
    `files: ${repo.files.length} included · ${repo.skippedByExtension} skipped by extension`,
  );
  if (repo.gitLog) {
    parts.push("");
    parts.push(`--- git log (last 40) ---`);
    parts.push(repo.gitLog);
  }
  if (repo.adrs.length > 0) {
    parts.push("");
    parts.push(`--- ADRs (${repo.adrs.length}) ---`);
    for (const a of repo.adrs) {
      parts.push(`### ${a.path}`);
      parts.push(a.content);
    }
  }
  for (const f of repo.files) {
    parts.push("");
    parts.push(
      `----- ${repo.name}/${f.path}${f.truncated ? " [TRUNCATED]" : ""} -----`,
    );
    parts.push(f.content);
  }
  return parts.join("\n");
}

export function buildRepoBriefSystem(repo: IngestedRepo): string {
  return `${BRIEF_INSTRUCTIONS}\n\n---\n\n${renderRepoAsSystemBlock(repo)}`;
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

function parseBriefJson(raw: string): RepoBrief {
  const body = extractJsonObject(stripFences(raw.trim()));
  const obj = JSON.parse(body);
  return RepoBriefSchema.parse(obj);
}

// Generates a brief for a single ingested repo. Swallows errors into a
// rejected promise so the caller (connect route) can attribute failures
// to the specific repo via Promise.allSettled.
export async function generateRepoBrief(
  repo: IngestedRepo,
  mode: EngineMode,
): Promise<RepoBrief> {
  const engine = getEngine(mode);
  const system = buildRepoBriefSystem(repo);

  let fullText = "";
  for await (const ev of engine.run({
    prompt: `Produce the brief for ${repo.name}. Emit JSON only.`,
    system,
    cacheSystem: true,
    wrapThinking: false,
  })) {
    if (ev.type === "text" || ev.type === "thinking") {
      fullText += ev.delta;
    } else if (ev.type === "error") {
      throw new Error(ev.message);
    }
  }

  const parsed = parseBriefJson(fullText);
  // Enforce name and timestamp server-side so the client never lies about them.
  return {
    ...parsed,
    name: repo.name,
    generated_at: new Date().toISOString(),
  };
}

export function renderBriefAsMarkdown(brief: RepoBrief): string {
  const lines: string[] = [];
  lines.push(`# ${brief.name}`);
  lines.push("");
  lines.push(`_Generated: ${brief.generated_at}_`);
  lines.push("");
  lines.push(`## Purpose`);
  lines.push("");
  lines.push(brief.purpose);
  lines.push("");
  if (brief.stack.length > 0) {
    lines.push(`## Stack`);
    lines.push("");
    for (const s of brief.stack) lines.push(`- ${s}`);
    lines.push("");
  }
  if (brief.entry_points.length > 0) {
    lines.push(`## Entry points`);
    lines.push("");
    for (const e of brief.entry_points) lines.push(`- \`${e}\``);
    lines.push("");
  }
  if (brief.data_model) {
    lines.push(`## Data model`);
    lines.push("");
    lines.push(brief.data_model);
    lines.push("");
  }
  if (brief.key_modules.length > 0) {
    lines.push(`## Key modules`);
    lines.push("");
    for (const m of brief.key_modules) {
      lines.push(`- \`${m.path}\` — ${m.role}`);
    }
    lines.push("");
  }
  if (brief.cross_repo_role) {
    lines.push(`## Role in the mesh`);
    lines.push("");
    lines.push(brief.cross_repo_role);
    lines.push("");
  }
  return lines.join("\n");
}

// Write BRIEF.md to disk and update the structured brief field inside
// the project's memory.json. These two writes are coupled so the
// human-readable and machine-consumable forms never drift.
export async function saveRepoBrief(
  projectId: string,
  repoName: string,
  brief: RepoBrief,
): Promise<void> {
  const dir = path.join(process.cwd(), ".mesh", "repos", repoName);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "BRIEF.md"),
    renderBriefAsMarkdown(brief),
    "utf8",
  );
  await updateRepoBrief(projectId, repoName, brief);
}
