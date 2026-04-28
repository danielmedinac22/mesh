import { NextRequest } from "next/server";
import { z } from "zod";
import { getReposForProject, getProject } from "@/lib/mesh-state";
import { stopPreview } from "@/lib/preview-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  projectId: z.string().min(1),
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
  const project = await getProject(parsed.data.projectId);
  if (!project) {
    return Response.json(
      { error: `project not found: ${parsed.data.projectId}` },
      { status: 404 },
    );
  }
  const repos = await getReposForProject(parsed.data.projectId);
  let stopped = 0;
  for (const r of repos) {
    if (await stopPreview(`run-${r.name}`, r.name)) stopped += 1;
  }
  return Response.json({ stopped });
}
