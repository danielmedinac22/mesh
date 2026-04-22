import { NextRequest } from "next/server";
import { z } from "zod";
import { loadMemory, type Memory } from "@/lib/memory";
import { loadConfig } from "@/lib/mesh-state";
import { getEngine } from "@/lib/engine";
import {
  buildPlanSystem,
  buildPlanUser,
  parsePlanJson,
  type PlanPayload,
} from "@/lib/prompts/plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  ticket: z.string().min(3).max(8000),
  repos_touched: z.array(z.string()).min(1),
  target_branch: z.string().min(1),
  classifier_reasoning: z.string().optional(),
});

type PlanEvent =
  | { type: "thinking"; delta: string }
  | { type: "meta"; ttft_ms: number }
  | { type: "plan"; plan: PlanPayload }
  | {
      type: "done";
      duration_ms: number;
      engine_mode: string;
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    }
  | { type: "error"; message: string };

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

  const encoder = new TextEncoder();
  const startedAt = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: PlanEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      };

      try {
        const plan = await runPlan(memory, parsed.data, config.engineMode, send);
        send({ type: "plan", plan: plan.plan });
        send({
          type: "done",
          duration_ms: Date.now() - startedAt,
          engine_mode: config.engineMode,
          ...plan.usage,
        });
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
      "X-Accel-Buffering": "no",
    },
  });
}

async function runPlan(
  memory: Memory,
  body: z.infer<typeof BodySchema>,
  mode: "raw" | "agent",
  send: (ev: PlanEvent) => void,
): Promise<{
  plan: PlanPayload;
  usage: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}> {
  const engine = getEngine(mode);
  const system = buildPlanSystem(memory);
  const user = buildPlanUser({
    ticket: body.ticket,
    reposTouched: body.repos_touched,
    targetBranch: body.target_branch,
    classifierReasoning: body.classifier_reasoning,
  });

  const MAX_ATTEMPTS = 2;
  let lastError = "no attempts";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const correctivePrompt =
      attempt === 1
        ? user
        : `${user}\n\nYour previous attempt did not produce valid plan JSON. Error: ${lastError}\nEmit ONLY the JSON object after </thinking>, matching the schema.`;

    let fullText = "";
    let usage: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    } = {};

    for await (const ev of engine.run({
      prompt: correctivePrompt,
      system,
      cacheSystem: true,
      wrapThinking: true,
    })) {
      if (ev.type === "thinking") {
        send({ type: "thinking", delta: ev.delta });
      } else if (ev.type === "text") {
        fullText += ev.delta;
      } else if (ev.type === "meta") {
        send({ type: "meta", ttft_ms: ev.ttft_ms });
      } else if (ev.type === "done") {
        usage = {
          input_tokens: ev.input_tokens,
          output_tokens: ev.output_tokens,
          cache_creation_input_tokens: ev.cache_creation_input_tokens,
          cache_read_input_tokens: ev.cache_read_input_tokens,
        };
      } else if (ev.type === "error") {
        lastError = ev.message;
      }
    }

    try {
      const plan = parsePlanJson(fullText);
      // Coerce target_branch on every step to the one the human approved.
      plan.plan = plan.plan.map((s) => ({
        ...s,
        target_branch: body.target_branch,
      }));
      return { plan, usage };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  throw new Error(`Plan JSON invalid after ${MAX_ATTEMPTS} attempts: ${lastError}`);
}
