import { NextRequest } from "next/server";
import { generateProjectBrief } from "@/lib/project-brief";
import { bootstrapProjects } from "@/lib/migrations";
import { triggerSelfHeal } from "@/lib/self-heal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  await bootstrapProjects();
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const recentEvents: unknown[] = [];
      const send = (ev: unknown) => {
        recentEvents.push(ev);
        if (recentEvents.length > 30) recentEvents.shift();
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      };
      try {
        for await (const ev of generateProjectBrief(params.id)) {
          send(ev);
        }
      } catch (err) {
        send({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
        triggerSelfHeal("/api/projects/[id]/brief", err, {
          requestSummary: { projectId: params.id },
          recentEvents,
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
