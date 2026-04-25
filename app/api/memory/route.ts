import { NextRequest } from "next/server";
import { loadMemory } from "@/lib/memory";
import { getCurrentProjectId } from "@/lib/mesh-state";
import { bootstrapProjects } from "@/lib/migrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  await bootstrapProjects();
  const override = req.nextUrl.searchParams.get("projectId");
  const projectId = override ?? (await getCurrentProjectId());
  if (!projectId) {
    return Response.json({ memory: null, projectId: null }, { status: 200 });
  }
  const memory = await loadMemory(projectId);
  return Response.json({ memory, projectId });
}
