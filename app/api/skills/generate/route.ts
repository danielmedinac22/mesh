import { NextRequest } from "next/server";
import { z } from "zod";
import { listSkills, parseSkillFile } from "@/lib/skills";
import { loadMemory } from "@/lib/memory";
import { getCurrentProjectId, loadConfig } from "@/lib/mesh-state";
import { bootstrapProjects } from "@/lib/migrations";
import { getEngine } from "@/lib/engine";
import {
  buildSkillGenerateSystem,
  buildSkillGenerateUser,
} from "@/lib/prompts/skill-generate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  intent: z.string().min(8).max(2_000),
  scope: z.enum(["personal", "project"]),
  scopeLabel: z.string().min(1),
});

type GenerateEvent =
  | { type: "thinking"; delta: string }
  | { type: "text"; delta: string }
  | { type: "meta"; ttft_ms: number }
  | { type: "done"; raw: string }
  | { type: "error"; message: string };

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues.map((i) => i.message).join(", ") },
      { status: 400 },
    );
  }

  await bootstrapProjects();
  const projectId = await getCurrentProjectId();
  const memory = projectId ? await loadMemory(projectId) : null;
  if (!memory) {
    return Response.json(
      { error: "no memory — run /connect first." },
      { status: 409 },
    );
  }

  const existingSkills = await listSkills();
  const config = await loadConfig();
  const engine = getEngine(config.engineMode);
  const system = buildSkillGenerateSystem({ memory, existingSkills });
  const user = buildSkillGenerateUser({
    intent: parsed.data.intent,
    scope: parsed.data.scope,
    scopeLabel: parsed.data.scopeLabel,
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: GenerateEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      };
      let text = "";
      try {
        for await (const ev of engine.run({
          prompt: user,
          system,
          cacheSystem: true,
          wrapThinking: true,
        })) {
          if (ev.type === "thinking") {
            send({ type: "thinking", delta: ev.delta });
          } else if (ev.type === "text") {
            text += ev.delta;
            send({ type: "text", delta: ev.delta });
          } else if (ev.type === "meta") {
            send({ type: "meta", ttft_ms: ev.ttft_ms });
          } else if (ev.type === "error") {
            send({ type: "error", message: ev.message });
            controller.close();
            return;
          }
        }
        const raw = extractSkillMarkdown(text);
        if (!raw) {
          send({
            type: "error",
            message: "generator did not return a SKILL.md",
          });
          controller.close();
          return;
        }
        try {
          parseSkillFile(raw);
        } catch (err) {
          send({
            type: "error",
            message: `generated SKILL.md did not parse: ${err instanceof Error ? err.message : String(err)}`,
          });
          controller.close();
          return;
        }
        send({ type: "done", raw });
      } catch (err) {
        send({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

function extractSkillMarkdown(text: string): string | null {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/);
  const body = fenceMatch ? fenceMatch[1] : trimmed;
  return /^---\s*\n/.test(body) ? body : null;
}
