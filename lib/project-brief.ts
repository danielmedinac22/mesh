import { z } from "zod";
import { getEngine, DEFAULT_MODEL } from "@/lib/engine";
import { loadMemory, saveProjectBrief, type Memory, type ProjectBrief } from "@/lib/memory";
import {
  getProject,
  getReposForProject,
  loadConfig,
  updateProject,
  type ProjectRecord,
} from "@/lib/mesh-state";

export const ProjectBriefPayloadSchema = z.object({
  description: z.string().min(1),
  relationships: z
    .array(
      z.object({
        from: z.string(),
        to: z.string(),
        kind: z.string(),
        note: z.string().optional(),
      }),
    )
    .default([]),
});

export type ProjectBriefEvent =
  | { type: "thinking"; delta: string }
  | { type: "text"; delta: string }
  | { type: "done"; brief: ProjectBrief; duration_ms: number }
  | { type: "error"; message: string };

function buildSystem(project: ProjectRecord, memory: Memory | null): string {
  const repos = memory?.repos ?? [];
  const lines: string[] = [];
  lines.push(
    "You are a senior architect writing a concise brief for a poly-repo project.",
  );
  lines.push(
    "Given the repos and existing invariants/flows, emit a JSON object with this exact shape:",
  );
  lines.push("{");
  lines.push('  "description": string, // 2-3 sentences: what this project does, end-to-end');
  lines.push('  "relationships": [');
  lines.push("    { \"from\": repoName, \"to\": repoName, \"kind\": string, \"note\"?: string }");
  lines.push("  ]");
  lines.push("}");
  lines.push("");
  lines.push(
    "`kind` should be one of: calls, publishes-to, subscribes-to, shares-types, imports-from, depends-on.",
  );
  lines.push("Keep relationships directional; include every meaningful link but avoid duplicates.");
  lines.push("Emit JSON only. No markdown fences, no prose outside the JSON.");
  lines.push("");
  lines.push(`# Project: ${project.name}`);
  if (project.label) lines.push(`Label: ${project.label}`);
  lines.push("");
  lines.push("## Repos");
  for (const r of project.repos) {
    const mem = repos.find((x) => x.name === r);
    const brief = mem?.brief;
    if (brief) {
      lines.push(`- ${r} — ${brief.purpose}`);
      if (brief.cross_repo_role) lines.push(`  role: ${brief.cross_repo_role}`);
    } else {
      lines.push(`- ${r}`);
    }
  }
  if ((memory?.cross_repo_flows?.length ?? 0) > 0) {
    lines.push("");
    lines.push("## Known cross-repo flows");
    for (const f of memory!.cross_repo_flows) {
      lines.push(`- ${f.name}: ${f.repos.join(" → ")}`);
    }
  }
  if ((memory?.call_graph?.length ?? 0) > 0) {
    lines.push("");
    lines.push("## Known call graph edges");
    for (const e of memory!.call_graph.slice(0, 40)) {
      lines.push(
        `- ${e.from.repo}:${e.from.symbol} → ${e.to.repo}:${e.to.symbol}`,
      );
    }
  }
  return lines.join("\n");
}

function extractJson(raw: string): string {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return raw;
  return raw.slice(start, end + 1);
}

export async function* generateProjectBrief(
  projectId: string,
): AsyncIterable<ProjectBriefEvent> {
  const startedAt = Date.now();
  const project = await getProject(projectId);
  if (!project) {
    yield { type: "error", message: `project not found: ${projectId}` };
    return;
  }
  // Keep roster fresh (include every repo currently assigned).
  const repos = await getReposForProject(projectId);
  if (repos.length === 0) {
    yield { type: "error", message: "project has no repos yet" };
    return;
  }
  project.repos = repos.map((r) => r.name);

  const memory = await loadMemory(projectId);
  const config = await loadConfig();
  const engine = getEngine(config.engineMode);
  const system = buildSystem(project, memory);

  let fullText = "";
  try {
    for await (const ev of engine.run({
      prompt:
        "Emit the JSON object described in the system prompt. JSON only, no fences.",
      system,
      cacheSystem: true,
      wrapThinking: true,
    })) {
      if (ev.type === "thinking") {
        yield { type: "thinking", delta: ev.delta };
      } else if (ev.type === "text") {
        fullText += ev.delta;
        yield { type: "text", delta: ev.delta };
      } else if (ev.type === "error") {
        yield { type: "error", message: ev.message };
        return;
      }
    }
    const parsed = ProjectBriefPayloadSchema.parse(
      JSON.parse(extractJson(fullText)),
    );
    const brief: ProjectBrief = {
      description: parsed.description,
      relationships: parsed.relationships,
      generated_at: new Date().toISOString(),
    };
    await saveProjectBrief(projectId, brief);
    await updateProject(projectId, { description: brief.description });
    yield {
      type: "done",
      brief,
      duration_ms: Date.now() - startedAt,
    };
  } catch (err) {
    yield {
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export { DEFAULT_MODEL };
