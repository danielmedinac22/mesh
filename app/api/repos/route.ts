import { NextRequest } from "next/server";
import { getCurrentProjectId, listRepos } from "@/lib/mesh-state";
import { bootstrapProjects } from "@/lib/migrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  await bootstrapProjects();
  const all = req.nextUrl.searchParams.get("all") === "1";
  const overrideProject = req.nextUrl.searchParams.get("projectId");
  const repos = (await listRepos()).filter((r) => r.name !== "mesh");
  if (all) return Response.json({ repos, projectId: null });
  const projectId = overrideProject ?? (await getCurrentProjectId());
  if (!projectId) return Response.json({ repos: [], projectId: null });
  const filtered = repos.filter((r) => (r.projectId ?? null) === projectId);
  return Response.json({ repos: filtered, projectId });
}
