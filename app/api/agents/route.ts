import { NextRequest } from "next/server";
import { z } from "zod";
import { createAgentFromRaw, loadAgents } from "@/lib/agents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const agents = await loadAgents();
  return Response.json({
    agents: agents.map((a) => ({
      id: a.id,
      role: a.frontmatter.role,
      description: a.frontmatter.description,
      when_to_use: a.frontmatter.when_to_use,
      filePath: a.filePath,
      body: a.body,
    })),
  });
}

const CreateSchema = z.object({
  raw: z.string().min(1).max(60_000),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues.map((i) => i.message).join(", ") },
      { status: 400 },
    );
  }
  try {
    const agent = await createAgentFromRaw(parsed.data.raw);
    return Response.json({ agent });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
