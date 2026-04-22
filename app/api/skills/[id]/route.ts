import { NextRequest } from "next/server";
import { z } from "zod";
import { getSkill, saveSkill } from "@/lib/skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const skill = await getSkill(decodeURIComponent(params.id));
  if (!skill) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ skill });
}

const PutSchema = z.object({ raw: z.string().min(1).max(60_000) });

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const body = await req.json().catch(() => null);
  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues.map((i) => i.message).join(", ") },
      { status: 400 },
    );
  }
  try {
    const skill = await saveSkill(
      decodeURIComponent(params.id),
      parsed.data.raw,
    );
    return Response.json({ skill });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
