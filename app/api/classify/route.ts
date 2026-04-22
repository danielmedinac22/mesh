import { NextRequest } from "next/server";
import { z } from "zod";
import { loadMemory } from "@/lib/memory";
import { loadConfig } from "@/lib/mesh-state";
import { getEngine } from "@/lib/engine";
import { buildClassifySystem, buildClassifyUser } from "@/lib/prompts/classify";
import { slugifyBranch } from "@/lib/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({ ticket: z.string().min(3).max(8000) });

const ClassificationSchema = z.object({
  type: z.enum(["code_change", "config", "faq", "issue_comment"]),
  repos_touched: z.array(z.string()),
  target_branch: z.string(),
  confidence: z.number().min(0).max(1),
  summary: z.string(),
  reasoning: z.string(),
});

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues.map((i) => i.message).join(", ") },
      { status: 400 },
    );
  }

  const memory = await loadMemory();
  if (!memory) {
    return Response.json(
      { error: "no memory — run /connect first" },
      { status: 409 },
    );
  }

  const config = await loadConfig();
  const engine = getEngine(config.engineMode);
  const system = buildClassifySystem(memory);
  const user = buildClassifyUser(parsed.data.ticket);

  let fullText = "";
  let thinking = "";
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
    wrapThinking: false,
  })) {
    if (ev.type === "text" || ev.type === "thinking") {
      const delta = ev.type === "thinking" ? ev.delta : ev.delta;
      if (ev.type === "thinking") thinking += delta;
      else fullText += delta;
    } else if (ev.type === "done") {
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

  try {
    const body = extractJsonObject(stripFences(fullText.trim()));
    const obj = ClassificationSchema.parse(JSON.parse(body));
    // Sanity: if model omitted mesh/ prefix, coerce.
    const target_branch = obj.target_branch.startsWith("mesh/")
      ? obj.target_branch
      : slugifyBranch(obj.summary || obj.target_branch);

    return Response.json({
      ...obj,
      target_branch,
      usage,
      engine_mode: config.engineMode,
    });
  } catch (err) {
    return Response.json(
      {
        error: `classifier JSON parse failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
        raw: fullText.slice(0, 2000),
        thinking: thinking.slice(0, 400),
      },
      { status: 502 },
    );
  }
}

function stripFences(s: string): string {
  const m = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1] : s;
}
function extractJsonObject(s: string): string {
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return s;
  return s.slice(start, end + 1);
}
