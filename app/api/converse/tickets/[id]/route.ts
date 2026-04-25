import { NextRequest } from "next/server";
import { z } from "zod";
import {
  deleteTicket,
  getTicket,
  TicketPrioritySchema,
  TicketSourceHintSchema,
  updateTicket,
} from "@/lib/ticket-store";
import { getPlan } from "@/lib/plan-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(8000).optional(),
  priority: TicketPrioritySchema.optional(),
  labels: z.array(z.string().max(40)).max(12).optional(),
  source_hint: TicketSourceHintSchema.optional(),
});

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const ticket = await getTicket(id);
  if (!ticket) return Response.json({ error: "not found" }, { status: 404 });
  const plan = ticket.plan_id ? await getPlan(ticket.plan_id) : null;
  return Response.json({ ticket, plan });
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues.map((i) => i.message).join(", ") },
      { status: 400 },
    );
  }
  const next = await updateTicket(id, parsed.data);
  if (!next) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ ticket: next });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const ok = await deleteTicket(id);
  if (!ok) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ ok: true });
}
