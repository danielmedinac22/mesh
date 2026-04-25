import { getCurrentProjectId, getRepo, removeRepo } from "@/lib/mesh-state";
import { getRepoBrief } from "@/lib/memory";
import { bootstrapProjects } from "@/lib/migrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { name: string } },
) {
  await bootstrapProjects();
  const name = decodeURIComponent(params.name);
  if (!name) return Response.json({ error: "name required" }, { status: 400 });
  const repo = await getRepo(name);
  if (!repo) return Response.json({ error: "not found" }, { status: 404 });
  const projectId = repo.projectId ?? (await getCurrentProjectId());
  const brief = projectId ? await getRepoBrief(projectId, name) : null;
  return Response.json({ repo, brief });
}

export async function DELETE(
  _req: Request,
  { params }: { params: { name: string } },
) {
  const name = decodeURIComponent(params.name);
  if (!name) return Response.json({ error: "name required" }, { status: 400 });
  const repos = await removeRepo(name);
  return Response.json({ ok: true, repos });
}
