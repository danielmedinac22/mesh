import { NextRequest } from "next/server";
import { z } from "zod";
import { getRepo } from "@/lib/mesh-state";
import {
  ensureExitCleanup,
  startPreview,
  type PreviewEvent,
} from "@/lib/preview-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  ticket_id: z.string().min(1),
  repo: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues.map((i) => i.message).join(", ") },
      { status: 400 },
    );
  }
  const repo = await getRepo(parsed.data.repo);
  if (!repo) {
    return Response.json(
      { error: `repo ${parsed.data.repo} not registered` },
      { status: 404 },
    );
  }

  ensureExitCleanup();

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: PreviewEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
        } catch {
          // controller may already be closed if the client disconnected
        }
      };
      try {
        const session = await startPreview({
          ticketId: parsed.data.ticket_id,
          repoName: parsed.data.repo,
          cwd: repo.localPath,
          onEvent: send,
        });
        // Keep the SSE alive until the process emits ready/failed/stopped, or
        // until the client disconnects (controller throws on enqueue).
        const settled = ["ready", "failed", "stopped"];
        const start = Date.now();
        while (!settled.includes(session.status) && Date.now() - start < 60_000) {
          await new Promise((r) => setTimeout(r, 250));
        }
        send({ type: "status", status: session.status });
      } catch (err) {
        send({
          type: "failed",
          reason: err instanceof Error ? err.message : String(err),
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
