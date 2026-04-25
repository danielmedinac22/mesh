import { NextRequest } from "next/server";
import { z } from "zod";
import { deleteAgent, getAgent, getAgentRaw, saveAgent } from "@/lib/agents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const id = decodeURIComponent(params.id);
  const [agent, raw] = await Promise.all([getAgent(id), getAgentRaw(id)]);
  if (!agent || raw === null) {
    return Response.json({ error: "agent not found" }, { status: 404 });
  }
  return Response.json({
    agent: {
      id: agent.id,
      role: agent.frontmatter.role,
      description: agent.frontmatter.description,
      when_to_use: agent.frontmatter.when_to_use,
      filePath: agent.filePath,
      body: agent.body,
      raw,
    },
  });
}

const PutSchema = z.object({ raw: z.string().min(1).max(60_000) });

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const id = decodeURIComponent(params.id);
  const body = await req.json().catch(() => null);
  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues.map((i) => i.message).join(", ") },
      { status: 400 },
    );
  }
  try {
    const agent = await saveAgent(parsed.data.raw);
    if (agent.id !== id) {
      return Response.json(
        {
          error: `frontmatter name "${agent.id}" does not match url id "${id}". Renaming agents is not supported — delete and recreate.`,
        },
        { status: 400 },
      );
    }
    return Response.json({ agent });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const id = decodeURIComponent(params.id);
  try {
    await deleteAgent(id);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
