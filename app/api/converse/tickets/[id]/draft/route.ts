import { NextRequest } from "next/server";
import { pipelineToSSE, runDraftPipeline } from "@/lib/converse-pipeline";
import { getTicket } from "@/lib/ticket-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const ticket = await getTicket(id);
  if (!ticket) {
    return Response.json({ error: "ticket not found" }, { status: 404 });
  }

  const stream = pipelineToSSE(runDraftPipeline({ ticket_id: id }));
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
