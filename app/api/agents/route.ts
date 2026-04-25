import { loadAgents } from "@/lib/agents";

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
