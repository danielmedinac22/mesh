import { NextRequest } from "next/server";
import { z } from "zod";
import { pipelineToSSE, runAdjustPipeline } from "@/lib/build-pipeline";
import { getTicket } from "@/lib/ticket-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  instruction: z.string().max(4000).default(""),
  quick_actions: z.array(z.string().max(200)).max(12).default([]),
});

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues.map((i) => i.message).join(", ") },
      { status: 400 },
    );
  }
  const ticket = await getTicket(id);
  if (!ticket) {
    return Response.json({ error: "ticket not found" }, { status: 404 });
  }
  if (!ticket.plan_id) {
    return Response.json(
      { error: "ticket has no plan to adjust" },
      { status: 409 },
    );
  }

  const stream = pipelineToSSE(
    runAdjustPipeline({
      ticket_id: id,
      instruction: parsed.data.instruction,
      quick_actions: parsed.data.quick_actions,
    }),
  );
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
