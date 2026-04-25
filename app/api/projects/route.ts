import { NextRequest } from "next/server";
import { z } from "zod";
import {
  addProject,
  getCurrentProjectId,
  getProject,
  listProjects,
  projectSlug,
  ProjectColorSchema,
  setCurrentProject,
} from "@/lib/mesh-state";
import { bootstrapProjects } from "@/lib/migrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await bootstrapProjects();
  const projects = await listProjects();
  const currentProjectId = await getCurrentProjectId();
  return Response.json({ projects, currentProjectId });
}

const CreateSchema = z.object({
  name: z.string().min(1),
  label: z.string().optional(),
  color: ProjectColorSchema.optional(),
  description: z.string().optional(),
});

export async function POST(req: NextRequest) {
  await bootstrapProjects();
  const body = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues.map((i) => i.message).join(", ") },
      { status: 400 },
    );
  }
  const { name, label, color, description } = parsed.data;
  const id = projectSlug(name);
  const existing = await getProject(id);
  if (existing) {
    return Response.json(
      { error: `project already exists: ${id}` },
      { status: 409 },
    );
  }
  const now = new Date().toISOString();
  await addProject({
    id,
    name,
    label,
    color: color ?? "amber",
    description,
    repos: [],
    createdAt: now,
    updatedAt: now,
  });
  await setCurrentProject(id);
  const project = await getProject(id);
  return Response.json({ project, currentProjectId: id });
}
