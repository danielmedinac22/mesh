import { NextRequest } from "next/server";
import { z } from "zod";
import {
  listSkills,
  createSkill,
  createSkillFromRaw,
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

// Two creation paths share this endpoint:
//   1. Conversational generator: passes `raw` (a complete SKILL.md). Name and
//      kind come from the parsed frontmatter — no manual taxonomy choice.
//   2. Manual fallback: passes `name` (and optional description), gets a
//      skeleton skill written to disk for the user to edit.
const CreateSchema = z.object({
  scope: z.enum(["personal", "project"]),
  scopeLabel: z.string().min(1),
  raw: z.string().min(1).max(60_000).optional(),
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(400).optional(),
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
  if (!parsed.data.raw && !parsed.data.name) {
    return Response.json(
      { error: "provide `raw` (generated SKILL.md) or `name` (skeleton)" },
      { status: 400 },
    );
  }
  try {
    const skill = parsed.data.raw
      ? await createSkillFromRaw({
          scope: parsed.data.scope as SkillScope,
          scopeLabel: parsed.data.scopeLabel,
          raw: parsed.data.raw,
        })
      : await createSkill({
          scope: parsed.data.scope as SkillScope,
          scopeLabel: parsed.data.scopeLabel,
          name: parsed.data.name!,
          description: parsed.data.description,
        });
    return Response.json({ skill });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
