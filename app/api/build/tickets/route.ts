import { NextRequest } from "next/server";
import { z } from "zod";
import {
  createTicket,
  listTickets,
  TicketPrioritySchema,
  TicketSourceHintSchema,
} from "@/lib/ticket-store";
import { getCurrentProjectId } from "@/lib/mesh-state";
import { bootstrapProjects } from "@/lib/migrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(8000).optional(),
  priority: TicketPrioritySchema.optional(),
  labels: z.array(z.string().max(40)).max(12).optional(),
  source_hint: TicketSourceHintSchema.optional(),
  projectId: z.string().optional(),
});

export async function GET(req: NextRequest) {
  await bootstrapProjects();
  const all = req.nextUrl.searchParams.get("all") === "1";
  const overrideProject = req.nextUrl.searchParams.get("projectId");
  if (all) {
    const tickets = await listTickets();
    return Response.json({ tickets, projectId: null });
  }
  const projectId = overrideProject ?? (await getCurrentProjectId());
  const tickets = await listTickets({ projectId });
  return Response.json({ tickets, projectId });
}

export async function POST(req: NextRequest) {
  await bootstrapProjects();
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues.map((i) => i.message).join(", ") },
      { status: 400 },
    );
  }
  const projectId = parsed.data.projectId ?? (await getCurrentProjectId());
  const ticket = await createTicket({
    ...parsed.data,
    projectId: projectId ?? undefined,
  });
  return Response.json({ ticket });
}
