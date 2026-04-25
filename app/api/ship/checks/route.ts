import { NextRequest } from "next/server";
import { z } from "zod";
import { getRepo } from "@/lib/mesh-state";
import { runRepoChecks, type CheckEvent } from "@/lib/checks-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
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

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: CheckEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      };
      try {
        await runRepoChecks({
          cwd: repo.localPath,
          onEvent: send,
        });
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`),
        );
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "error",
              message: err instanceof Error ? err.message : String(err),
            })}\n\n`,
          ),
        );
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
