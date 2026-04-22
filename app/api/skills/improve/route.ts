import { NextRequest } from "next/server";
import { z } from "zod";
import { getSkill, parseSkillFile } from "@/lib/skills";
import { loadMemory } from "@/lib/memory";
import { loadConfig } from "@/lib/mesh-state";
import { getEngine } from "@/lib/engine";
import {
  buildSkillImproveSystem,
  buildSkillImproveUser,
} from "@/lib/prompts/skill-improve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({ id: z.string().min(1) });

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues.map((i) => i.message).join(", ") },
      { status: 400 },
    );
  }

  const skill = await getSkill(parsed.data.id);
  if (!skill) {
    return Response.json({ error: "skill not found" }, { status: 404 });
  }
  const memory = await loadMemory();
  if (!memory) {
    return Response.json(
      { error: "no memory — run /connect first." },
      { status: 409 },
    );
  }

  const config = await loadConfig();
  const engine = getEngine(config.engineMode);
  const system = buildSkillImproveSystem(memory);
  const user = buildSkillImproveUser({
    currentRaw: skill.raw,
    scope: skill.scope,
    scopeLabel: skill.scopeLabel,
  });

  let thinking = "";
  let text = "";
  let usage: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  } = {};

  for await (const ev of engine.run({
    prompt: user,
    system,
    cacheSystem: true,
    wrapThinking: true,
  })) {
    if (ev.type === "thinking") thinking += ev.delta;
    else if (ev.type === "text") text += ev.delta;
    else if (ev.type === "done") {
      usage = {
        input_tokens: ev.input_tokens,
        output_tokens: ev.output_tokens,
        cache_creation_input_tokens: ev.cache_creation_input_tokens,
        cache_read_input_tokens: ev.cache_read_input_tokens,
      };
    } else if (ev.type === "error") {
      return Response.json({ error: ev.message }, { status: 502 });
    }
  }

  const suggestion = extractSkillMarkdown(text);
  if (!suggestion) {
    return Response.json(
      { error: "improver did not return a SKILL.md", raw: text.slice(0, 800) },
      { status: 502 },
    );
  }

  // Validate the suggestion parses as a skill; if not, surface the raw text.
  try {
    parseSkillFile(suggestion);
  } catch (err) {
    return Response.json(
      {
        error: `suggested SKILL.md did not parse: ${
          err instanceof Error ? err.message : String(err)
        }`,
        raw: suggestion.slice(0, 800),
      },
      { status: 502 },
    );
  }

  return Response.json({
    id: skill.id,
    current: skill.raw,
    suggestion,
    thinking,
    usage,
  });
}

function extractSkillMarkdown(text: string): string | null {
  // The improver may (incorrectly) wrap output in fences. Strip if present.
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/);
  const body = fenceMatch ? fenceMatch[1] : trimmed;
  // Require frontmatter to be confident we got a SKILL.md.
  return /^---\s*\n/.test(body) ? body : null;
}
