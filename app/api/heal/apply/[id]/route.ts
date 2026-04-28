import { NextRequest } from "next/server";
import { applyProposal } from "@/lib/self-heal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    return Response.json({ error: "invalid id" }, { status: 400 });
  }
  const entry = await applyProposal(id);
  const ok = entry.status === "applied" || entry.status === "auto-applied";
  return Response.json(entry, { status: ok ? 200 : 409 });
}
