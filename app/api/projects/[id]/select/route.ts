import { NextRequest } from "next/server";
import { getProject, setCurrentProject } from "@/lib/mesh-state";
import { bootstrapProjects } from "@/lib/migrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  await bootstrapProjects();
  const project = await getProject(params.id);
  if (!project) return Response.json({ error: "not found" }, { status: 404 });
  await setCurrentProject(project.id);
  return Response.json({ ok: true, currentProjectId: project.id });
}
