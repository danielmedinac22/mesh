import { NextRequest } from "next/server";
import { z } from "zod";
import {
  getCurrentProjectId,
  getProject,
  getReposForProject,
  listProjects,
  ProjectColorSchema,
  ProjectOnboardingSchema,
  removeProject,
  setCurrentProject,
  updateProject,
} from "@/lib/mesh-state";
import { loadMemory } from "@/lib/memory";
import { bootstrapProjects } from "@/lib/migrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  await bootstrapProjects();
  const project = await getProject(params.id);
  if (!project) return Response.json({ error: "not found" }, { status: 404 });
  const repos = await getReposForProject(project.id);
  const memory = await loadMemory(project.id);
  return Response.json({ project, repos, memory });
}

const UpdateSchema = z.object({
  name: z.string().min(1).optional(),
  label: z.string().optional(),
  color: ProjectColorSchema.optional(),
  description: z.string().optional(),
  repos: z.array(z.string()).optional(),
  onboarding: ProjectOnboardingSchema.optional(),
});

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  await bootstrapProjects();
  const body = await req.json().catch(() => null);
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues.map((i) => i.message).join(", ") },
      { status: 400 },
    );
  }
  const project = await updateProject(params.id, parsed.data);
  if (!project) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ project });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  await bootstrapProjects();
  const list = await removeProject(params.id);
  // If we removed the current project, fall back to the first remaining.
  const current = await getCurrentProjectId();
  if (!current && list.length > 0) await setCurrentProject(list[0].id);
  const projects = await listProjects();
  return Response.json({ ok: true, projects });
}
