import { NextRequest } from "next/server";
import { z } from "zod";
import {
  listSkills,
  createSkill,
  skillLocations,
  type SkillScope,
} from "@/lib/skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [skills, locations] = await Promise.all([
    listSkills(),
    skillLocations(),
  ]);
  return Response.json({
    skills,
    scopes: locations.map((l) => ({
      scope: l.scope,
      label: l.label,
      root: l.root,
    })),
  });
}

const CreateSchema = z.object({
  scope: z.enum(["personal", "project", "repo"]),
  scopeLabel: z.string().min(1),
  name: z.string().min(1).max(80),
  description: z.string().max(400).optional(),
  kind: z.enum(["invariant", "pattern", "knowledge"]).optional(),
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
    const skill = await createSkill({
      scope: parsed.data.scope as SkillScope,
      scopeLabel: parsed.data.scopeLabel,
      name: parsed.data.name,
      description: parsed.data.description,
      kind: parsed.data.kind,
    });
    return Response.json({ skill });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
