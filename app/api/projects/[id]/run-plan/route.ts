import { NextRequest } from "next/server";
import {
  generateRunPlan,
  readCachedPlan,
  type RunPlannerEvent,
} from "@/lib/run-planner";
import { getProject } from "@/lib/mesh-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

// GET — return the cached plan if any. Cheap, sync. Used on page hydrate.
export async function GET(_req: NextRequest, { params }: Ctx) {
  const project = await getProject(params.id);
  if (!project) {
    return Response.json(
      { error: `project not found: ${params.id}` },
      { status: 404 },
    );
  }
  const plan = await readCachedPlan(params.id);
  return Response.json({ plan });
}

// POST — (re)generate the plan, streaming Claude's thinking via SSE.
// Body: none required. Responds with SSE events shaped like RunPlannerEvent.
export async function POST(_req: NextRequest, { params }: Ctx) {
  const project = await getProject(params.id);
  if (!project) {
    return Response.json(
      { error: `project not found: ${params.id}` },
      { status: 404 },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: RunPlannerEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
        } catch {
          // controller closed
        }
      };
      try {
        for await (const ev of generateRunPlan(params.id)) {
          send(ev);
          if (ev.type === "done" || ev.type === "error") break;
        }
      } catch (err) {
        send({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        try {
          controller.close();
        } catch {
          // ignore
        }
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
