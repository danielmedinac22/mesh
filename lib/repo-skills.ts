import { getEngine } from "@/lib/engine";
import type { EngineMode } from "@/lib/mesh-state";
import type { IngestedRepo } from "@/lib/repo-ingest";
import type { Memory, RepoBrief } from "@/lib/memory";
import {
  buildRepoSkillsSystem,
  buildRepoSkillsUser,
} from "@/lib/prompts/repo-skills";
import {
  createSkillFromRaw,
  parseSkillFile,
  type SkillDetail,
} from "@/lib/skills";

export type GeneratedSkill = { raw: string };

export async function generateRepoSkills(
  repo: IngestedRepo,
  brief: RepoBrief,
  memory: Memory,
  mode: EngineMode,
): Promise<GeneratedSkill[]> {
  const engine = getEngine(mode);
  const system = buildRepoSkillsSystem({ repo, brief, memory });
  const prompt = buildRepoSkillsUser(repo.name);

  let fullText = "";
  for await (const ev of engine.run({
    prompt,
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

  const obj = parseJsonObject(fullText);
  const arr = Array.isArray((obj as { skills?: unknown }).skills)
    ? ((obj as { skills: unknown[] }).skills)
    : [];
  const out: GeneratedSkill[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const raw = (item as { raw?: unknown }).raw;
    if (typeof raw !== "string" || !raw.trim().startsWith("---")) continue;
    try {
      parseSkillFile(raw);
      out.push({ raw });
    } catch {
      // drop unparseable entries; the rest of the batch survives
    }
  }
  return out;
}

export async function persistRepoSkills(
  scopeLabel: string,
  raws: GeneratedSkill[],
): Promise<SkillDetail[]> {
  const saved: SkillDetail[] = [];
  const usedNames = new Set<string>();
  for (const { raw } of raws) {
    try {
      const adjusted = uniquifyName(raw, usedNames);
      const detail = await createSkillFromRaw({
        scope: "project",
        scopeLabel,
        raw: adjusted,
      });
      usedNames.add(detail.frontmatter.name);
      saved.push(detail);
    } catch {
      // swallow per-skill errors so a single bad skill doesn't kill the rest
    }
  }
  return saved;
}

function uniquifyName(raw: string, used: Set<string>): string {
  const parsed = parseSkillFile(raw);
  const name = parsed.frontmatter.name;
  if (!used.has(name)) return raw;
  let n = 2;
  while (used.has(`${name}-${n}`)) n += 1;
  const next = `${name}-${n}`;
  return raw.replace(
    /(^---[\s\S]*?\nname:\s*)([^\n]+)(\n)/,
    (_m, p1, _p2, p3) => `${p1}${next}${p3}`,
  );
}

function stripFences(s: string): string {
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/;
  const m = s.trim().match(fence);
  return m ? m[1] : s;
}

function parseJsonObject(s: string): unknown {
  const body = stripFences(s.trim());
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("repo-skills generator did not return a JSON object");
  }
  return JSON.parse(body.slice(start, end + 1));
}
