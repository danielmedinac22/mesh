import { NextRequest } from "next/server";
import { z } from "zod";
import { getRepo } from "@/lib/mesh-state";
import {
  ensureExitCleanup,
  startPreview,
  type PreviewEvent,
} from "@/lib/preview-server";
import { triggerSelfHeal } from "@/lib/self-heal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  // Optional: when omitted (e.g. "Run locally" from /repos/<name>), the
  // session is keyed by `run-${repo}` so it doesn't collide with Ship sessions.
  ticket_id: z.string().min(1).optional(),
  repo: z.string().min(1),
  // For docker-compose repos: "deps-only" runs only services without a
  // `build:` directive (db, redis, …) — useful when the user can't build
  // app images (missing creds for private registries, etc.).
  composeMode: z.enum(["full", "deps-only"]).optional(),
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
      const recentEvents: PreviewEvent[] = [];
      const send = (ev: PreviewEvent) => {
        recentEvents.push(ev);
        if (recentEvents.length > 30) recentEvents.shift();
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
        } catch {
          // controller may already be closed if the client disconnected
        }
      };
      try {
        const session = await startPreview({
          ticketId: parsed.data.ticket_id ?? `run-${parsed.data.repo}`,
          repoName: parsed.data.repo,
          cwd: repo.localPath,
          composeMode: parsed.data.composeMode,
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
        triggerSelfHeal("/api/preview/start", err, {
          requestSummary: {
            repo: parsed.data.repo,
            ticket_id: parsed.data.ticket_id,
          },
          recentEvents,
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
