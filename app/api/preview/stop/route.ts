import { NextRequest } from "next/server";
import { z } from "zod";
import { stopPreview } from "@/lib/preview-server";

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
  const stopped = await stopPreview(parsed.data.ticket_id, parsed.data.repo);
  return Response.json({ ok: stopped });
}
